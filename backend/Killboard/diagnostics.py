"""Bounded, read-only collector statistics from retained audit rows.

No session files, credentials or collector clients are consulted. Successful
KM observations, persistence dispositions and stop reasons are separate axes.
"""

import re

from django.db.models.functions import Coalesce

from .models import ProbeEvent, ProbeRun, epoch_ms


DEFAULT_WINDOW_HOURS = 24
MAX_WINDOW_HOURS = 168
MAX_RUNS = 5000
MAX_EVENTS = 20000
MAX_GROUPS = 256
AUDIT_METHODS = frozenset(('login_sigma', 'request_start_wait', 'get_newbie_info',
                           'select_character_id', 'get_kill_info', 'get_public_info', 'get_corp_brief'))
AUDIT_STAGES = frozenset(('connection', 'authentication', 'kill_report', 'identity'))
AUDIT_ERRORS = frozenset((
    'rate_limited', 'cooldown', 'unauthorized', 'network_error', 'malformed', 'budget_exhausted',
    'configuration_error', 'service_rejected', 'empty_threshold', 'max_requests', 'max_seconds',
    'time_reversed', 'lease_expired', 'lease_lost', 'failed', 'empty', 'report', 'boundary_located',
    'frontier_search', 'caught_up', 'not_configured', 'CollectorError', 'NeedsAuthError',
    'collectorerror', 'needsautherror', 'killprotocolerror', 'killparseerror', 'typeerror', 'valueerror',
    'locate_budget', 'missing_known_report', 'missing_start_id', 'invalid_strategy_state',
    'waiting_visibility', 'id_limit', 'missing_kill_blob', 'kill_id_mismatch', 'invalid_deferred_stop',
))
AUDIT_DISPOSITIONS = ('created', 'updated', 'filtered_value', 'filtered_npc', 'filtered_policy', 'parsed')
DISPOSITION_COUNTS = tuple(value + '_count' for value in AUDIT_DISPOSITIONS)
AUDIT_COUNTS = frozenset((*DISPOSITION_COUNTS, 'rpc_count', 'enrichment_deferred_count',
                         'locate_count', 'scan_count', 'history_count'))
EVENT_STATUSES = frozenset(('report', 'empty', 'unauthorized', 'rate_limited', 'network_error',
                            'malformed', 'budget_exhausted', 'lease_lost', 'configuration_error',
                            'service_rejected', 'failed'))
RUN_STATUSES = frozenset(('queued', 'running', 'succeeded', 'stopped', 'failed'))
FAILURE_CATEGORIES = ('rate_limited', 'unauthorized', 'malformed', 'network_error',
                      'configuration_error', 'service_rejected', 'budget_exhausted',
                      'lease_lost', 'unknown_error')
_MATERIAL_PATTERNS = {
    'material_alias': re.compile(r'm_[a-f0-9]{24}\Z'),
    'material_version': re.compile(r'v_[a-f0-9]{24}\Z'),
    'pool_version': re.compile(r'p_[a-f0-9]{24}\Z'),
}


def audit_choice(value, choices):
    return isinstance(value, str) and value in choices


def bounded_integer(value, maximum=2**63 - 1):
    return value if type(value) is int and 0 <= value <= maximum else None


def audit_error(value):
    return value if audit_choice(value, AUDIT_ERRORS) else ('unknown_error' if value else '')


def audit_status(value, *, run=False):
    return value if audit_choice(value, RUN_STATUSES if run else EVENT_STATUSES) else 'unknown_status'


def material_identity(value):
    if not isinstance(value, dict):
        return None
    fields = tuple(value.get(key) for key in _MATERIAL_PATTERNS)
    if all(isinstance(item, str) and pattern.fullmatch(item)
           for item, pattern in zip(fields, _MATERIAL_PATTERNS.values())):
        return fields
    return None


