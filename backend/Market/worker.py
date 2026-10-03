"""Run at most one due market collection in a short-lived process."""

import random
import time
import uuid
from contextlib import nullcontext

from django.db import transaction
from django.db.models import Q
from GameSessions.coordination import CoordinationError, account_lease
from GameSessions.rotation import round_robin

from .models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot, epoch_ms


LEASE_MS = 12 * 60 * 1000
QUERY_PACE_SECONDS = 1.0
MAX_ITEMS_PER_RUN = 40


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

        CollectionRun.objects.filter(status='running').filter(
            Q(lease_expires_at_ms__lte=now_ms) | Q(lease_expires_at_ms__isnull=True)
        ).update(
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
        config.session_status = config_status
        config.next_due_at_ms = next_due_ms
        config.updated_at_ms = finished_at_ms
        config.save(update_fields=['session_status', 'next_due_at_ms', 'updated_at_ms',
                                   'cooldown_until_ms', 'rate_failure_count'])
        run.finished_at_ms = finished_at_ms
        run.lease_owner = ''
        run.lease_expires_at_ms = None
        locked_run.status = run.status
        locked_run.finished_at_ms = run.finished_at_ms
        locked_run.success_count = run.success_count
        locked_run.failure_count = run.failure_count
        locked_run.error_code = run.error_code
        locked_run.lease_owner = ''
        locked_run.lease_expires_at_ms = None
        locked_run.save(update_fields=[
            'status', 'finished_at_ms', 'success_count', 'failure_count',
            'error_code', 'lease_owner', 'lease_expires_at_ms',
        ])


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
                randint=random.randint, sleep=time.sleep, lease_factory=account_lease):
    """Collect due prices once; injected I/O lets tests exercise the DB path."""
    from .session_bundle import NeedsAuthError
    from .collector_protocol import NetworkError, RateLimitedError, ServiceRejectedError
    if bundle_loader is None:
        from .session_bundle import load_session_pool
        bundle_loader = load_session_pool
    if session_factory is None:
        from .collector_protocol import MarketSession
        session_factory = MarketSession

    now_ms = clock_ms()
    run = _claim_run(now_ms)
    if run is None:
        return None

    items = list(
        MarketItem.objects.filter(enabled=True)
        .order_by('last_attempt_at_ms', 'id')[:MAX_ITEMS_PER_RUN]
    )
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
            _heartbeat_run(run, clock_ms())
            if shared_lease is not None:
                shared_lease.before_rpc()
        if hasattr(session, 'set_before_rpc'):
            session.set_before_rpc(before_rpc)
        elif shared_lease is not None:
            raise CoordinationError()
        with session:
            for index, item in enumerate(items):
                try:
                    # `global` is the current API key for market region 8, not
                    # evidence that the game's region 8 is galaxy-wide.
                    if item.scope != 'global':
                        raise ValueError('unsupported_market_scope')
                    quote = session.quote(item.id, 8)
                    _save_quote(run, item, quote, clock_ms())
                    run.success_count += 1
                except LeaseLost:
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
                    sleep(QUERY_PACE_SECONDS)

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
        with shared_lease if shared_lease is not None else nullcontext():
            try:
                collect_bundle(bundle, shared_lease)
                if shared_lease is not None and run.failure_count == 0:
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
            run.status = 'failed'
    except NetworkError as exc:
        config_status = 'error'
        run.status = 'failed' if run.success_count == 0 else 'partial'
        run.error_code = exc.code
    except Exception:
        run.status = 'failed' if run.success_count == 0 else 'partial'
        run.error_code = 'collection_error'
    else:
        if run.failure_count:
            run.status = 'partial' if run.success_count else 'failed'
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
