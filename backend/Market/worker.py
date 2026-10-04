"""Run at most one due market collection in a short-lived process."""

import random
import time
import uuid
from contextlib import nullcontext

from django.db import transaction
from django.db.models import Q
from GameSessions.coordination import CoordinationError, MAX_ACCOUNT_RPCS, account_lease
from GameSessions.rotation import round_robin

from .models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot, epoch_ms
from .batch_policy import (
    MAX_ITEMS_PER_RUN, FALLBACK_ITEMS_PER_RUN, QUERY_DELAY_MIN_MS, QUERY_DELAY_MAX_MS,
    RUN_TIME_BUDGET_SECONDS, RPC_RESERVE_SECONDS, SESSION_RESERVE_SECONDS,
    FINISH_RESERVE_SECONDS,
    FALLBACK_DURATION_MS, CAPACITY_FAILURE_THRESHOLD, CAPACITY_ERROR_CODES, batch_policy,
    RECOVERY_SUCCESS_THRESHOLD, RECOVERABLE_FALLBACK_REASONS,
)


LEASE_MS = 12 * 60 * 1000
AUTH_RPC_COUNT = 4
RECOVERY_FIELDS = ['batch_recovery_success_count', 'batch_recovery_probe_attempted',
                   'batch_recovery_success_at_ms']


class RuntimeBudgetExceeded(Exception):
    """Stop before another network operation can consume the finish reserve."""

    code = 'runtime_budget'


class LeaseLost(Exception):
    """Another worker has superseded this run; no more writes are allowed."""


def _check_lease(locked_run, original_run, now_ms):
    if (
        locked_run.status != 'running'
        or locked_run.lease_owner != original_run.lease_owner
        or not locked_run.lease_owner
        or locked_run.lease_expires_at_ms is None
        or locked_run.lease_expires_at_ms <= now_ms
    ):
        raise LeaseLost()


def _reset_recovery(config, *, reset_attempt=False):
    config.batch_recovery_success_count = 0
    config.batch_recovery_success_at_ms = None
    if reset_attempt:
        config.batch_recovery_probe_attempted = False


def _recovery_eligible(config, now_ms, *, session_status=None):
    """Only transient transport protection can earn an early recovery."""
    return (
        config.enabled
        and config.max_items_per_run == MAX_ITEMS_PER_RUN
        and (config.session_status if session_status is None else session_status) == 'ready'
        and not (config.cooldown_until_ms and config.cooldown_until_ms > now_ms)
        and config.batch_fallback_until_ms is not None
        and config.batch_fallback_until_ms > now_ms
        and config.batch_fallback_reason in RECOVERABLE_FALLBACK_REASONS
        and not config.batch_recovery_probe_attempted
    )


def _recovery_credit(config):
    # An older release can finish a run without knowing these new fields.
    # Its updated_at change must invalidate credit left by the new release.
    if config.batch_recovery_success_at_ms != config.updated_at_ms:
        return 0
    return min(config.batch_recovery_success_count or 0, RECOVERY_SUCCESS_THRESHOLD)


def _prepare_batch_policy(run, now_ms):
    """Consume the one probe durably before any session or network operation."""
    with transaction.atomic():
        config = MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, now_ms)
        credit = _recovery_credit(config)
        eligible = _recovery_eligible(config, now_ms)
        if not credit or not eligible or run.trigger != 'scheduled':
            _reset_recovery(config)
        policy = batch_policy(config, now_ms)
        run.batch_recovery_probe = bool(
            run.trigger == 'scheduled' and eligible
            and credit >= RECOVERY_SUCCESS_THRESHOLD
        )
        if run.batch_recovery_probe:
            config.batch_recovery_probe_attempted = True
            _reset_recovery(config)
            policy['max_items_per_run'] = MAX_ITEMS_PER_RUN
        config.save(update_fields=RECOVERY_FIELDS)
        locked_run.batch_recovery_probe = run.batch_recovery_probe
        locked_run.save(update_fields=['batch_recovery_probe'])
        return policy


