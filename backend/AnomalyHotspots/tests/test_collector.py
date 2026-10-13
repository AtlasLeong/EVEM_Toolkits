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

    def test_five_rpc_budget_jitter_and_strict_capability(self):
        api = self.api()
        lease = FakeLease()
        with patch.object(api, 'account_lease', return_value=lease), patch.object(api.time, 'sleep') as sleep:
            session = api.HotspotSession(bundle())
            with patch.object(session, '_raw_rpc', return_value=[]):
                for method in api.REQUIRED_METHODS: session._perform_rpc(method, None, None)
                with self.assertRaises(api.CollectorError) as error: session._perform_rpc(api.HOTSPOT_METHOD, None, None)
                self.assertEqual(error.exception.code, 'budget_exhausted')
                self.assertEqual(session._audit['rpc_count'], 5)
                self.assertEqual(lease.events.count('rpc'), 5)
                self.assertEqual(sleep.call_count, 4)
                self.assertTrue(all(1 <= call.args[0] <= 3 for call in sleep.call_args_list))
                with self.assertRaises(api.CollectorError): session._perform_rpc('get_kill_info', 1, None)

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
