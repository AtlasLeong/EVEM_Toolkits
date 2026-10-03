from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from GameSessions.coordination import AccountAuthPaused, AccountRateLimited, Coordinator, provision
from Killboard.collector_transport import CollectorError, KillboardClient
from Killboard.tests.test_collector_transport import WireSocket, frame, response, successful_login, throttle
from Killboard.tests.test_session_bundle import synthetic_bundle


class SharedKillboardTransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'state.sqlite3'
        provision(self.path)
        self.now = 1000
        self.coordinator = Coordinator(self.path, clock_ms=lambda: self.now, sleep=self.advance)

    def advance(self, seconds):
        self.now += int(seconds * 1000)

    def test_handshake_and_login_rejection_pause_shared_account_before_releasing(self):
        for payload in (frame(2, {'accepted': False}),
                        frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                        + response(1, [1, {}])):
            with self.subTest(payload_length=len(payload)):
                self.coordinator.resume('shared-a')
                wire = WireSocket(payload)
                client = KillboardClient(synthetic_bundle())
                client.session.account_lease = self.coordinator.lease('shared-a')
                with patch('socket.create_connection', return_value=wire) as connect:
                    with self.assertRaises(CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'unauthorized')
                    with self.assertRaises(AccountAuthPaused):
                        self.coordinator.lease('shared-a').__enter__()
                    with self.assertRaises(CollectorError):
                        client.get_kill_info(101)
                    self.assertEqual(connect.call_count, 1)
                self.assertTrue(wire.closed)

    def test_km_throttle_blocks_market_identity_and_stops_latched_transport(self):
        wire = WireSocket(successful_login() + response(5, throttle()))
        client = KillboardClient(synthetic_bundle())
        client.session.account_lease = self.coordinator.lease('shared-a')
        with patch('socket.create_connection', return_value=wire) as connect:
            with self.assertRaises(CollectorError) as caught:
                client.get_kill_info(100)
            self.assertEqual(caught.exception.code, 'rate_limited')
            with self.assertRaises(AccountRateLimited):
                self.coordinator.lease('market-b').__enter__()
            with self.assertRaises(CollectorError):
                client.get_kill_info(101)
            self.assertEqual(connect.call_count, 1)
        self.assertTrue(wire.closed)
        with self.coordinator.transaction() as db:
            self.assertEqual(db.execute('SELECT rpc_count FROM accounts').fetchone()[0], 5)

    def test_km_network_failure_does_not_reset_persistent_rate_history(self):
        with self.coordinator.transaction() as db:
            db.execute('UPDATE policy SET rate_failures=2')
        wire = WireSocket(successful_login())  # stream closes before the report
        client = KillboardClient(synthetic_bundle())
        client.session.account_lease = self.coordinator.lease('shared-a')
        with patch('socket.create_connection', return_value=wire):
            with self.assertRaises(CollectorError) as caught:
                client.get_kill_info(100)
        self.assertEqual(caught.exception.code, 'network_error')
        self.assertTrue(wire.closed)
        with self.coordinator.transaction() as db:
            self.assertEqual(db.execute('SELECT rate_failures FROM policy').fetchone()[0], 2)