def _claim_run(now_ms):
    # A plain read inside this transaction would establish an InnoDB repeatable-
    # read snapshot before the config row lock. A contender could then miss the
    # run committed while it waited for that lock.
    MarketConfig.objects.get_or_create(pk=1)
    with transaction.atomic():
        config = MarketConfig.objects.select_for_update().get(pk=1)
        active = CollectionRun.objects.filter(
            status='running', lease_expires_at_ms__gt=now_ms,
        ).exists()
        if active:
            return None

        expired = CollectionRun.objects.filter(status='running').filter(
            Q(lease_expires_at_ms__lte=now_ms) | Q(lease_expires_at_ms__isnull=True)
        )
        if expired.exists():
            config.batch_fallback_until_ms = now_ms + FALLBACK_DURATION_MS
            config.batch_fallback_reason = 'lease_expired'
            config.capacity_failure_count = 0
            _reset_recovery(config)
            config.save(update_fields=['batch_fallback_until_ms', 'batch_fallback_reason',
                                       'capacity_failure_count'] + RECOVERY_FIELDS)
        elif config.batch_fallback_until_ms and config.batch_fallback_until_ms <= now_ms:
            config.batch_fallback_until_ms = None
            config.batch_fallback_reason = ''
            config.capacity_failure_count = 0
            _reset_recovery(config, reset_attempt=True)
            config.save(update_fields=['batch_fallback_until_ms', 'batch_fallback_reason',
                                       'capacity_failure_count'] + RECOVERY_FIELDS)
        expired.update(
            status='failed', finished_at_ms=now_ms, error_code='lease_expired',
            lease_owner='', lease_expires_at_ms=None,
        )

        queued = CollectionRun.objects.select_for_update().filter(status='queued').order_by('created_at_ms', 'id').first()
        # Manual jobs cannot bypass a server rate rejection.
        if config.cooldown_until_ms and config.cooldown_until_ms > now_ms:
            return None
        due = (
            config.enabled
            and config.session_status not in ('needs_auth', 'blocked')
            and (config.next_due_at_ms is None or config.next_due_at_ms <= now_ms)
        )
        if not queued and not due:
            return None
        if queued:
            run = queued
        else:
            run = CollectionRun(trigger='scheduled')
        run.status = 'running'
        run.started_at_ms = now_ms
        run.lease_owner = uuid.uuid4().hex
        run.lease_expires_at_ms = now_ms + LEASE_MS
        run.save()
        return run


def _save_quote(run, item, quote, observed_at_ms):
    with transaction.atomic():
        MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, observed_at_ms)
        snapshot, _ = PriceSnapshot.objects.get_or_create(
            run=run,
            item=item,
            defaults={
                'best_buy': quote.best_buy,
                'best_sell': quote.best_sell,
                'buy_order_count': quote.buy_count,
                'sell_order_count': quote.sell_count,
                'buy_prices': [str(value) for value in getattr(quote, 'buy_prices', ())[:5]],
                'sell_prices': [str(value) for value in getattr(quote, 'sell_prices', ())[:5]],
                'observed_at_ms': observed_at_ms,
            },
        )
        LatestPrice.objects.update_or_create(
            item=item,
            defaults={'snapshot': snapshot, 'updated_at_ms': observed_at_ms},
        )
        item.last_attempt_at_ms = observed_at_ms
        item.last_failure_at_ms = None
        item.last_error_code = ''
        item.save(update_fields=['last_attempt_at_ms', 'last_failure_at_ms', 'last_error_code'])
        locked_run.lease_expires_at_ms = observed_at_ms + LEASE_MS
        locked_run.save(update_fields=['lease_expires_at_ms'])
        run.lease_expires_at_ms = locked_run.lease_expires_at_ms


def _record_failure(run, item, attempted_at_ms, error_code='COLLECTION_ERROR'):
    with transaction.atomic():
        MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, attempted_at_ms)
        item.last_attempt_at_ms = attempted_at_ms
        item.last_failure_at_ms = attempted_at_ms
        item.last_error_code = error_code
        item.save(update_fields=['last_attempt_at_ms', 'last_failure_at_ms', 'last_error_code'])
        locked_run.lease_expires_at_ms = attempted_at_ms + LEASE_MS
        locked_run.save(update_fields=['lease_expires_at_ms'])
        run.lease_expires_at_ms = locked_run.lease_expires_at_ms


