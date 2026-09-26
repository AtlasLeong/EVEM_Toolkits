from contextlib import nullcontext
from decimal import Decimal
from io import StringIO
import os
from unittest.mock import patch

from django.core.management import call_command
from django.db import connection
from django.test import TestCase, TransactionTestCase

from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot
from Market.session_bundle import NeedsAuthError


class FakeSession:
    def __init__(self, quotes):
        self.quotes = quotes
        self.queries = []
        self.closed = False

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.closed = True

    def quote(self, item_id, scope):
        self.queries.append((item_id, scope))
        answer = self.quotes[item_id]
        if isinstance(answer, Exception):
            raise answer
        return answer


class Quote:
    def __init__(self, *, best_buy=None, best_sell=None, buy_count=0, sell_count=0,
                 buy_prices=(), sell_prices=()):
        self.best_buy = best_buy
        self.best_sell = best_sell
        self.buy_count = buy_count
        self.sell_count = sell_count
        self.buy_prices = buy_prices
        self.sell_prices = sell_prices


class MarketWorkerTests(TestCase):
    def setUp(self):
        self.config = MarketConfig.objects.create(next_due_at_ms=1000)
        self.first = MarketItem.objects.create(id=1, name='Item 1', scope='global')
        self.second = MarketItem.objects.create(id=2, name='Item 2', scope='global')

    def test_not_due_does_not_open_a_game_session(self):
        from Market.worker import collect_due

        sessions = []

        def factory(bundle):
            sessions.append(bundle)
            return FakeSession({})

        result = collect_due(
            clock_ms=lambda: 999,
            bundle_loader=lambda: {'fixture': True},
            session_factory=factory,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertIsNone(result)
        self.assertEqual(sessions, [])
        self.assertFalse(CollectionRun.objects.exists())

    def test_due_run_collects_items_in_one_session_and_schedules_from_finish(self):
        from Market.worker import collect_due

        now = iter((1000, 2000, 3000, 4000))
        session = FakeSession({
            1: Quote(
                best_buy=Decimal('5.50'), best_sell=Decimal('7.25'), buy_count=2, sell_count=3,
                buy_prices=(Decimal('5.50'), Decimal('5.25')),
                sell_prices=(Decimal('7.25'), Decimal('7.50')),
            ),
            2: Quote(best_sell=Decimal('11.00'), sell_count=1),
        })
        opened = []

        def factory(bundle):
            opened.append(bundle)
            return session

        run = collect_due(
            clock_ms=lambda: next(now),
            bundle_loader=lambda: {'fixture': True},
            session_factory=factory,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertIsNotNone(run)
        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(run.success_count, 2)
        self.assertEqual(run.failure_count, 0)
        self.assertEqual(opened, [{'fixture': True}])
        self.assertTrue(session.closed)
        self.assertEqual(session.queries, [(1, 8), (2, 8)])
        self.assertEqual(PriceSnapshot.objects.count(), 2)
        self.assertEqual(LatestPrice.objects.count(), 2)
        self.assertEqual(LatestPrice.objects.get(item=self.first).snapshot.best_buy, Decimal('5.50'))
        self.assertIsNone(LatestPrice.objects.get(item=self.second).snapshot.best_buy)
        self.assertEqual(PriceSnapshot.objects.get(item=self.first).sell_prices, ['7.25', '7.50'])
        self.assertEqual(PriceSnapshot.objects.get(item=self.first).buy_prices, ['5.50', '5.25'])
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, 4000 + 2100 * 1000)

    def test_failed_item_does_not_block_following_item(self):
        from Market.worker import collect_due

        session = FakeSession({
            1: ValueError('do not expose this fixture message'),
            2: Quote(best_buy=Decimal('12.00'), buy_count=1),
        })
        run = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: {'fixture': True},
            session_factory=lambda bundle: session,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertIsNotNone(run)
        self.assertEqual(run.status, 'partial')
        self.assertEqual(run.success_count, 1)
        self.assertEqual(run.failure_count, 1)
        self.assertEqual(PriceSnapshot.objects.count(), 1)
        self.assertEqual(PriceSnapshot.objects.get().item_id, 2)
        self.assertNotIn('fixture message', run.error_code)

    def test_broken_connection_does_not_mark_unqueried_items_attempted(self):
        from Market.worker import collect_due

        class DisconnectSession(FakeSession):
            sock = object()

            def quote(self, item_id, scope):
                self.queries.append((item_id, scope))
                if item_id == 1:
                    self.sock = None
                    raise RuntimeError('broken connection')
                return Quote(best_sell=Decimal('6.00'))

        session = DisconnectSession({})
        run = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: {'fixture': True},
            session_factory=lambda bundle: session,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.second.refresh_from_db()
        self.assertEqual(run.status, 'failed')
        self.assertEqual(run.failure_count, 1)
        self.assertEqual(session.queries, [(1, 8)])
        self.assertIsNone(self.second.last_attempt_at_ms)

    def test_running_lease_prevents_another_collection(self):
        from Market.worker import collect_due

        CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='other', lease_expires_at_ms=5000,
        )
        opened = []
        run = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: opened.append('bundle'),
            session_factory=lambda bundle: opened.append('session'),
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertIsNone(run)
        self.assertEqual(opened, [])

    def test_tick_command_reports_idle_without_contacting_game(self):
        self.config.next_due_at_ms = 9999999999999
        self.config.save()
        output = StringIO()

        with patch('Market.management.commands.market_tick.collector_guard', return_value=nullcontext()):
            with patch('Market.management.commands.market_tick.running_backend_matches_current', return_value=True):
                call_command('market_tick', stdout=output)

        self.assertIn('idle', output.getvalue())
        self.assertFalse(CollectionRun.objects.exists())

    def test_tick_command_does_not_collect_when_release_lock_is_busy(self):
        from Market.deploy_guard import CollectorBusy

        output = StringIO()
        with patch.dict(os.environ, {'MARKET_DEPLOY_ROOT': '/test/deploy'}):
            with patch('Market.management.commands.market_tick.collector_guard', side_effect=CollectorBusy(), create=True):
                call_command('market_tick', stdout=output)

        self.assertIn('busy', output.getvalue())
        self.assertFalse(CollectionRun.objects.exists())

    def test_tick_command_does_not_run_old_release_after_link_switch(self):
        output = StringIO()
        with patch.dict(os.environ, {'MARKET_DEPLOY_ROOT': '/test/deploy'}):
            with patch('Market.management.commands.market_tick.collector_guard', return_value=nullcontext()):
                with patch('Market.management.commands.market_tick.running_backend_matches_current', return_value=False, create=True):
                    call_command('market_tick', stdout=output)

        self.assertIn('stale', output.getvalue())
        self.assertFalse(CollectionRun.objects.exists())

    def test_missing_session_marks_needs_auth_without_repeated_attempts(self):
        from Market.worker import collect_due

        opened = []

        def missing_bundle():
            raise NeedsAuthError('needs_auth')

        run = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=missing_bundle,
            session_factory=lambda bundle: opened.append(bundle),
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertEqual(run.status, 'needs_auth')
        self.assertEqual(run.error_code, 'needs_auth')
        self.assertEqual(opened, [])
        self.config.refresh_from_db()
        self.assertEqual(self.config.session_status, 'needs_auth')
        self.assertIsNone(self.config.next_due_at_ms)
        self.assertIsNone(collect_due(
            clock_ms=lambda: 2000,
            bundle_loader=missing_bundle,
            session_factory=lambda bundle: opened.append(bundle),
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        ))
        self.assertEqual(CollectionRun.objects.count(), 1)

    def test_auth_failure_in_one_session_falls_back_to_another_session(self):
        from Market.worker import collect_due

        opened = []
        usable = FakeSession({1: Quote(best_sell=Decimal('5.00')), 2: Quote(best_sell=Decimal('6.00'))})

        class RejectedSession:
            def __enter__(self):
                raise NeedsAuthError('session rejected')

            def __exit__(self, exc_type, exc, traceback):
                return False

        def factory(bundle):
            opened.append(bundle)
            return RejectedSession() if bundle['name'] == 'bad' else usable

        run = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: [{'name': 'bad'}, {'name': 'good'}],
            session_factory=factory,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertEqual(run.status, 'succeeded')
        self.assertEqual(opened, [{'name': 'bad'}, {'name': 'good'}])
        self.assertEqual(run.success_count, 2)
        self.config.refresh_from_db()
        self.assertEqual(self.config.session_status, 'ready')

    def test_expired_lease_is_marked_failed_before_new_run(self):
        from Market.worker import collect_due

        expired = CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='old', lease_expires_at_ms=999,
        )
        session = FakeSession({
            1: Quote(best_sell=Decimal('5.00')),
            2: Quote(best_sell=Decimal('6.00')),
        })

        fresh = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: {'fixture': True},
            session_factory=lambda bundle: session,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        expired.refresh_from_db()
        self.assertEqual(expired.status, 'failed')
        self.assertEqual(expired.error_code, 'lease_expired')
        self.assertNotEqual(fresh.pk, expired.pk)
        self.assertEqual(fresh.status, 'succeeded')

    def test_legacy_running_row_without_lease_is_recovered(self):
        from Market.worker import collect_due

        abandoned = CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='old', lease_expires_at_ms=None,
        )
        session = FakeSession({
            1: Quote(best_sell=Decimal('5.00')),
            2: Quote(best_sell=Decimal('6.00')),
        })

        result = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: {'fixture': True},
            session_factory=lambda bundle: session,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        abandoned.refresh_from_db()
        self.assertEqual(abandoned.status, 'failed')
        self.assertEqual(abandoned.error_code, 'lease_expired')
        self.assertEqual(result.status, 'succeeded')

    def test_lost_lease_cannot_write_quote_or_change_schedule(self):
        from Market.worker import LeaseLost, _finish_run, _save_quote

        stale = CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='old', lease_expires_at_ms=1000,
        )
        CollectionRun.objects.filter(pk=stale.pk).update(
            status='failed', lease_owner='', lease_expires_at_ms=None,
        )

        with self.assertRaises(LeaseLost):
            _save_quote(stale, self.first, Quote(best_sell=Decimal('5.00')), 1001)
        with self.assertRaises(LeaseLost):
            _finish_run(stale, config_status='ready', next_due_ms=3000000, finished_at_ms=1001)

        self.assertFalse(PriceSnapshot.objects.exists())
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, 1000)

    def test_manual_run_works_while_automatic_schedule_is_paused(self):
        from Market.worker import collect_due

        self.config.enabled = False
        self.config.next_due_at_ms = 9999999999999
        self.config.save()
        queued = CollectionRun.objects.create(trigger='manual', status='queued')
        session = FakeSession({
            1: Quote(best_sell=Decimal('4.00')),
            2: Quote(best_sell=Decimal('8.00')),
        })

        result = collect_due(
            clock_ms=lambda: 1000,
            bundle_loader=lambda: {'fixture': True},
            session_factory=lambda bundle: session,
            randint=lambda minimum, maximum: minimum,
            sleep=lambda seconds: None,
        )

        self.assertEqual(result.pk, queued.pk)
        self.assertEqual(result.trigger, 'manual')
        self.assertEqual(result.status, 'succeeded')
        self.assertTrue(session.closed)

    def test_item_batch_is_bounded_and_rotates_to_oldest_uncollected(self):
        from Market.worker import collect_due

        third = MarketItem.objects.create(id=3, name='Item 3', scope='global')
        sessions = []

        def factory(bundle):
            session = FakeSession({
                1: Quote(best_sell=Decimal('1.00')),
                2: Quote(best_sell=Decimal('2.00')),
                3: Quote(best_sell=Decimal('3.00')),
            })
            sessions.append(session)
            return session

        with patch('Market.worker.MAX_ITEMS_PER_RUN', 2, create=True):
            first_run = collect_due(
                clock_ms=lambda: 1000,
                bundle_loader=lambda: {'fixture': True},
                session_factory=factory,
                randint=lambda minimum, maximum: minimum,
                sleep=lambda seconds: None,
            )
            self.config.refresh_from_db()
            self.config.next_due_at_ms = 2000
            self.config.save()
            second_run = collect_due(
                clock_ms=lambda: 2000,
                bundle_loader=lambda: {'fixture': True},
                session_factory=factory,
                randint=lambda minimum, maximum: minimum,
                sleep=lambda seconds: None,
            )

        self.assertEqual(first_run.success_count, 2)
        self.assertEqual(second_run.success_count, 2)
        self.assertEqual(sessions[0].queries, [(1, 8), (2, 8)])
        self.assertEqual(sessions[1].queries[0], (third.id, 8))

    def test_failed_item_advances_attempt_cursor_so_other_items_are_not_starved(self):
        from Market.worker import collect_due

        sessions = []

        def factory(bundle):
            session = FakeSession({
                1: ValueError('private diagnostic text'),
                2: Quote(best_sell=Decimal('2.00')),
            })
            sessions.append(session)
            return session

        with patch('Market.worker.MAX_ITEMS_PER_RUN', 1):
            first_run = collect_due(
                clock_ms=lambda: 1000,
                bundle_loader=lambda: {'fixture': True},
                session_factory=factory,
                randint=lambda minimum, maximum: minimum,
                sleep=lambda seconds: None,
            )
            self.config.refresh_from_db()
            self.config.next_due_at_ms = 2000
            self.config.save()
            second_run = collect_due(
                clock_ms=lambda: 2000,
                bundle_loader=lambda: {'fixture': True},
                session_factory=factory,
                randint=lambda minimum, maximum: minimum,
                sleep=lambda seconds: None,
            )

        self.first.refresh_from_db()
        self.assertEqual(first_run.status, 'failed')
        self.assertEqual(self.first.last_attempt_at_ms, 1000)
        self.assertEqual(self.first.last_failure_at_ms, 1000)
        self.assertEqual(self.first.last_error_code, 'COLLECTION_ERROR')
        self.assertEqual(second_run.status, 'succeeded')
        self.assertEqual(sessions[0].queries, [(1, 8)])
        self.assertEqual(sessions[1].queries, [(2, 8)])


class MarketWorkerClaimTransactionTests(TransactionTestCase):
    def test_initial_config_read_is_outside_lease_transaction(self):
        from Market.worker import _claim_run

        MarketConfig.objects.create(next_due_at_ms=0)
        observed_atomic_states = []
        original = MarketConfig.objects.get_or_create

        def observe_initial_read(*args, **kwargs):
            observed_atomic_states.append(connection.in_atomic_block)
            return original(*args, **kwargs)

        with patch.object(MarketConfig.objects, 'get_or_create', side_effect=observe_initial_read):
            run = _claim_run(1000)

        self.assertIsNotNone(run)
        self.assertEqual(observed_atomic_states, [False])
