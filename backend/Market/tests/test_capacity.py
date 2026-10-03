"""Capacity regressions with virtual time, synthetic sessions and isolated DBs."""

from decimal import Decimal
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.test import TestCase

from GameSessions.coordination import (
    AccountBudgetExhausted, Coordinator, MAX_ACCOUNT_RPCS, provision,
)
from Market.collector_protocol import NetworkError, ProtocolTimeout, RateLimitedError
from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot
from Market.session_bundle import AuthenticationRejected
from Market.tests.test_worker import Quote


SIX_HOURS_MS = 6 * 60 * 60 * 1000


class VirtualClock:
    def __init__(self, start_ms=1000, *, delay_ms=None, longest_interval=False):
        self.start_ms = start_ms
        self.elapsed = 0.0
        self.delay_ms = delay_ms
        self.longest_interval = longest_interval
        self.sleeps = []
        self.delay_draws = []
        self.interval_draws = []

    def clock_ms(self):
        return self.start_ms + int(self.elapsed * 1000)

    def monotonic(self):
        return self.elapsed

    def advance(self, seconds):
        self.elapsed += seconds

    def sleep(self, seconds):
        started = self.elapsed
        self.advance(seconds)
        self.sleeps.append((started, seconds, self.elapsed))

    def randint(self, low, high):
        if (low, high) == (2000, 3000):
            value = self.delay_ms
            if value is None:
                value = low if len(self.delay_draws) % 2 == 0 else high
            self.delay_draws.append((low, high, value))
            return value
        if (low, high) == (2100, 3060):
            value = high if self.longest_interval else low
            self.interval_draws.append((low, high, value))
            return value
        raise AssertionError(f'Unexpected random bounds: {(low, high)}')


class SyntheticSocket:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class TimedSession:
    """Model four auth RPCs and synchronous quote replies without network I/O."""

    def __init__(self, clock, *, quotes=None, quote_seconds=0.25,
                 startup_seconds=0, entry_error=None, on_quote=None,
                 disconnect_on=None):
        self.clock = clock
        self.quotes = quotes or {}
        self.quote_seconds = quote_seconds
        self.startup_seconds = startup_seconds
        self.entry_error = entry_error
        self.on_quote = on_quote
        self.disconnect_on = disconnect_on
        self.before_rpc = None
        self.connection = SyntheticSocket()
        self.sock = None
        self.entered = False
        self.closed = False
        self.auth_rpcs = 0
        self.queries = []
        self.timeline = []
        self.active_queries = 0
        self.max_active_queries = 0

    def set_before_rpc(self, callback):
        self.before_rpc = callback

    def __enter__(self):
        self.entered = True
        self.sock = self.connection
        try:
            self.clock.advance(self.startup_seconds)
            if self.entry_error is not None:
                raise self.entry_error
            for _ in range(4):
                if self.before_rpc is not None:
                    self.before_rpc()
                self.auth_rpcs += 1
            return self
        except Exception:
            self.__exit__(None, None, None)
            raise

    def __exit__(self, *_args):
        self.connection.close()
        self.sock = None
        self.closed = True

    def quote(self, item_id, scope):
        if self.before_rpc is not None:
            self.before_rpc()
        started = self.clock.elapsed
        self.queries.append((item_id, scope))
        self.active_queries += 1
        self.max_active_queries = max(self.max_active_queries, self.active_queries)
        try:
            if self.on_quote is not None:
                self.on_quote(item_id, len(self.queries))
            self.clock.advance(self.quote_seconds)
            if item_id == self.disconnect_on:
                self.connection.close()
                self.sock = None
                raise RuntimeError('Synthetic private transport diagnostic')
            answer = self.quotes.get(item_id, Quote(best_sell=Decimal('5.00'), sell_count=1))
            if isinstance(answer, Exception):
                raise answer
            return answer
        finally:
            self.timeline.append((item_id, started, self.clock.elapsed))
            self.active_queries -= 1