def _finish_run(run, *, config_status, next_due_ms, finished_at_ms, retry_at_ms=None):
    with transaction.atomic():
        config = MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, finished_at_ms)
        if run.status == 'rate_limited':
            config.rate_failure_count += 1
            cooldown_ms = finished_at_ms + min(60, 15 * 2 ** min(config.rate_failure_count - 1, 2)) * 60000
            config.cooldown_until_ms = max(cooldown_ms, retry_at_ms or 0)
            next_due_ms = max(next_due_ms or 0, config.cooldown_until_ms)
        elif run.status == 'succeeded':
            config.rate_failure_count = 0
            config.cooldown_until_ms = None
        if run.error_code in CAPACITY_ERROR_CODES:
            config.capacity_failure_count += 1
        else:
            config.capacity_failure_count = 0
        fallback_reason = None
        if run.error_code == 'runtime_budget':
            fallback_reason = 'runtime_budget'
        elif config.capacity_failure_count >= CAPACITY_FAILURE_THRESHOLD:
            fallback_reason = run.error_code
        elif getattr(run, '_shared_budget_limited', False):
            fallback_reason = 'shared_budget'
        probe = locked_run.batch_recovery_probe is True
        full_probe = (
            probe and run.status == 'succeeded' and config_status == 'ready'
            and run.item_limit == MAX_ITEMS_PER_RUN
            and run.expected_count == MAX_ITEMS_PER_RUN and _complete(run)
            and not getattr(run, '_shared_budget_limited', False)
        )
        if full_probe:
            config.batch_fallback_until_ms = None
            config.batch_fallback_reason = ''
            _reset_recovery(config, reset_attempt=True)
        elif probe:
            # Any incomplete probe consumes the sole opportunity for this
            # protected period, including a shared-budget truncation to forty.
            config.batch_recovery_probe_attempted = True
            _reset_recovery(config)
            config.batch_fallback_until_ms = finished_at_ms + FALLBACK_DURATION_MS
            config.batch_fallback_reason = fallback_reason or run.error_code or 'incomplete_run'
        elif fallback_reason:
            config.batch_fallback_until_ms = finished_at_ms + FALLBACK_DURATION_MS
            config.batch_fallback_reason = fallback_reason
        elif config.batch_fallback_until_ms and config.batch_fallback_until_ms <= finished_at_ms:
            config.batch_fallback_until_ms = None
            config.batch_fallback_reason = ''
            _reset_recovery(config, reset_attempt=True)
        if not probe:
            healthy_forty = (
                run.trigger == 'scheduled' and run.status == 'succeeded'
                and run.item_limit == FALLBACK_ITEMS_PER_RUN
                and run.expected_count == FALLBACK_ITEMS_PER_RUN and _complete(run)
                and not getattr(run, '_shared_budget_limited', False)
                and _recovery_eligible(config, finished_at_ms, session_status=config_status)
            )
            if healthy_forty:
                config.batch_recovery_success_count = min(
                    _recovery_credit(config) + 1, RECOVERY_SUCCESS_THRESHOLD,
                )
                config.batch_recovery_success_at_ms = finished_at_ms
            else:
                _reset_recovery(config)
        config.session_status = config_status
        config.next_due_at_ms = next_due_ms
        config.updated_at_ms = finished_at_ms
        config.save(update_fields=['session_status', 'next_due_at_ms', 'updated_at_ms',
                                   'cooldown_until_ms', 'rate_failure_count',
                                   'capacity_failure_count', 'batch_fallback_until_ms',
                                   'batch_fallback_reason'] + RECOVERY_FIELDS)
        run.finished_at_ms = finished_at_ms
        run.lease_owner = ''
        run.lease_expires_at_ms = None
        locked_run.status = run.status
        locked_run.finished_at_ms = run.finished_at_ms
        locked_run.success_count = run.success_count
        locked_run.failure_count = run.failure_count
        locked_run.error_code = run.error_code
        locked_run.item_limit = run.item_limit
        locked_run.expected_count = run.expected_count
        locked_run.batch_fallback_reason = run.batch_fallback_reason
        locked_run.lease_owner = ''
        locked_run.lease_expires_at_ms = None
        locked_run.save(update_fields=[
            'status', 'finished_at_ms', 'success_count', 'failure_count',
            'error_code', 'lease_owner', 'lease_expires_at_ms',
            'item_limit', 'expected_count', 'batch_fallback_reason',
        ])