def safe_diagnostics(value):
    """Revalidate stored JSON; arbitrary remote text never reaches consumers."""
    if not isinstance(value, dict):
        return {}
    result = {}
    slot = value.get('session_slot')
    if isinstance(slot, str) and re.fullmatch(r'[A-Z]{1,2}', slot):
        ordinal = 0
        for char in slot:
            ordinal = ordinal * 26 + ord(char) - ord('A') + 1
        if ordinal <= 201:
            result['session_slot'] = slot
    identity = material_identity(value)
    if identity:
        result.update(zip(_MATERIAL_PATTERNS, identity))
    for key in AUDIT_COUNTS:
        number = bounded_integer(value.get(key), 10000000)
        if number is not None:
            result[key] = number
    for key in ('last_rpc_method', 'failure_rpc_method'):
        if audit_choice(value.get(key), AUDIT_METHODS):
            result[key] = value[key]
    for key, choices in (('stage', AUDIT_STAGES), ('disposition', AUDIT_DISPOSITIONS),
                         ('error_code', AUDIT_ERRORS)):
        if audit_choice(value.get(key), choices):
            result[key] = value[key]
    if value.get('strategy') == 'latest_first':
        result['strategy'] = 'latest_first'
    if audit_choice(value.get('phase'), ('locate', 'scan')):
        result['phase'] = value['phase']
    for key in ('enrichment_deferred', 'history'):
        if type(value.get(key)) is bool:
            result[key] = value[key]
    return result


def validate_window_hours(value):
    if type(value) is not int or not 1 <= value <= MAX_WINDOW_HOURS:
        raise ValueError(f'window_hours must be an integer between 1 and {MAX_WINDOW_HOURS}.')
    return value


def _failure_category(value):
    code = audit_error(value)
    if code in ('killprotocolerror', 'killparseerror', 'typeerror', 'valueerror',
                'missing_kill_blob', 'kill_id_mismatch', 'invalid_deferred_stop'):
        return 'malformed'
    if code == 'lease_expired':
        return 'lease_lost'
    if code in ('failed', 'CollectorError', 'collectorerror', 'unknown_error'):
        return 'unknown_error'
    if code in ('NeedsAuthError', 'needsautherror'):
        return 'unauthorized'
    return code if code in FAILURE_CATEGORIES else None


def _new_counts():
    return {
        'runs': 0, 'attempted_runs': 0, 'unknown_attempt_runs': 0, 'request_runs': 0,
        'runs_with_km': 0, 'request_count': 0,
        'km_response_count': 0, 'empty_count': 0, 'known_rpc_count': 0,
        'missing_rpc_runs': 0, 'skipped_cooldown_runs': 0, 'last_km_run_at_ms': None,
        'trailing_zero_km_runs': 0, 'stop_counts': {},
        'failure_counts': dict.fromkeys(FAILURE_CATEGORIES, 0),
        'known_dispositions': dict.fromkeys(DISPOSITION_COUNTS, 0),
        'missing_disposition_runs': dict.fromkeys(DISPOSITION_COUNTS, 0),
        'unclassified_km_response_count': 0, 'counter_mismatch_runs': 0,
        '_seen_km': False, '_trailing_unknown': False,
    }


