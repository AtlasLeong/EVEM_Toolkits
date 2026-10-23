"""Private, stored-only planning telemetry; no session files or coordinator I/O.

Planning targets are not the public two-hour freshness contract or guarantees.
SQL aggregate/offset reads keep returned rows bounded as the inventory grows.
"""
import math

from django.db.models import Count, Max, Q

from .models import CollectionRun, MarketItem, epoch_ms
from .serializers import STALE_AFTER_MS, safe_error_code


HOUR_MS = 3_600_000
PLAN_STALE_MS = 24 * HOUR_MS
OBSERVED = 'latest_price__snapshot__observed_at_ms'
USABLE = Q(latest_price__snapshot__best_sell__isnull=False) | Q(latest_price__snapshot__best_buy__isnull=False)
TERMINAL = ('succeeded', 'partial', 'failed', 'needs_auth', 'rate_limited')


def _tier_health(items, target_ms, now_ms):
    result = items.aggregate(
        enabled=Count('pk'), observed=Count(OBSERVED), usable=Count('pk', filter=USABLE),
        within_two_hours=Count('pk', filter=Q(**{f'{OBSERVED}__gte': now_ms-STALE_AFTER_MS, f'{OBSERVED}__lte': now_ms})),
        usable_within_two_hours=Count('pk', filter=USABLE & Q(**{f'{OBSERVED}__gte': now_ms-STALE_AFTER_MS, f'{OBSERVED}__lte': now_ms})),
        within_target=Count('pk', filter=Q(**{f'{OBSERVED}__gte': now_ms-target_ms, f'{OBSERVED}__lte': now_ms})),
    )
    observed = items.filter(**{f'{OBSERVED}__isnull': False}).order_by('-' + OBSERVED, 'pk').values_list(OBSERVED, flat=True)
    count = result['observed']
    result.update(target_ms=target_ms, age_median_ms=None, age_p95_ms=None, max_age_ms=None)
    if count:
        # Nearest-rank p95; even median is the mean of the two central ages.
        indexes = {(count-1)//2, count//2, math.ceil(count*.95)-1, count-1}
        ages = {index: max(0, now_ms-observed[index]) for index in indexes}
        result.update(age_median_ms=(ages[(count-1)//2]+ages[count//2])/2,
                      age_p95_ms=ages[math.ceil(count*.95)-1], max_age_ms=ages[count-1])
    return result


def _pause(config, latest, now_ms):
    attempted = (latest.finished_at_ms or latest.started_at_ms or latest.created_at_ms) if latest else None
    code = safe_error_code(latest.error_code) if latest else ''
    if not config.enabled:
        reason = 'paused'
    elif config.cooldown_until_ms and config.cooldown_until_ms > now_ms:
        reason = 'rate_cooldown'
    else:
        reason = {
            'invalid_session': 'invalid_material', 'auth_rejected': 'authentication_rejected',
            'unauthorized': 'authentication_rejected',
            'AUTH_EXPIRED': 'authentication_rejected', 'needs_auth': 'authentication_required',
            'service_rejected': 'service_refused', 'rate_limited': 'rate_cooldown',
            'account_busy': 'account_busy', 'budget_exhausted': 'budget_exhausted',
            'configuration_error': 'configuration_error', 'timeout': 'timeout',
            'ORDER_TIMEOUT': 'timeout', 'network_error': 'network_error',
            'runtime_budget': 'runtime_budget', 'no_enabled_items': 'no_enabled_items',
            'collection_error': 'collection_error', 'item_error': 'collection_error',
        }.get(code)
        if reason is None:
            if code:
                reason = 'unknown'
            else:
                reason = {'ready': 'ready', 'needs_auth': 'authentication_required',
                          'blocked': 'service_refused', 'unconfigured': 'configuration_error'}.get(config.session_status, 'unknown')
    return {'code': reason,
            'retry_at_ms': config.cooldown_until_ms if reason == 'rate_cooldown' else None,
            'last_attempt_at_ms': attempted}


def collection_health(config, now_ms=None):
    now_ms = epoch_ms() if now_ms is None else now_ms
    items = MarketItem.objects.filter(enabled=True)
    tiers = {
        'priority': _tier_health(items.filter(collection_priority=True), STALE_AFTER_MS, now_ms),
        'ordinary': _tier_health(items.filter(Q(collection_priority=False) | Q(collection_priority__isnull=True)), 3*STALE_AFTER_MS, now_ms),
    }
    latest = CollectionRun.objects.exclude(status='queued').first()
    planned = CollectionRun.objects.filter(item_limit__isnull=False, expected_count__isnull=False,
                                          started_at_ms__isnull=False).order_by('-started_at_ms', '-pk').first()
    plan = None if planned is None else {
        'item_limit': planned.item_limit, 'expected_count': planned.expected_count,
        'planned_at_ms': planned.started_at_ms,
        'stale': not 0 <= now_ms-planned.started_at_ms < PLAN_STALE_MS,
    }
    runs = list(CollectionRun.objects.filter(status__in=TERMINAL,
        finished_at_ms__gte=now_ms-PLAN_STALE_MS, finished_at_ms__lte=now_ms,
    ).order_by('-finished_at_ms', '-pk').values(
        'created_at_ms', 'started_at_ms', 'finished_at_ms', 'success_count',
    )[:50])
    start = min((row['started_at_ms'] or row['created_at_ms'] for row in runs), default=None)
    end = max((row['finished_at_ms'] for row in runs), default=None)
    elapsed = end-start if start is not None and end is not None and end >= start else None
    successes = sum(row['success_count'] for row in runs)
    throughput = {
        'run_count': len(runs), 'success_count': successes if runs else None,
        'elapsed_ms': elapsed, 'start_at_ms': start, 'end_at_ms': end,
        'per_hour': successes*HOUR_MS/elapsed if len(runs) >= 2 and elapsed is not None and elapsed >= HOUR_MS else None,
    }
    capacity = dict.fromkeys(('estimated_items_per_hour', 'priority_slots', 'ordinary_slots',
                             'priority_target_feasible', 'ordinary_target_feasible'))
    warnings = []
    if plan is None:
        warnings.append('plan_unavailable')
    elif plan['stale']:
        warnings.append('plan_stale')
    else:
        # The persisted worker limit incorporates its real shared-account cap;
        # web-only environment settings cannot tell us the collector's plan.
        limit = min(plan['item_limit'], plan['expected_count'])
        priority = min(tiers['priority']['enabled'], limit//2)
        ordinary = min(tiers['ordinary']['enabled'], limit-priority)
        priority = min(tiers['priority']['enabled'], limit-ordinary)
        duration = max(0, (planned.finished_at_ms or now_ms)-planned.started_at_ms)
        interval = (config.min_interval_seconds+config.max_interval_seconds)*500 + duration
        capacity.update(estimated_items_per_hour=limit*HOUR_MS/interval,
                        priority_slots=priority, ordinary_slots=ordinary)
        for key, slots in (('priority', priority), ('ordinary', ordinary)):
            feasible = slots*tiers[key]['target_ms']/interval >= tiers[key]['enabled']
            capacity[f'{key}_target_feasible'] = feasible
            if not feasible:
                warnings.append(f'{key}_target_infeasible')
    if throughput['per_hour'] is None:
        warnings.append('throughput_unavailable')
    capacity['warnings'] = warnings
    times = CollectionRun.objects.filter(status__in=TERMINAL).aggregate(
        last_success_at_ms=Max('finished_at_ms', filter=Q(success_count__gt=0)),
        last_failure_at_ms=Max('finished_at_ms', filter=~Q(status='succeeded')),
    )
    return {'generated_at_ms': now_ms, 'tiers': tiers, 'actual_plan': plan,
            'throughput': throughput, 'capacity': capacity,
            'pause': _pause(config, latest, now_ms), 'pool_state': 'unknown', **times}