def _save_plan(run, items, now_ms):
    """Persist the fixed list size before connecting; never infer it afterwards."""
    with transaction.atomic():
        MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, now_ms)
        run.expected_count = len(items)
        locked_run.expected_count = run.expected_count
        locked_run.item_limit = run.item_limit
        locked_run.batch_fallback_reason = run.batch_fallback_reason
        locked_run.save(update_fields=['expected_count', 'item_limit', 'batch_fallback_reason'])


def _complete(run):
    return (run.expected_count is not None and run.success_count == run.expected_count
            and run.failure_count == 0 and not run.error_code)


def _select_bundle(run, bundles, now_ms):
    """Advance the durable cursor only while owning the same claimed run."""
    with transaction.atomic():
        config = MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, now_ms)
        index, config.session_cursor = round_robin(len(bundles), config.session_cursor)
        config.save(update_fields=['session_cursor'])
    return bundles[index], index


def _heartbeat_run(run, now_ms):
    with transaction.atomic():
        MarketConfig.objects.select_for_update().get(pk=1)
        locked_run = CollectionRun.objects.select_for_update().get(pk=run.pk)
        _check_lease(locked_run, run, now_ms)
        locked_run.lease_expires_at_ms = now_ms + LEASE_MS
        locked_run.save(update_fields=['lease_expires_at_ms'])