def _add_run(counts, row, diagnostics):
    # Rows are newest first. A cooldown round never counts as a material attempt.
    counts['runs'] += 1
    requests, reports, empty = row['request_count'], row['report_count'], row['empty_count']
    rpc = diagnostics.get('rpc_count')
    reason = audit_error(row['stop_reason'] or row['error_code'])
    attempted = rpc is not None and rpc > 0
    cooldown_skip = not attempted and not requests and reason in ('cooldown', 'rate_limited')
    counts['attempted_runs'] += int(attempted)
    unknown_attempt = rpc is None and not cooldown_skip
    counts['unknown_attempt_runs'] += int(unknown_attempt)
    counts['request_runs'] += int(bool(requests))
    counts['skipped_cooldown_runs'] += int(cooldown_skip)
    counts['request_count'] += requests
    counts['km_response_count'] += reports
    counts['empty_count'] += empty
    if rpc is not None:
        counts['known_rpc_count'] += rpc
    elif not cooldown_skip:
        counts['missing_rpc_runs'] += 1
    if reason:
        counts['stop_counts'][reason] = counts['stop_counts'].get(reason, 0) + 1
    category = _failure_category(reason)
    if category and (attempted or requests) and not cooldown_skip:
        counts['failure_counts'][category] += 1
    if reports:
        counts['runs_with_km'] += 1
        counts['_seen_km'] = True
        point = row['finished_at_ms'] or row['started_at_ms'] or row['created_at_ms']
        counts['last_km_run_at_ms'] = max(counts['last_km_run_at_ms'] or 0, point)
    elif attempted and not counts['_seen_km']:
        counts['trailing_zero_km_runs'] += 1
    elif unknown_attempt and not counts['_seen_km']:
        counts['_trailing_unknown'] = True
    known = 0
    for key in DISPOSITION_COUNTS:
        number = diagnostics.get(key)
        if number is None:
            counts['missing_disposition_runs'][key] += int(reports > 0)
        else:
            counts['known_dispositions'][key] += number
            known += number
    counts['unclassified_km_response_count'] += max(0, reports - known)
    counts['counter_mismatch_runs'] += int(known > reports)


def _finish_counts(counts):
    result = {key: value for key, value in counts.items() if not key.startswith('_')}
    result['rpc_count'] = None if counts['missing_rpc_runs'] else counts['known_rpc_count']
    if counts['_trailing_unknown']:
        result['trailing_zero_km_runs'] = None
    result['dispositions'] = {
        key: None if counts['missing_disposition_runs'][key] else counts['known_dispositions'][key]
        for key in DISPOSITION_COUNTS
    }
    return result


