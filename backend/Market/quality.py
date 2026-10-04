"""Read-only, cached market quality inputs and public-safe projections.

Cache the source observations together with collector state, never the age or a
permission decision. A failed collection leaves LatestPrice intact, so this
summary describes usable stored observations rather than treating failures as
zero prices.
"""

from django.core.cache import cache
from django.db.models import Max, Q

from .models import CollectionRun, MarketConfig, MarketItem, epoch_ms
from .scope import market_scope_payload
from .serializers import STALE_AFTER_MS, utc_iso


CACHE_TTL_SECONDS = 300
SOURCE_CACHE_KEY = 'market:quality:source:v2'
TERMINAL_STATUSES = ('succeeded', 'partial', 'failed', 'needs_auth', 'rate_limited')
BAD_STATUSES = ('partial', 'failed', 'needs_auth', 'rate_limited')
RUN_FIELDS = (
    'id', 'status', 'created_at_ms', 'started_at_ms', 'finished_at_ms',
    'success_count', 'failure_count', 'expected_count', 'lease_expires_at_ms',
)


def _read_source(now_ms):
    # One joined inventory query, independent of the visible page/category.
    observations = [
        {
            # Internal immutable-snapshot markers participate in consistency
            # checks only; neither identifier is included in the public payload.
            'item_id': row['pk'],
            'snapshot_id': row['latest_price__snapshot_id'],
            'observed_at_ms': row['latest_price__snapshot__observed_at_ms'],
            'has_sell': row['latest_price__snapshot__best_sell'] is not None,
            'has_buy': row['latest_price__snapshot__best_buy'] is not None,
        }
        for row in MarketItem.objects.filter(enabled=True).order_by('pk').values(
            'pk', 'latest_price__snapshot_id',
            'latest_price__snapshot__observed_at_ms',
            'latest_price__snapshot__best_sell', 'latest_price__snapshot__best_buy',
        )
    ]
    # Do not use get_or_create: reading the summary must not configure a worker.
    config = MarketConfig.objects.filter(pk=1).values(
        'enabled', 'session_status', 'cooldown_until_ms', 'updated_at_ms',
    ).first()
    runs = CollectionRun.objects.all()
    latest_run = runs.filter(status__in=('running',) + TERMINAL_STATUSES).values(
        *RUN_FIELDS,
    ).first()
    completed = list(runs.filter(
        status__in=TERMINAL_STATUSES, finished_at_ms__isnull=False,
    ).order_by('-finished_at_ms', '-created_at_ms', '-pk').values(*RUN_FIELDS)[:2])
    times = runs.aggregate(
        last_success_at_ms=Max('finished_at_ms', filter=Q(
            # A terminal failure/auth/rate rejection can follow earlier
            # successful snapshot writes. This is the last acquisition time,
            # separate from whether the whole attempt completed healthily.
            status__in=TERMINAL_STATUSES, success_count__gt=0,
        )),
        last_failure_at_ms=Max('finished_at_ms', filter=Q(status__in=BAD_STATUSES)),
    )
    return {
        'loaded_at_ms': now_ms,
        'observations': observations,
        'config': config,
        'latest_run': latest_run,
        'completed': completed,
        **times,
    }


def _load_source(now_ms):
    # MySQL READ COMMITTED does not turn atomic() into a repeatable snapshot.
    # Compare complete projected sources instead: this detects per-item writes,
    # run claims/completions and configuration changes between our SELECTs.
    # Reads are bounded at three passes (15 queries), with no locks or writes.
    previous = _read_source(now_ms)
    for _ in range(2):
        current = _read_source(now_ms)
        if current == previous:
            return {**current, 'consistent': True}
        previous = current
    return {**previous, 'consistent': False}


def quality_source(now_ms):
    source = cache.get(SOURCE_CACHE_KEY)
    # The explicit age guard also protects long-lived custom cache backends and
    # clock rollback. All fields refresh as one cache value.
    if source is None or not 0 <= now_ms - source['loaded_at_ms'] < CACHE_TTL_SECONDS * 1000:
        source = _load_source(now_ms)
        # If the collector is still changing the source across all three reads,
        # return its observations with a conservative state and try again on
        # the next request rather than caching a mixed completion for 5 minutes.
        if source['consistent']:
            cache.set(SOURCE_CACHE_KEY, source, CACHE_TTL_SECONDS)
    return source