def collect_due(*, clock_ms=epoch_ms, bundle_loader=None, session_factory=None,
                randint=random.randint, sleep=time.sleep, lease_factory=account_lease,
                monotonic=time.monotonic):
    """Collect due prices once; injected I/O lets tests exercise the DB path."""
    from .session_bundle import NeedsAuthError
    from .collector_protocol import NetworkError, RateLimitedError, ServiceRejectedError
    if bundle_loader is None:
        from .session_bundle import load_session_pool
        bundle_loader = load_session_pool
    if session_factory is None:
        from .collector_protocol import MarketSession
        session_factory = MarketSession

    deadline = monotonic() + RUN_TIME_BUDGET_SECONDS

    def check_budget(reserve=RPC_RESERVE_SECONDS):
        if monotonic() + reserve >= deadline:
            raise RuntimeBudgetExceeded()

    now_ms = clock_ms()
    run = _claim_run(now_ms)
    if run is None:
        return None

    policy = _prepare_batch_policy(run, now_ms)
    run.item_limit = min(MAX_ITEMS_PER_RUN, policy['max_items_per_run'])
    run.batch_fallback_reason = policy['batch_fallback_reason']
    items = list(
        MarketItem.objects.filter(enabled=True)
        .order_by('last_attempt_at_ms', 'id')[:run.item_limit]
    )
    _save_plan(run, items, now_ms)
    if not items:
        run.status = 'failed'
        run.error_code = 'no_enabled_items'
        finished_at_ms = clock_ms()
        config = MarketConfig.objects.get(pk=1)
        next_due_ms = finished_at_ms + randint(config.min_interval_seconds, config.max_interval_seconds) * 1000
        _finish_run(run, config_status=config.session_status, next_due_ms=next_due_ms, finished_at_ms=finished_at_ms)
        return run

    config_status = 'ready'
    retry_at_ms = None

    def collect_bundle(bundle, shared_lease):
        nonlocal config_status
        session = session_factory(bundle)
        def before_rpc():
            check_budget()
            _heartbeat_run(run, clock_ms())
            if shared_lease is not None:
                shared_lease.before_rpc()
            check_budget()
        if hasattr(session, 'set_before_rpc'):
            session.set_before_rpc(before_rpc)
        elif shared_lease is not None:
            raise CoordinationError()
        check_budget(SESSION_RESERVE_SECONDS)
        with session:
            for index, item in enumerate(items):
                try:
                    check_budget()
                    # `global` is the current API key for market region 8, not
                    # evidence that the game's region 8 is galaxy-wide.
                    if item.scope != 'global':
                        raise ValueError('unsupported_market_scope')
                    quote = session.quote(item.id, 8)
                    check_budget(FINISH_RESERVE_SECONDS)
                    _save_quote(run, item, quote, clock_ms())
                    run.success_count += 1
                except LeaseLost:
                    raise
                except RuntimeBudgetExceeded:
                    raise
                except NeedsAuthError:
                    raise
                except CoordinationError:
                    raise
                except (RateLimitedError, ServiceRejectedError):
                    raise
                except NetworkError as exc:
                    config_status = 'error'
                    _record_failure(run, item, clock_ms(), exc.code)
                    run.failure_count += 1
                    run.error_code = exc.code
                    break
                except Exception:
                    _record_failure(run, item, clock_ms())
                    run.failure_count += 1
                    run.error_code = 'item_error'
                    if getattr(session, 'sock', True) is None:
                        break
                if index < len(items) - 1:
                    delay = randint(QUERY_DELAY_MIN_MS, QUERY_DELAY_MAX_MS) / 1000
                    check_budget(RPC_RESERVE_SECONDS + delay)
                    sleep(delay)

    try:
        loaded = bundle_loader()
        if isinstance(loaded, dict):
            bundles = [loaded]
        elif isinstance(loaded, (list, tuple)):
            bundles = list(loaded)
        else:
            raise NeedsAuthError('No usable market session')
        if not bundles:
            raise NeedsAuthError('No usable market session')

        bundle, index = _select_bundle(run, bundles, now_ms)
        shared_lease = lease_factory('MARKET', index, len(bundles))
        if shared_lease is not None:
            # Four authentication RPCs count in the same account window as
            # item queries. Keep the shared policy unchanged for KM.
            permitted_items = min(FALLBACK_ITEMS_PER_RUN, MAX_ACCOUNT_RPCS - AUTH_RPC_COUNT)
            if permitted_items < 1:
                raise CoordinationError()
            if policy['configured_max_items_per_run'] > permitted_items:
                run._shared_budget_limited = True
                run.item_limit = min(run.item_limit, permitted_items)
                run.batch_fallback_reason = 'shared_budget'
                items = items[:run.item_limit]
                _save_plan(run, items, now_ms)
        with shared_lease if shared_lease is not None else nullcontext():
            try:
                collect_bundle(bundle, shared_lease)
                if shared_lease is not None and _complete(run):
                    shared_lease.complete()
            except NeedsAuthError as exc:
                if shared_lease is not None and exc.code != 'invalid_session':
                    shared_lease.pause_auth()
                raise
            except RateLimitedError:
                if shared_lease is not None:
                    retry_at_ms = shared_lease.pause_rate()
                raise
            except ServiceRejectedError:
                if shared_lease is not None:
                    shared_lease.pause_service()
                raise
    except LeaseLost:
        return None
    except RuntimeBudgetExceeded:
        config_status = 'error'
        run.status = 'partial' if run.success_count else 'failed'
        run.error_code = 'runtime_budget'
    except NeedsAuthError as exc:
        config_status = 'needs_auth'
        run.status = 'needs_auth'
        run.error_code = exc.code
    except RateLimitedError:
        config_status = 'cooldown'
        run.status, run.error_code = 'rate_limited', 'rate_limited'
    except ServiceRejectedError:
        config_status = 'blocked'
        run.status, run.error_code = 'failed', 'service_rejected'
    except CoordinationError as exc:
        run.error_code = exc.code
        if exc.code == 'unauthorized':
            config_status, run.status = 'needs_auth', 'needs_auth'
        elif exc.code == 'rate_limited':
            config_status, run.status = 'cooldown', 'rate_limited'
            retry_at_ms = getattr(exc, 'retry_at_ms', None)
        elif exc.code == 'service_rejected':
            config_status, run.status = 'blocked', 'failed'
        else:
            config_status = 'blocked' if exc.code == 'configuration_error' else 'error'
            run.status = 'partial' if run.success_count else 'failed'
    except NetworkError as exc:
        config_status = 'error'
        run.status = 'failed' if run.success_count == 0 else 'partial'
        run.error_code = exc.code
    except Exception:
        run.status = 'failed' if run.success_count == 0 else 'partial'
        run.error_code = 'collection_error'
    else:
        if not _complete(run):
            run.status = 'partial' if run.success_count else 'failed'
            if not run.error_code:
                run.error_code = 'incomplete_run'
        else:
            run.status = 'succeeded'

    finished_at_ms = clock_ms()
    config = MarketConfig.objects.get(pk=1)
    next_due_ms = None if config_status in ('needs_auth', 'blocked') else (
        finished_at_ms + randint(config.min_interval_seconds, config.max_interval_seconds) * 1000
    )
    if config_status == 'ready' and run.status == 'failed':
        config_status = 'error'
    _finish_run(run, config_status=config_status, next_due_ms=next_due_ms,
                finished_at_ms=finished_at_ms, retry_at_ms=retry_at_ms)
    return run