class SyntheticLease:
    def __init__(self, clock, *, rpc_limit=44, before_rpc=None):
        self.clock = clock
        self.rpc_limit = rpc_limit
        self.on_rpc = before_rpc
        self.rpc_count = 0
        self.rpc_attempts = 0
        self.closed = False
        self.completions = 0
        self.auth_pauses = 0
        self.rate_pauses = 0

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.closed = True

    def before_rpc(self):
        self.rpc_attempts += 1
        if self.on_rpc is not None:
            self.on_rpc(self)
        if self.rpc_count >= self.rpc_limit:
            raise AccountBudgetExhausted()
        self.rpc_count += 1

    def complete(self):
        self.completions += 1

    def pause_auth(self):
        self.auth_pauses += 1

    def pause_rate(self):
        self.rate_pauses += 1
        return self.clock.clock_ms() + 15 * 60 * 1000


class MarketCapacityTests(TestCase):
    def setUp(self):
        self.config = MarketConfig.objects.create(next_due_at_ms=1000)

    def make_items(self, count):
        MarketItem.objects.bulk_create([
            MarketItem(id=item_id, name=f'Synthetic item {item_id}', scope='global')
            for item_id in range(1, count + 1)
        ])

    def collect(self, clock, session, *, pool=None, lease=None, bundle_loader=None,
                factory=None):
        from Market.worker import collect_due

        with patch('socket.create_connection', side_effect=AssertionError('No real network in capacity tests')):
            return collect_due(
                clock_ms=clock.clock_ms, monotonic=clock.monotonic,
                bundle_loader=bundle_loader or (lambda: pool or {'synthetic': True}),
                session_factory=factory or (lambda _bundle: session),
                randint=clock.randint, sleep=clock.sleep,
                lease_factory=lambda *_args: lease,
            )

    def next_clock(self, **kwargs):
        self.config.refresh_from_db()
        return VirtualClock(self.config.next_due_at_ms, **kwargs)

    def assert_successful_plan(self, run, count, limit):
        run.refresh_from_db()
        self.assertEqual((run.status, run.success_count, run.failure_count), ('succeeded', count, 0))
        self.assertEqual((run.item_limit, run.expected_count), (limit, count))
        self.assertEqual(PriceSnapshot.objects.filter(run=run).count(), count)
        self.assertEqual(PriceSnapshot.objects.filter(run=run).values('item_id').distinct().count(), count)
        self.assertEqual(run.lease_owner, '')
        self.assertIsNone(run.lease_expires_at_ms)

    def test_default_eighty_items_use_one_session_and_seventy_nine_post_reply_delays(self):
        self.make_items(131)
        clock = VirtualClock()
        session = TimedSession(clock, quote_seconds=0.75, startup_seconds=5)
        opened = []
        plans = []

        def factory(bundle):
            opened.append(bundle)
            plans.append(CollectionRun.objects.get(status='running'))
            return session

        run = self.collect(clock, session, pool=[{'slot': name} for name in ('a', 'b', 'c')], factory=factory)

        self.assertEqual(self.config.max_items_per_run, 80)
        self.assert_successful_plan(run, 80, 80)
        self.assertEqual(opened, [{'slot': 'a'}])
        self.assertEqual((plans[0].item_limit, plans[0].expected_count), (80, 80))
        self.assertEqual(session.queries, [(item_id, 8) for item_id in range(1, 81)])
        self.assertEqual(session.auth_rpcs, 4)
        self.assertEqual(session.max_active_queries, 1)
        self.assertTrue(session.connection.closed)
        self.assertEqual(len(clock.sleeps), 79)
        self.assertEqual(len(clock.delay_draws), 79)
        self.assertEqual({draw[2] for draw in clock.delay_draws}, {2000, 3000})
        for previous, delay, following in zip(session.timeline, clock.sleeps, session.timeline[1:]):
            self.assertEqual(delay[0], previous[2])
            self.assertIn(delay[1], (2.0, 3.0))
            self.assertEqual(following[1], delay[2])
        self.assertEqual(run.finished_at_ms, clock.clock_ms())
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, run.finished_at_ms + 2100 * 1000)
        self.assertIsNone(self.config.batch_fallback_until_ms)
        self.assertEqual(LatestPrice.objects.count(), 80)
        self.assertEqual(MarketItem.objects.filter(last_attempt_at_ms__isnull=True).count(), 51)

    def test_explicit_forty_items_have_thirty_nine_delays_and_keep_fifty_one_minute_interval(self):
        self.make_items(80)
        self.config.max_items_per_run = 40
        self.config.save()
        clock = VirtualClock(longest_interval=True)
        session = TimedSession(clock)

        run = self.collect(clock, session)

        self.assert_successful_plan(run, 40, 40)
        self.assertEqual(len(clock.sleeps), 39)
        self.assertTrue(all(2 <= delay[1] <= 3 for delay in clock.sleeps))
        self.assertEqual(run.batch_fallback_reason, '')
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, run.finished_at_ms + 3060 * 1000)
        self.assertEqual(self.config.max_items_per_run, 40)
        self.assertIsNone(self.config.batch_fallback_until_ms)

    def test_two_rounds_cover_all_one_hundred_thirty_one_items_oldest_first(self):
        self.make_items(131)
        first_clock = VirtualClock()
        first_session = TimedSession(first_clock)
        first = self.collect(first_clock, first_session)
        second_clock = self.next_clock()
        second_session = TimedSession(second_clock)
        second = self.collect(second_clock, second_session)

        self.assert_successful_plan(first, 80, 80)
        self.assert_successful_plan(second, 80, 80)
        self.assertEqual([item for item, _ in second_session.queries], list(range(81, 132)) + list(range(1, 30)))
        self.assertEqual(LatestPrice.objects.count(), 131)
        self.assertEqual(PriceSnapshot.objects.count(), 160)
        self.assertFalse(MarketItem.objects.filter(last_attempt_at_ms__isnull=True).exists())

    def test_plan_is_fixed_before_loading_material_and_never_reselects_items_mid_run(self):
        self.make_items(131)
        clock = VirtualClock()
        loaded_plans = []

        def load_bundle():
            loaded_plans.append(CollectionRun.objects.get(status='running'))
            return {'synthetic': True}

        def change_catalog(_item_id, query_count):
            if query_count == 1:
                MarketItem.objects.filter(pk=81).update(last_attempt_at_ms=-1)
                MarketItem.objects.create(id=132, name='New synthetic item')

        session = TimedSession(clock, on_quote=change_catalog)
        run = self.collect(clock, session, bundle_loader=load_bundle)

        self.assert_successful_plan(run, 80, 80)
        self.assertEqual((loaded_plans[0].item_limit, loaded_plans[0].expected_count), (80, 80))
        self.assertEqual([item for item, _ in session.queries], list(range(1, 81)))
        self.assertEqual(len(set(session.queries)), 80)
        self.assertFalse(PriceSnapshot.objects.filter(run=run, item_id__in=(81, 132)).exists())

    def test_smaller_enabled_catalog_succeeds_only_for_its_actual_expected_count(self):
        self.make_items(7)
        MarketItem.objects.filter(pk__gt=3).update(enabled=False)
        clock = VirtualClock()
        session = TimedSession(clock)

        run = self.collect(clock, session)

        self.assert_successful_plan(run, 3, 80)
        self.assertEqual(session.queries, [(1, 8), (2, 8), (3, 8)])
        self.assertEqual(len(clock.sleeps), 2)

    def test_active_lease_does_not_open_material_or_a_second_eighty_item_run(self):
        self.make_items(131)
        CollectionRun.objects.create(trigger='scheduled', status='running', lease_owner='other',
                                     lease_expires_at_ms=5000)
        clock = VirtualClock()
        session = TimedSession(clock)
        loaded = []

        result = self.collect(clock, session, bundle_loader=lambda: loaded.append(True))

        self.assertIsNone(result)
        self.assertEqual(loaded, [])
        self.assertFalse(session.entered)
        self.assertFalse(PriceSnapshot.objects.exists())
        self.assertEqual(CollectionRun.objects.count(), 1)

    def test_lost_lease_after_first_reply_stops_before_next_rpc_and_retains_saved_quote(self):
        self.make_items(80)
        clock = VirtualClock()
        session = TimedSession(clock)
        original_sleep = clock.sleep

        def lose_lease(seconds):
            original_sleep(seconds)
            CollectionRun.objects.filter(status='running').update(lease_owner='replacement')

        clock.sleep = lose_lease
        result = self.collect(clock, session)

        self.assertIsNone(result)
        self.assertEqual(session.queries, [(1, 8)])
        self.assertEqual(PriceSnapshot.objects.count(), 1)
        self.assertEqual(LatestPrice.objects.count(), 1)
        self.assertTrue(session.connection.closed)
        self.assertIsNone(MarketItem.objects.get(pk=2).last_attempt_at_ms)
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, 1000)
        self.assertEqual(CollectionRun.objects.get().lease_owner, 'replacement')

    def test_deadline_preserves_thirty_eight_replies_and_immediately_falls_back_for_six_hours(self):
        self.make_items(131)
        clock = VirtualClock(delay_ms=2000)
        session = TimedSession(clock, quote_seconds=10)

        run = self.collect(clock, session)

        run.refresh_from_db()
        self.assertEqual((run.status, run.error_code), ('partial', 'runtime_budget'))
        self.assertEqual((run.item_limit, run.expected_count, run.success_count), (80, 80, 38))
        self.assertEqual(len(session.queries), 38)
        self.assertEqual(PriceSnapshot.objects.filter(run=run).count(), 38)
        self.assertEqual(LatestPrice.objects.count(), 38)
        self.assertIsNone(MarketItem.objects.get(pk=39).last_attempt_at_ms)
        self.assertLessEqual(clock.elapsed, 460)
        self.assertTrue(session.connection.closed)
        self.config.refresh_from_db()
        until = run.finished_at_ms + SIX_HOURS_MS
        self.assertEqual((self.config.batch_fallback_reason, self.config.batch_fallback_until_ms),
                         ('runtime_budget', until))
        self.assertEqual(self.config.max_items_per_run, 80)

        healthy_clock = self.next_clock()
        healthy_session = TimedSession(healthy_clock)
        healthy = self.collect(healthy_clock, healthy_session)
        self.assert_successful_plan(healthy, 40, 40)
        self.assertEqual(healthy.batch_fallback_reason, 'runtime_budget')
        self.assertEqual([item for item, _ in healthy_session.queries], list(range(39, 79)))
        self.config.refresh_from_db()
        self.assertEqual(self.config.batch_fallback_until_ms, until)

        self.config.next_due_at_ms = until
        self.config.save()
        restored_clock = VirtualClock(until)
        restored_session = TimedSession(restored_clock)
        restored = self.collect(restored_clock, restored_session)
        self.assert_successful_plan(restored, 80, 80)
        self.assertEqual([item for item, _ in restored_session.queries[:53]], list(range(79, 132)))
        self.assertEqual(len(set(restored_session.queries)), 80)
        self.assertEqual(restored.batch_fallback_reason, '')
        self.config.refresh_from_db()
        self.assertIsNone(self.config.batch_fallback_until_ms)
        self.assertEqual(self.config.batch_fallback_reason, '')

    def test_deadline_reserves_startup_and_finish_time_before_opening_the_socket(self):
        self.make_items(80)
        clock = VirtualClock()
        session = TimedSession(clock)

        def slow_material_load():
            clock.advance(441)
            return {'synthetic': True}

        run = self.collect(clock, session, bundle_loader=slow_material_load)

        self.assertEqual((run.status, run.error_code), ('failed', 'runtime_budget'))
        self.assertEqual((run.expected_count, run.success_count), (80, 0))
        self.assertFalse(session.entered)
        self.assertFalse(PriceSnapshot.objects.exists())
        self.assertFalse(MarketItem.objects.filter(last_attempt_at_ms__isnull=False).exists())
        self.config.refresh_from_db()
        self.assertEqual(self.config.batch_fallback_until_ms, run.finished_at_ms + SIX_HOURS_MS)

    def test_deadline_is_rechecked_after_shared_coordinator_wait_before_rpc_send(self):
        self.make_items(80)
        clock = VirtualClock()
        session = TimedSession(clock)
        lease = SyntheticLease(clock, before_rpc=lambda _lease: clock.advance(451))

        run = self.collect(clock, session, lease=lease)

        self.assertEqual((run.status, run.error_code), ('failed', 'runtime_budget'))
        self.assertEqual((run.item_limit, run.expected_count), (40, 40))
        self.assertEqual(lease.rpc_attempts, 1)
        self.assertEqual(session.auth_rpcs, 0)
        self.assertEqual(session.queries, [])
        self.assertEqual(lease.completions, 0)
        self.assertTrue(session.connection.closed)
        self.assertTrue(lease.closed)
        self.assertFalse(PriceSnapshot.objects.exists())
        self.config.refresh_from_db()
        self.assertEqual(self.config.batch_fallback_reason, 'runtime_budget')

    def test_two_consecutive_network_timeout_or_budget_failures_trigger_forty_item_fallback(self):
        self.make_items(81)
        for case_index, error_type in enumerate((NetworkError, ProtocolTimeout, AccountBudgetExhausted)):
            with self.subTest(code=error_type.code):
                self.config.refresh_from_db()
                self.config.next_due_at_ms = 1000 + case_index * 100000000
                self.config.session_status = 'ready'
                self.config.batch_fallback_until_ms = None
                self.config.batch_fallback_reason = ''
                self.config.capacity_failure_count = 0
                self.config.save()
                first_clock = VirtualClock(self.config.next_due_at_ms)
                first = self.collect(first_clock, TimedSession(first_clock, entry_error=error_type()))
                self.config.refresh_from_db()
                self.assertEqual((first.status, first.error_code), ('failed', error_type.code))
                self.assertEqual(self.config.capacity_failure_count, 1)
                self.assertIsNone(self.config.batch_fallback_until_ms)

                second_clock = self.next_clock()
                second = self.collect(second_clock, TimedSession(second_clock, entry_error=error_type()))
                self.config.refresh_from_db()
                until = second.finished_at_ms + SIX_HOURS_MS
                self.assertEqual((self.config.capacity_failure_count, self.config.batch_fallback_reason,
                                  self.config.batch_fallback_until_ms), (2, error_type.code, until))
                healthy_clock = self.next_clock()
                healthy = self.collect(healthy_clock, TimedSession(healthy_clock))
                self.assert_successful_plan(healthy, 40, 40)
                self.assertEqual(healthy.batch_fallback_reason, error_type.code)
                self.config.refresh_from_db()
                self.assertEqual(self.config.capacity_failure_count, 0)
                self.assertEqual(self.config.batch_fallback_until_ms, until)

    def test_success_between_network_failures_resets_the_consecutive_failure_counter(self):
        self.make_items(81)
        clock = VirtualClock()
        self.collect(clock, TimedSession(clock, entry_error=NetworkError()))
        healthy_clock = self.next_clock()
        healthy = self.collect(healthy_clock, TimedSession(healthy_clock))
        self.assert_successful_plan(healthy, 80, 80)
        failing_clock = self.next_clock()
        self.collect(failing_clock, TimedSession(failing_clock, entry_error=ProtocolTimeout()))

        self.config.refresh_from_db()
        self.assertEqual(self.config.capacity_failure_count, 1)
        self.assertIsNone(self.config.batch_fallback_until_ms)

    def test_real_shared_account_budget_keeps_four_auth_plus_forty_quote_rpc_limit(self):
        self.make_items(131)
        clock = VirtualClock()
        session = TimedSession(clock)
        observed_plans = []

        def factory(_bundle):
            observed_plans.append(CollectionRun.objects.get(status='running'))
            return session

        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'synthetic-shared.sqlite3'
            provision(path)
            coordinator = Coordinator(path, clock_ms=clock.clock_ms, sleep=clock.advance)
            run = self.collect(clock, session, lease=coordinator.lease('synthetic-shared'), factory=factory)
            with coordinator.transaction() as db:
                row = db.execute('SELECT rpc_count, owner FROM accounts').fetchone()
                self.assertEqual((row['rpc_count'], row['owner']), (44, ''))

        self.assertEqual(MAX_ACCOUNT_RPCS, 44)
        self.assert_successful_plan(run, 40, 40)
        self.assertEqual((observed_plans[0].item_limit, observed_plans[0].expected_count,
                          observed_plans[0].batch_fallback_reason), (40, 40, 'shared_budget'))
        self.assertEqual(run.batch_fallback_reason, 'shared_budget')
        self.assertEqual(session.auth_rpcs + len(session.queries), 44)
        self.assertEqual(len(clock.sleeps), 39)
        self.assertTrue(session.connection.closed)
        self.config.refresh_from_db()
        self.assertEqual(self.config.max_items_per_run, 80)
        self.assertEqual(self.config.batch_fallback_reason, 'shared_budget')
        self.assertEqual(self.config.batch_fallback_until_ms, run.finished_at_ms + SIX_HOURS_MS)

    def test_removing_shared_mapping_does_not_extend_historical_fallback_and_restores_eighty_at_expiry(self):
        self.make_items(131)
        clock = VirtualClock()
        limited = self.collect(clock, TimedSession(clock), lease=SyntheticLease(clock))
        self.assert_successful_plan(limited, 40, 40)
        self.config.refresh_from_db()
        until = self.config.batch_fallback_until_ms

        unshared_clock = self.next_clock()
        unshared_session = TimedSession(unshared_clock)
        unshared = self.collect(unshared_clock, unshared_session)
        self.assert_successful_plan(unshared, 40, 40)
        self.assertEqual(unshared.batch_fallback_reason, 'shared_budget')
        self.assertEqual([item for item, _ in unshared_session.queries], list(range(41, 81)))
        self.config.refresh_from_db()
        self.assertEqual(self.config.batch_fallback_until_ms, until)

        self.config.next_due_at_ms = until
        self.config.save()
        restored_clock = VirtualClock(until)
        restored_session = TimedSession(restored_clock)
        restored = self.collect(restored_clock, restored_session)
        self.assert_successful_plan(restored, 80, 80)
        self.assertEqual([item for item, _ in restored_session.queries], list(range(81, 132)) + list(range(1, 30)))
        self.assertEqual(restored.batch_fallback_reason, '')
        self.config.refresh_from_db()
        self.assertIsNone(self.config.batch_fallback_until_ms)

    def test_shared_budget_exhaustion_after_partial_results_is_never_reported_as_success(self):
        self.make_items(80)
        clock = VirtualClock()
        session = TimedSession(clock)
        lease = SyntheticLease(clock, rpc_limit=7)
        opened = []

        def factory(bundle):
            opened.append(bundle)
            return session

        run = self.collect(clock, session, lease=lease, pool=[{'slot': 'a'}, {'slot': 'b'}], factory=factory)

        run.refresh_from_db()
        self.assertEqual((run.status, run.error_code, run.success_count, run.failure_count),
                         ('partial', 'budget_exhausted', 3, 0))
        self.assertEqual((run.item_limit, run.expected_count), (40, 40))
        self.assertEqual(opened, [{'slot': 'a'}])
        self.assertEqual(session.queries, [(1, 8), (2, 8), (3, 8)])
        self.assertEqual(PriceSnapshot.objects.filter(run=run).count(), 3)
        self.assertIsNone(MarketItem.objects.get(pk=4).last_attempt_at_ms)
        self.assertEqual(lease.completions, 0)
        self.assertTrue(session.connection.closed)
        self.assertTrue(lease.closed)

    def test_authentication_and_rate_rejections_stop_without_switching_to_another_account(self):
        self.make_items(80)
        for error_type, status in ((AuthenticationRejected, 'needs_auth'), (RateLimitedError, 'rate_limited')):
            with self.subTest(code=error_type.code):
                self.config.refresh_from_db()
                self.config.next_due_at_ms = 1000
                self.config.session_status = 'ready'
                self.config.cooldown_until_ms = None
                self.config.session_cursor = 0
                self.config.save()
                clock = VirtualClock()
                session = TimedSession(clock, quotes={1: error_type()})
                opened = []

                def factory(bundle):
                    opened.append(bundle)
                    return session

                run = self.collect(clock, session, pool=[{'slot': 'a'}, {'slot': 'b'}], factory=factory)
                self.assertEqual((run.status, run.error_code), (status, error_type.code))
                self.assertEqual(opened, [{'slot': 'a'}])
                self.assertEqual(session.queries, [(1, 8)])
                self.assertEqual(run.expected_count, 80)
                self.assertFalse(PriceSnapshot.objects.exists())
                self.config.refresh_from_db()
                self.assertEqual(self.config.capacity_failure_count, 0)
                self.assertIsNone(self.config.batch_fallback_until_ms)
                stopped_clock = VirtualClock(1001)
                if status == 'rate_limited':
                    queued = CollectionRun.objects.create(trigger='manual', status='queued')
                    self.assertGreater(self.config.cooldown_until_ms, stopped_clock.clock_ms())
                else:
                    self.assertIsNone(self.config.next_due_at_ms)
                self.assertIsNone(self.collect(stopped_clock, TimedSession(stopped_clock), factory=factory))
                self.assertEqual(opened, [{'slot': 'a'}])
                if status == 'rate_limited':
                    queued.refresh_from_db()
                    self.assertEqual(queued.status, 'queued')

    def test_disconnect_keeps_saved_prices_and_leaves_unqueried_items_for_next_cycle(self):
        self.make_items(131)
        clock = VirtualClock()
        session = TimedSession(clock, disconnect_on=3)

        failed = self.collect(clock, session)

        self.assertEqual((failed.status, failed.success_count, failed.failure_count), ('partial', 2, 1))
        self.assertEqual(failed.expected_count, 80)
        self.assertEqual(session.queries, [(1, 8), (2, 8), (3, 8)])
        self.assertEqual(PriceSnapshot.objects.filter(run=failed).count(), 2)
        self.assertIsNone(MarketItem.objects.get(pk=4).last_attempt_at_ms)
        self.assertIsNotNone(MarketItem.objects.get(pk=3).last_attempt_at_ms)
        self.assertTrue(session.connection.closed)
        self.assertNotIn('private', failed.error_code)

        recovered_clock = self.next_clock()
        recovered_session = TimedSession(recovered_clock)
        recovered = self.collect(recovered_clock, recovered_session)
        self.assert_successful_plan(recovered, 80, 80)
        self.assertEqual([item for item, _ in recovered_session.queries], list(range(4, 84)))
        self.assertEqual(len(set(recovered_session.queries)), 80)

    def test_expired_run_lease_recovery_uses_forty_items_without_renewing_its_six_hour_fallback(self):
        self.make_items(131)
        stale = CollectionRun.objects.create(trigger='scheduled', status='running', lease_owner='stale',
                                             lease_expires_at_ms=999)
        clock = VirtualClock()
        run = self.collect(clock, TimedSession(clock))

        stale.refresh_from_db()
        self.assertEqual((stale.status, stale.error_code), ('failed', 'lease_expired'))
        self.assert_successful_plan(run, 40, 40)
        self.assertEqual(run.batch_fallback_reason, 'lease_expired')
        self.config.refresh_from_db()
        self.assertEqual(self.config.batch_fallback_until_ms, 1000 + SIX_HOURS_MS)
        self.assertEqual(self.config.max_items_per_run, 80)
        self.assertEqual(CollectionRun.objects.filter(status='running').count(), 0)