def _healthy(run):
    return bool(
        run and run['status'] == 'succeeded' and run['success_count'] > 0
        and run['failure_count'] == 0
        and (run['expected_count'] is None or run['success_count'] == run['expected_count'])
    )


def _collector_payload(source, now_ms):
    config = source['config']
    latest = source['latest_run']
    completed = source['completed']
    terminal = completed[0] if completed else None
    previous = completed[1] if len(completed) > 1 else None

    running = latest and latest['status'] == 'running' and latest['finished_at_ms'] is None
    if not source['consistent']:
        status = 'attention'
    elif running and latest['lease_expires_at_ms'] and latest['lease_expires_at_ms'] > now_ms:
        status = 'collecting'
    elif config and not config['enabled']:
        status = 'paused'
    elif config is None or config['session_status'] in ('unconfigured', 'needs_auth', 'blocked'):
        status = 'attention'
    elif config['cooldown_until_ms'] and config['cooldown_until_ms'] > now_ms:
        status = 'retrying'
    elif running:
        status = 'attention'
    elif terminal and terminal['status'] == 'partial':
        status = 'partial'
    elif terminal and terminal['status'] in ('failed', 'rate_limited'):
        status = 'failed'
    elif terminal and terminal['status'] == 'needs_auth':
        status = 'attention'
    elif _healthy(terminal) and config['session_status'] == 'ready':
        status = 'recovered' if previous and previous['status'] in BAD_STATUSES else 'healthy'
    elif terminal or config['session_status'] != 'ready':
        status = 'attention'
    else:
        status = 'waiting'

    return {
        'status': status,
        'last_attempt_at': utc_iso(
            (latest['finished_at_ms'] or latest['started_at_ms'] or latest['created_at_ms'])
            if latest else None
        ),
        'last_success_at': utc_iso(source['last_success_at_ms']),
        'last_failure_at': utc_iso(source['last_failure_at_ms']),
        # Counts describe the last completed attempt, including while collecting.
        'success_count': terminal['success_count'] if terminal and source['consistent'] else None,
        'failure_count': terminal['failure_count'] if terminal and source['consistent'] else None,
    }


def quality_payload(now_ms=None):
    now_ms = epoch_ms() if now_ms is None else now_ms
    source = quality_source(now_ms)
    observations = source['observations']
    counts = dict.fromkeys((
        'enabled', 'observed', 'uncollected', 'fresh_sell', 'stale_sell',
        'missing_sell', 'empty_book', 'stale_observed',
    ), 0)
    counts['enabled'] = len(observations)
    observed_times = []
    for observation in observations:
        observed_at_ms = observation['observed_at_ms']
        if observed_at_ms is None:
            counts['uncollected'] += 1
            continue
        observed_times.append(observed_at_ms)
        counts['observed'] += 1
        stale = now_ms - observed_at_ms > STALE_AFTER_MS
        counts['stale_observed'] += int(stale)
        if observation['has_sell']:
            counts['stale_sell' if stale else 'fresh_sell'] += 1
        else:
            counts['missing_sell'] += 1
            counts['empty_book'] += int(not observation['has_buy'])
    total = counts['enabled']
    available = counts['fresh_sell'] + counts['stale_sell']
    return {
        'generated_at': utc_iso(now_ms),
        'snapshot_at': utc_iso(source['loaded_at_ms']),
        'cache_ttl_seconds': CACHE_TTL_SECONDS,
        'stale_after_seconds': STALE_AFTER_MS // 1000,
        'market_scope': market_scope_payload(),
        'counts': counts,
        'sell_coverage': {
            'available': available,
            'fresh': counts['fresh_sell'],
            'total': total,
            'available_ratio': available / total if total else None,
            'fresh_ratio': counts['fresh_sell'] / total if total else None,
        },
        'last_observed_at': utc_iso(max(observed_times)) if observed_times else None,
        'oldest_observed_at': utc_iso(min(observed_times)) if observed_times else None,
        'observations': [
            {
                'observed_at': utc_iso(observation['observed_at_ms']),
                'has_sell': observation['has_sell'],
                'has_buy': observation['has_buy'],
            }
            for observation in observations
        ],
        'collector': _collector_payload(source, now_ms),
    }