def diagnostic_summary(cursor=None, *, window_hours=DEFAULT_WINDOW_HOURS, now_ms=None):
    """Summarize a fixed maximum window without reading secrets or writing rows.

    Window selection uses run start time, falling back to creation time for old
    rows without a start timestamp. Counters describe whole retained
    runs, including partial running rounds. Limits are explicit in coverage.
    Legacy slots never become stable material identities or account identities.
    """
    hours = validate_window_hours(window_hours)
    end = epoch_ms() if now_ms is None else bounded_integer(now_ms)
    if end is None:
        raise ValueError('now_ms must be a non-negative integer.')
    start = max(0, end - hours * 3600000)
    retained_runs = ProbeRun.objects.filter(cursor=cursor) if cursor else ProbeRun.objects.none()
    retained_events = ProbeEvent.objects.filter(run__cursor=cursor) if cursor else ProbeEvent.objects.none()
    window_runs = retained_runs.annotate(diagnostic_start=Coalesce('started_at_ms', 'created_at_ms')).filter(
        diagnostic_start__gte=start, diagnostic_start__lt=end)
    window_events = retained_events.annotate(diagnostic_start=Coalesce(
        'run__started_at_ms', 'run__created_at_ms')).filter(diagnostic_start__gte=start, diagnostic_start__lt=end)
    rows = list(window_runs.order_by('-diagnostic_start', '-id').values(
        'id', 'request_count', 'report_count', 'empty_count', 'diagnostics', 'stop_reason',
        'error_code', 'started_at_ms', 'finished_at_ms', 'created_at_ms',
    )[:MAX_RUNS])
    totals, groups = _new_counts(), {}
    stable_runs = legacy_runs = unattributed_runs = missing_diagnostics_runs = 0
    for row in rows:
        raw = row['diagnostics']
        diagnostics = safe_diagnostics(raw)
        identity = material_identity(diagnostics)
        slot = diagnostics.get('session_slot')
        if identity:
            stable_runs += 1
            key = ('material', *identity)
        elif slot:
            legacy_runs += 1
            key = ('legacy_slot', slot)
        else:
            unattributed_runs += 1
            key = ('unattributed',)
        missing_diagnostics_runs += int(not diagnostics)
        _add_run(totals, row, diagnostics)
        _add_run(groups.setdefault(key, _new_counts()), row, diagnostics)
    material_rows, legacy_rows = [], []
    # Unattributed totals are emitted separately and do not consume this cap.
    all_groups = [(key, counts) for key, counts in groups.items() if key[0] != 'unattributed']
    for key, counts in all_groups[:MAX_GROUPS]:
        item = {'attribution': key[0], **_finish_counts(counts)}
        if key[0] == 'material':
            item.update(zip(_MATERIAL_PATTERNS, key[1:]))
            material_rows.append(item)
        elif key[0] == 'legacy_slot':
            item['session_slot'] = key[1]
            legacy_rows.append(item)
    events = list(window_events.filter(run_id__in=[row['id'] for row in rows]).order_by(
        '-observed_at_ms', '-id').values('status', 'error_code', 'diagnostics')[:MAX_EVENTS]) if rows else []
    event_outcomes, event_failures = {}, dict.fromkeys(FAILURE_CATEGORIES, 0)
    for row in events:
        status = audit_status(row['status'])
        event_outcomes[status] = event_outcomes.get(status, 0) + 1
        diagnostics = safe_diagnostics(row['diagnostics'])
        category = (_failure_category(row['error_code'])
                    or _failure_category(diagnostics.get('error_code')) or _failure_category(status))
        if category:
            event_failures[category] += 1
    run_count, event_count = window_runs.count(), window_events.count()
    coverage = {
        'retained_runs': retained_runs.count(), 'retained_events': retained_events.count(),
        'window_runs': run_count, 'window_events': event_count,
        'included_runs': len(rows), 'included_events': len(events),
        'omitted_runs': max(0, run_count - len(rows)), 'omitted_events': max(0, event_count - len(events)),
        'stable_material_runs': stable_runs, 'legacy_slot_runs': legacy_runs,
        'unattributed_runs': unattributed_runs, 'missing_diagnostics_runs': missing_diagnostics_runs,
        'attribution_groups': len(all_groups), 'omitted_groups': max(0, len(all_groups) - MAX_GROUPS),
        'attribution_scope': 'included_window_runs',
        'group_scope': 'material_and_legacy_slot',
        'max_runs': MAX_RUNS, 'max_events': MAX_EVENTS, 'max_groups': MAX_GROUPS,
        'coverage_verified': False,
    }
    coverage['truncated'] = bool(coverage['omitted_runs'] or coverage['omitted_events'] or coverage['omitted_groups'])
    return {
        'schema_version': 1,
        'window': {'from_ms': start, 'to_ms': end, 'hours': hours, 'max_hours': MAX_WINDOW_HOURS,
                   'basis': 'run_started_at_ms_or_created_at_ms', 'includes_partial_runs': True,
                   'last_km_time_basis': 'run_finished_at_ms_or_started_at_ms_or_created_at_ms'},
        'distinct_accounts': None, 'account_mapping_present': None, 'account_mapping_used': False,
        'counter_basis': {
            'km_response_count': 'retained_run_report_count',
            'dispositions': 'retained_run_diagnostics',
            'attempted_runs': 'retained_run_rpc_count_gt_zero',
            'runs_with_km': 'retained_run_report_count_gt_zero',
            'trailing_zero_km_runs': 'known_rpc_attempts_with_zero_retained_run_report_count_unknown_if_missing_rpc',
            'failure_counts': 'classified_run_stops_with_request_or_rpc_evidence',
            'event_outcomes': 'retained_probe_event_rows',
            'unique_kill_reports': False,
            'run_report_counts_may_differ_from_report_events': True,
        },
        'totals': _finish_counts(totals), 'event_outcomes': event_outcomes,
        'event_failure_counts': event_failures, 'materials': material_rows, 'legacy_slots': legacy_rows,
        'unattributed': _finish_counts(groups.get(('unattributed',), _new_counts())),
        'coverage': coverage,
    }
