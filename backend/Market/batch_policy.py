"""Shared database-backed capacity policy; no account material or network I/O."""
from .models import epoch_ms

MAX_ITEMS_PER_RUN = 80
FALLBACK_ITEMS_PER_RUN = 40
QUERY_DELAY_MIN_MS = 2000
QUERY_DELAY_MAX_MS = 3000
RUN_TIME_BUDGET_SECONDS = 8 * 60
FINISH_RESERVE_SECONDS = 20
RPC_RESERVE_SECONDS = 10 + FINISH_RESERVE_SECONDS
SESSION_RESERVE_SECONDS = 20 + FINISH_RESERVE_SECONDS
FALLBACK_DURATION_MS = 6 * 60 * 60 * 1000
CAPACITY_FAILURE_THRESHOLD = 2
CAPACITY_ERROR_CODES = frozenset({'network_error', 'timeout', 'budget_exhausted'})


def batch_policy(config, now_ms=None):
    now_ms = epoch_ms() if now_ms is None else now_ms
    active = bool(config.batch_fallback_until_ms and config.batch_fallback_until_ms > now_ms)
    return {
        'configured_max_items_per_run': config.max_items_per_run,
        'max_items_per_run': min(config.max_items_per_run, FALLBACK_ITEMS_PER_RUN) if active else config.max_items_per_run,
        'batch_fallback_until_ms': config.batch_fallback_until_ms if active else None,
        'batch_fallback_reason': config.batch_fallback_reason if active else '',
        'query_delay_min_seconds': QUERY_DELAY_MIN_MS / 1000,
        'query_delay_max_seconds': QUERY_DELAY_MAX_MS / 1000,
        'run_time_budget_seconds': RUN_TIME_BUDGET_SECONDS,
    }
