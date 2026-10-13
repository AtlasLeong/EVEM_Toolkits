"""Synthetic transport/broker contracts; sockets must never be opened here."""
import importlib
import importlib.util
import unittest
from unittest.mock import patch
import msgpack
from .test_core import bundle, wire


class FakeLease:
    def __init__(self): self.acquired, self.events = False, []
    def __enter__(self): self.acquired = True; self.events.append('enter'); return self
    def __exit__(self, *args): self.acquired = False; self.events.append('exit')
    def before_rpc(self): self.events.append('rpc')
    def complete(self): self.events.append('complete')
    def pause_auth(self): self.events.append('auth')
    def pause_rate(self): self.events.append('rate')
    def pause_service(self): self.events.append('service')


class CollectorTests(unittest.TestCase):
    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('AnomalyHotspots.collector'), 'collector missing')
        return importlib.import_module('AnomalyHotspots.collector')

    def test_missing_coordination_fails_before_connect_and_no_import_network(self):
        api = self.api()
        with patch.object(api, 'account_lease', return_value=None), patch.object(api.market.socket, 'create_connection') as opened:
            with self.assertRaises(api.CollectorError) as error: api.HotspotSession(bundle())
            self.assertEqual(error.exception.code, 'configuration_error')
            opened.assert_not_called()

    def test_expired_overall_budget_never_acquires_lease_or_opens_socket(self):
        api = self.api()
        lease = FakeLease()
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'monotonic', return_value=100):
            session = api.HotspotSession(bundle(), timeout=120)
            with patch.object(api.time, 'monotonic', return_value=191), patch.object(api.market.socket, 'create_connection') as opened:
                opened.return_value.recv.return_value = b''
                with self.assertRaises(Exception) as error: session.__enter__()
                self.assertEqual(error.exception.code, 'budget_exhausted')
                self.assertNotIn('enter', lease.events)
                self.assertFalse(lease.acquired)
                opened.assert_not_called()
                self.assertTrue(session._ended)

    def test_budget_rechecked_after_lease_and_releases_without_socket(self):
        api = self.api()
        lease = FakeLease()
        now = [100]
        original_enter = lease.__enter__
        def acquired():
            original_enter()
            now[0] = 191
            return lease
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'monotonic', side_effect=lambda: now[0]):
            session = api.HotspotSession(bundle(), timeout=120)
            with patch.object(lease, '__enter__', side_effect=acquired), patch.object(api.market.socket, 'create_connection') as opened:
                opened.return_value.recv.return_value = b''
                with self.assertRaises(Exception) as error: session.__enter__()
                self.assertEqual(error.exception.code, 'budget_exhausted')
                opened.assert_not_called()
                self.assertFalse(lease.acquired)
                self.assertIn('exit', lease.events)

    def test_connect_and_handshake_share_capped_deadline_and_authenticate_in_order(self):
        api = self.api()
        from unittest.mock import Mock
        lease, socket = FakeLease(), Mock()
        now = [100]
        def connect(endpoint, *, timeout):
            self.assertEqual(timeout, 90)
            now[0] = 120
            return socket
        handshake = (2, {'accepted': True, 'info': {'node_info': {'node_id': 7}}})
        auth_calls = []
        def result(method, item):
            auth_calls.append(method)
            return {'login_sigma': [0, {'client_id': 42, 'proxy_node_id': 43}],
                    'request_start_wait': [], 'get_newbie_info': [], 'select_character_id': 1,
                    api.HOTSPOT_METHOD: wire([])}[method]
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'monotonic', side_effect=lambda: now[0]), patch.object(api.time, 'sleep'):
            session = api.HotspotSession(bundle(), timeout=120)
            with patch.object(api.market.socket, 'create_connection', side_effect=connect), patch.object(api.market, '_read_frame', return_value=handshake) as read, patch.object(session, '_raw_rpc', side_effect=result):
                session.__enter__()
                self.assertEqual(read.call_args.args[1], 190)
                self.assertTrue(all(call.args[0] <= 70 for call in socket.settimeout.call_args_list))
                outer = msgpack.unpackb(socket.sendall.call_args_list[0].args[0][4:], raw=False)
                hello = msgpack.unpackb(outer[1], raw=False)
                self.assertNotEqual(hello['token'], session.bundle['hello']['token'])
                self.assertEqual(session.bundle['hello']['token'], '')
                session._rpc(api.HOTSPOT_METHOD)
                self.assertEqual(auth_calls, list(api.REQUIRED_METHODS))
                self.assertEqual(session._audit['rpc_count'], 5)
                session.__exit__(None, None, None)
                socket.close.assert_called_once()
                self.assertFalse(lease.acquired)

    def test_connection_and_handshake_failures_close_latch_and_publish_rejections(self):
        api = self.api()
        from unittest.mock import Mock
        for kind, expected in (('connection', 'network_error'), ('rejected', 'unauthorized'),
                               ('malformed', 'malformed')):
            lease, socket = FakeLease(), Mock()
            with self.subTest(kind=kind), patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'monotonic', return_value=100):
                session = api.HotspotSession(bundle())
                response = (2, {'accepted': False}) if kind == 'rejected' else (2, {})
                with patch.object(api.market.socket, 'create_connection', side_effect=OSError('private-error') if kind == 'connection' else None, return_value=socket) as connect, patch.object(api.market, '_read_frame', return_value=response):
                    with self.assertRaises(api.CollectorError) as error: session.__enter__()
                    self.assertEqual(error.exception.code, expected)
                    self.assertNotIn('private-error', str(error.exception))
                    with self.assertRaises(api.CollectorError): session.__enter__()
                    self.assertEqual(connect.call_count, 1)
                    self.assertFalse(lease.acquired)
                    self.assertTrue(session._ended)
                    if kind != 'connection': socket.close.assert_called_once()
                    if kind == 'rejected': self.assertIn('auth', lease.events)

    def test_five_rpc_budget_jitter_and_strict_capability(self):
        api = self.api()
        lease = FakeLease()
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'sleep') as sleep:
            session = api.HotspotSession(bundle())
            with patch.object(session, '_raw_rpc', side_effect=lambda method, item: wire([]) if method == api.HOTSPOT_METHOD else []):
                for method in api.REQUIRED_METHODS: session._perform_rpc(method, None, None)
                with self.assertRaises(api.CollectorError) as error: session._perform_rpc(api.HOTSPOT_METHOD, None, None)
                self.assertEqual(error.exception.code, 'budget_exhausted')
                self.assertEqual(session._audit['rpc_count'], 5)
                self.assertEqual(lease.events.count('rpc'), 5)
                self.assertEqual(sleep.call_count, 4)
                self.assertTrue(all(1 <= call.args[0] <= 3 for call in sleep.call_args_list))
                with self.assertRaises(api.CollectorError): session._perform_rpc('get_kill_info', 1, None)

    def test_near_deadline_jitter_is_capped_and_never_reserves_or_sends_rpc(self):
        api = self.api()
        lease, now = FakeLease(), [100]
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'monotonic', side_effect=lambda: now[0]):
            session = api.HotspotSession(bundle())
            session._audit['rpc_count'] = 1
            now[0] = 189.5
            def sleep(seconds): now[0] += seconds
            with patch.object(api.random, 'uniform', return_value=2), patch.object(api.time, 'sleep', side_effect=sleep) as slept, patch.object(session, '_raw_rpc') as rpc:
                with self.assertRaises(api.CollectorError) as error: session._perform_rpc(api.HOTSPOT_METHOD)
                self.assertEqual(error.exception.code, 'budget_exhausted')
                slept.assert_called_once_with(0.5)
                rpc.assert_not_called()
                self.assertNotIn('rpc', lease.events)
                self.assertEqual(session._audit['rpc_count'], 1)

    def test_deadline_rechecked_immediately_before_jitter_sleep(self):
        api = self.api()
        with patch.object(api, 'account_lease', return_value=FakeLease()), patch.object(api.time, 'monotonic', return_value=100):
            session = api.HotspotSession(bundle())
        session._audit['rpc_count'] = 1
        with patch.object(api.time, 'monotonic', side_effect=[189.5, 190.5]), patch.object(api.time, 'sleep') as slept, patch.object(session, '_raw_rpc') as rpc:
            with self.assertRaises(api.CollectorError) as error: session._perform_rpc(api.HOTSPOT_METHOD)
            self.assertEqual(error.exception.code, 'budget_exhausted')
            slept.assert_not_called()
            rpc.assert_not_called()

    def test_hotspot_transport_requires_outer_ext10_and_latches_bare_lists(self):
        api = self.api()
        row = {'solar_system_id': 30001211, 'destroy_num': 155}
        normalized = msgpack.unpackb(wire([row]).data, raw=False)
        for invalid in ([], normalized):
            lease = FakeLease()
            with patch.object(api, 'account_lease', return_value=lease):
                session = api.HotspotSession(bundle())
                lease.__enter__()
                with patch.object(session, '_raw_rpc', return_value=invalid) as raw:
                    with self.assertRaises(api.CollectorError) as error: session._rpc(api.HOTSPOT_METHOD)
                    self.assertEqual(error.exception.code, 'malformed')
                    with self.assertRaises(api.CollectorError): session._rpc(api.HOTSPOT_METHOD)
                    self.assertEqual(raw.call_count, 1)
                    self.assertFalse(lease.acquired)
        with patch.object(api, 'account_lease', return_value=FakeLease()):
            session = api.HotspotSession(bundle())
            with patch.object(session, '_raw_rpc', return_value=wire([row])):
                self.assertEqual(session._rpc(api.HOTSPOT_METHOD), normalized)

    def test_remote_rate_rejection_latches_broker_and_never_reconnects(self):
        api = self.api()
        lease = FakeLease()
        value = msgpack.ExtType(10, msgpack.packb(msgpack.ExtType(16, msgpack.packb(['UserError', 'RequestTooOften', None], use_bin_type=True)), use_bin_type=True))
        with patch.object(api, 'account_lease', return_value=lease):
            session = api.HotspotSession(bundle())
            lease.__enter__()
            with patch.object(session, '_raw_rpc', return_value=value) as raw:
                with self.assertRaises(api.CollectorError) as error: session._rpc(api.HOTSPOT_METHOD)
                self.assertEqual(error.exception.code, 'rate_limited')
                with self.assertRaises(api.CollectorError): session._rpc(api.HOTSPOT_METHOD)
                self.assertEqual(raw.call_count, 1)
                self.assertIn('rate', lease.events)
                self.assertFalse(lease.acquired)

    def test_collect_once_decodes_and_closes_injected_session(self):
        api = self.api()
        lease = FakeLease()
        with patch.object(api, 'account_lease', return_value=lease):
            session = api.HotspotSession(bundle())
            rows = [{'solar_system_id': 30001211, 'destroy_num': 155}]
            with patch.object(session, '__enter__', return_value=session), patch.object(session, '_rpc', return_value=wire(rows)):
                self.assertEqual(api.collect_once(bundle(), session=session), rows)
            self.assertTrue(session._ended)
