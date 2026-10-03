import importlib
from pathlib import Path
import tempfile
from unittest.mock import patch

import msgpack
from django.test import TestCase

from GameSessions.coordination import Coordinator, provision
from Market.collector_protocol import MarketSession, NetworkError, ProtocolTimeout, RateLimitedError, ServiceRejectedError
from Market.models import CollectionRun, MarketConfig, MarketItem, PriceSnapshot
from Market.session_bundle import AuthenticationRejected, SessionBundleError, load_session_pool, save_session
from Market.tests.test_collector_protocol import WireSocket, bundle, pack, response, successful_login
from Market.tests.test_worker import FakeSession, Quote


class RotationTests(TestCase):
    def setUp(self):
        self.config = MarketConfig.objects.create(next_due_at_ms=1000)
        self.item = MarketItem.objects.create(id=1, name='Synthetic item')
        self.now = 1000

    def collect(self, pool, factory, **kwargs):
        from Market.worker import collect_due
        return collect_due(clock_ms=lambda: self.now, bundle_loader=lambda: pool,
                           session_factory=factory, randint=lambda low, high: low,
                           sleep=lambda _: None, lease_factory=lambda *args: None, **kwargs)

    def due_again(self):
        self.config.refresh_from_db()
        self.config.next_due_at_ms = self.now
        self.config.save()

    def test_three_slots_wrap_and_cursor_survives_worker_reload(self):
        import Market.worker as worker
        opened = []
        pool = [{'slot': 'a'}, {'slot': 'b'}, {'slot': 'c'}]
        def factory(selected):
            opened.append(selected['slot'])
            return FakeSession({1: Quote()})
        for _ in range(4):
            self.assertEqual(self.collect(pool, factory).status, 'succeeded')
            importlib.reload(worker)
            self.due_again()
        self.assertEqual(opened, ['a', 'b', 'c', 'a'])
        self.config.refresh_from_db()
        self.assertEqual(self.config.session_cursor, 1)

    def test_auth_denial_stops_without_opening_another_slot_or_next_scheduled_run(self):
        opened = []
        class Rejected(FakeSession):
            def __enter__(self):
                raise AuthenticationRejected('synthetic detail must not escape')
        def factory(selected):
            opened.append(selected)
            return Rejected({})
        run = self.collect([{'slot': 'a'}, {'slot': 'b'}], factory)
        self.assertEqual((run.status, run.error_code), ('needs_auth', 'auth_rejected'))
        self.assertEqual(opened, [{'slot': 'a'}])
        self.assertIsNone(self.collect([{'slot': 'a'}, {'slot': 'b'}], factory))
        self.assertFalse(PriceSnapshot.objects.exists())

    def test_invalid_material_is_distinct_and_never_contacts_transport(self):
        from Market.worker import collect_due
        with patch('Market.worker.account_lease'), patch('socket.create_connection') as connect:
            run = collect_due(clock_ms=lambda: self.now,
                              bundle_loader=lambda: (_ for _ in ()).throw(SessionBundleError('synthetic')))
        self.assertEqual((run.status, run.error_code), ('needs_auth', 'invalid_session'))
        connect.assert_not_called()

    def test_rate_limit_stops_all_remaining_items_and_blocks_manual_queue(self):
        MarketItem.objects.create(id=2, name='Second synthetic item')
        session = FakeSession({1: RateLimitedError('synthetic rejection'), 2: Quote()})
        run = self.collect([{'slot': 'a'}, {'slot': 'b'}], lambda _: session)
        self.assertEqual((run.status, run.error_code), ('rate_limited', 'rate_limited'))
        self.assertEqual(session.queries, [(1, 8)])
        self.config.refresh_from_db()
        self.assertEqual(self.config.cooldown_until_ms, self.now + 15 * 60000)
        CollectionRun.objects.create(trigger='manual', status='queued')
        self.assertIsNone(self.collect([{}], lambda _: self.fail('must not connect during cooldown')))

    def test_unclassified_service_rejection_pauses_without_mislabeling_expiry(self):
        run = self.collect([{}], lambda _: FakeSession({1: ServiceRejectedError('synthetic')}))
        self.config.refresh_from_db()
        self.assertEqual((run.error_code, self.config.session_status), ('service_rejected', 'blocked'))
        self.assertIsNone(self.collect([{}], lambda _: self.fail('service rejection must stay paused')))

    def test_network_failure_can_recover_on_normal_next_cycle_without_auth_refresh(self):
        class Disconnected(FakeSession):
            sock = None
        run = self.collect([{}], lambda _: Disconnected({1: NetworkError('synthetic network')}))
        self.assertEqual((run.status, run.error_code), ('failed', 'network_error'))
        self.item.refresh_from_db()
        self.assertEqual(self.item.last_error_code, 'network_error')
        self.config.refresh_from_db()
        self.assertEqual(self.config.session_status, 'error')
        self.now = self.config.next_due_at_ms
        recovered = self.collect([{}], lambda _: FakeSession({1: Quote()}))
        self.assertEqual(recovered.status, 'succeeded')

    def test_connection_timeout_is_not_auth_expiry_and_stops_this_pass(self):
        opened = []
        class TimedOut(FakeSession):
            def __enter__(self):
                raise ProtocolTimeout('synthetic')
        def factory(selected):
            opened.append(selected)
            return TimedOut({})
        run = self.collect([{'slot': 'a'}, {'slot': 'b'}], factory)
        self.config.refresh_from_db()
        self.assertEqual((run.error_code, self.config.session_status), ('timeout', 'error'))
        self.assertEqual(opened, [{'slot': 'a'}])

    def test_material_duplicates_even_with_reordered_json_keys_are_rejected(self):
        original = bundle()
        reordered = dict(reversed(list(original.items())))
        reordered['hello'] = dict(reversed(list(original['hello'].items())))
        with tempfile.TemporaryDirectory() as temporary:
            paths = [Path(temporary) / name for name in ('one.json', 'two.json')]
            for material, path in zip((original, reordered), paths):
                save_session(material, path)
            with self.assertRaises(SessionBundleError):
                load_session_pool(paths)

    def test_real_market_byte_stream_counts_auth_and_quote_in_shared_budget(self):
        from Market.worker import collect_due
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'state.sqlite3'
            provision(path)
            now = [1000]
            coordinator = Coordinator(path, clock_ms=lambda: now[0],
                                      sleep=lambda seconds: now.__setitem__(0, now[0] + int(seconds * 1000)))
            wire = WireSocket(successful_login() + response(5, [[], []]))
            with patch('socket.create_connection', return_value=wire):
                run = collect_due(clock_ms=lambda: self.now, bundle_loader=lambda: [bundle()],
                                  session_factory=MarketSession, randint=lambda low, high: low,
                                  lease_factory=lambda *args: coordinator.lease('shared-a'))
            self.assertEqual(run.status, 'succeeded')
            self.assertTrue(wire.closed)
            with coordinator.transaction() as db:
                self.assertEqual(db.execute('SELECT rpc_count FROM accounts').fetchone()[0], 5)

    def test_captured_throttle_envelope_is_classified_before_unwrapping(self):
        throttle = msgpack.ExtType(10, pack(msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', None]))))
        wire = WireSocket(successful_login() + response(5, throttle))
        with patch('socket.create_connection', return_value=wire):
            with self.assertRaises(RateLimitedError):
                with MarketSession(bundle()) as session:
                    session.quote(1)
        self.assertTrue(wire.closed)
        self.assertEqual(len(wire.sent), 6)  # handshake + auth4 + exactly one quote

    def test_larger_session_pool_does_not_expand_forty_item_batch_or_open_more_sessions(self):
        for item_id in range(2, 46):
            MarketItem.objects.create(id=item_id, name=f'Synthetic {item_id}')
        session = FakeSession({item_id: Quote() for item_id in range(1, 46)})
        opened = []
        def factory(selected):
            opened.append(selected)
            return session
        run = self.collect([{'slot': slot} for slot in ('a', 'b', 'c')], factory)
        self.assertEqual(run.success_count, 40)
        self.assertEqual(len(session.queries), 40)
        self.assertEqual(opened, [{'slot': 'a'}])
        self.config.refresh_from_db()
        self.assertEqual(self.config.next_due_at_ms, self.now + 2100 * 1000)

    def test_lost_orm_lease_stops_before_next_rpc_and_does_not_change_cursor(self):
        from Market.worker import _heartbeat_run, _select_bundle
        run = CollectionRun.objects.create(trigger='manual', status='running',
                                           lease_owner='old', lease_expires_at_ms=5000)
        CollectionRun.objects.filter(pk=run.pk).update(lease_owner='new')
        from Market.worker import LeaseLost
        with self.assertRaises(LeaseLost):
            _heartbeat_run(run, self.now)
        with self.assertRaises(LeaseLost):
            _select_bundle(run, [{}, {}], self.now)
        self.config.refresh_from_db()
        self.assertEqual(self.config.session_cursor, 0)
