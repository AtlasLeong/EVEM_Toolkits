"""Offline byte-stream transport tests; no account or server is contacted."""

import importlib
from decimal import Decimal
import os
from pathlib import Path
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch

import msgpack

from Killboard.protocol import decode_kill_info_response
from Killboard.tests.test_session_bundle import pack, synthetic_bundle, with_profiles
from Killboard.tests.test_identity_protocol import character, corporation


def frame(kind, body):
    data = pack([kind, pack(body)])
    return struct.pack('<I', len(data)) + data


def response(call_id, result, seq=None):
    return frame(3, {'seq': call_id if seq is None else seq,
                     'content': pack([2, [], [0, 0, call_id], [result]])})


def envelope(value, transport=True):
    inner = msgpack.ExtType(19, pack([71, pack(value)]))
    return msgpack.ExtType(10, pack(inner)) if transport else inner


def throttle():
    return msgpack.ExtType(10, pack(msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', None]))))


def successful_login():
    return (frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
            + response(1, [0, {'client_id': 77, 'proxy_node_id': 88}])
            + response(2, [0]) + response(3, [0]) + response(4, 1))


class WireSocket:
    def __init__(self, data, chunk_size=7, timeout_when_empty=False):
        self.data = bytearray(data)
        self.chunk_size = chunk_size
        self.timeout_when_empty = timeout_when_empty
        self.sent = []
        self.closed = False
        self.timeouts = []

    def recv(self, size):
        if not self.data and self.timeout_when_empty:
            raise socket.timeout('private-sensitive-detail')
        size = min(size, self.chunk_size)
        result = bytes(self.data[:size])
        del self.data[:size]
        return result

    def sendall(self, value):
        self.sent.append(value)

    def settimeout(self, timeout):
        self.timeouts.append(timeout)

    def close(self):
        self.closed = True


def sent_rpc(raw):
    size = struct.unpack('<I', raw[:4])[0]
    if size != len(raw) - 4:
        raise AssertionError('invalid sent frame length')
    kind, encoded = msgpack.unpackb(raw[4:], raw=False)
    meta = msgpack.unpackb(encoded, raw=False)
    body = msgpack.unpackb(meta['content'], raw=False)
    call = msgpack.unpackb(body[3][0].data, raw=False)
    return kind, meta, body, call


class CollectorTransportTests(unittest.TestCase):
    def setUp(self):
        try:
            self.transport = importlib.import_module('Killboard.collector_transport')
            self.bundle_module = importlib.import_module('Killboard.session_bundle')
        except ModuleNotFoundError:
            self.fail('Killboard captured-session transport implementation is missing')

    def test_lazy_session_sends_auth4_then_exact_kill_id_to_char_mgr(self):
        original = synthetic_bundle()
        wire = WireSocket(successful_login() + response(5, envelope({'kill_blob': '<other/>', 'kill_id': 999})))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(original)
            connect.assert_not_called()
            with client:
                connect.assert_not_called()
                result = client.get_kill_info(999)
                self.assertEqual(decode_kill_info_response(result)['kill_id'], 999)
                self.assertEqual(client.session.client_id, 77)
                self.assertEqual(client.session.proxy_id, 88)
            self.assertTrue(wire.closed)
            connect.assert_called_once_with(('192.0.2.10', 12345), timeout=10.0)
        rpcs = [sent_rpc(raw) for raw in wire.sent[1:]]
        self.assertEqual([part[3][0] for part in rpcs],
                         ['login_sigma', 'request_start_wait', 'get_newbie_info',
                          'select_character_id', 'get_kill_info'])
        kind, meta, body, call = rpcs[-1]
        self.assertEqual((kind, meta['seq'], meta['ack']), (3, 4, 5))
        self.assertEqual(body[1][1:3], [77, 5])
        self.assertEqual(body[2][1:3], ['char_mgr', 88])
        self.assertEqual(call, ['get_kill_info', [999]])
        self.assertEqual(original, synthetic_bundle())

    def test_multiple_ids_share_selected_connection_and_no_report_stays_empty(self):
        wire = WireSocket(successful_login() + response(5, []) + response(6, envelope(None)))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            with self.transport.KillboardClient(synthetic_bundle()) as client:
                self.assertIsNone(decode_kill_info_response(client.get_kill_info(100)))
                self.assertIsNone(decode_kill_info_response(client.get_kill_info(101)))
            connect.assert_called_once()
        self.assertEqual([sent_rpc(raw)[3][1] for raw in wire.sent[-2:]], [[100], [101]])

    def test_actual_call_shape_empty_kwargs_survives_id_rewrite_and_auth(self):
        candidate = synthetic_bundle()
        for meta in candidate['templates'].values():
            body = msgpack.unpackb(meta['content'], raw=False)
            call = msgpack.unpackb(body[3][0].data, raw=False)
            body[3][0] = msgpack.ExtType(10, pack([*call, {}]))
            meta['content'] = pack(body)
        wire = WireSocket(successful_login() + response(5, []))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            try:
                client = self.transport.KillboardClient(candidate)
            except self.bundle_module.NeedsAuthError:
                self.fail('Observed empty-kwargs call shape must be accepted')
            with client:
                client.get_kill_info(999)
        self.assertEqual(sent_rpc(wire.sent[-1])[3], ['get_kill_info', [999], {}])
        self.assertTrue(all(sent_rpc(raw)[3][2] == {} for raw in wire.sent[1:]))

    def test_unrelated_and_unsolicited_frames_do_not_match_requested_call(self):
        wire = WireSocket(successful_login() + response(50, envelope({'kill_id': 50}), seq=7)
                          + frame(4, {}) + response(5, envelope({'kill_id': 100}), seq=8))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.transport.KillboardClient(synthetic_bundle()) as client:
                self.assertEqual(decode_kill_info_response(client.get_kill_info(100))['kill_id'], 100)

    def test_identifier_validation_happens_before_connection(self):
        for value in (True, False, '100', 0, -1, 2**63, 1.0):
            with self.subTest(value=value):
                with patch('Market.collector_protocol.socket.create_connection') as connect:
                    client = self.transport.KillboardClient(synthetic_bundle())
                    with self.assertRaises(ValueError):
                        client.get_kill_info(value)
                    connect.assert_not_called()

    def test_boundary_identifiers_are_accepted(self):
        wire = WireSocket(successful_login() + response(5, []) + response(6, []))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.transport.KillboardClient(synthetic_bundle()) as client:
                client.get_kill_info(1)
                client.get_kill_info(2**63 - 1)
        self.assertEqual([sent_rpc(raw)[3][1] for raw in wire.sent[-2:]], [[1], [2**63 - 1]])

    def test_handshake_or_login_denial_closes_and_stops_without_reconnect(self):
        for data in (frame(2, {'accepted': False, 'error': 'private-sensitive-detail'}),
                     frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                     + response(1, ['private-sensitive-detail'])):
            wire = WireSocket(data)
            with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                client = self.transport.KillboardClient(synthetic_bundle())
                for _ in range(2):
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'unauthorized')
                    self.assertNotIn('private-sensitive-detail', str(caught.exception))
                self.assertTrue(wire.closed)
                connect.assert_called_once()

    def test_timeout_is_sanitized_network_stop_and_not_an_empty_kill(self):
        wire = WireSocket(successful_login(), timeout_when_empty=True)
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(synthetic_bundle(), timeout=0.5)
            for _ in range(2):
                with self.assertRaises(self.transport.CollectorError) as caught:
                    client.get_kill_info(100)
                self.assertEqual(caught.exception.code, 'network_error')
                self.assertEqual(caught.exception.reason, 'timeout')
                self.assertNotIn('private-sensitive-detail', str(caught.exception))
            self.assertTrue(wire.closed)
            connect.assert_called_once()

    def test_connection_error_is_sanitized_and_stops_without_retry(self):
        with patch('Market.collector_protocol.socket.create_connection', side_effect=OSError('private-sensitive-detail')) as connect:
            client = self.transport.KillboardClient(synthetic_bundle())
            for _ in range(2):
                with self.assertRaises(self.transport.CollectorError) as caught:
                    client.get_kill_info(100)
                self.assertEqual(caught.exception.code, 'network_error')
                self.assertNotIn('private-sensitive-detail', str(caught.exception))
            connect.assert_called_once()

    def test_malformed_business_result_closes_and_stops_instead_of_reusing_stream(self):
        for result in ({'kill_blob': 'private-sensitive-detail'},
                       msgpack.ExtType(19, pack([99, b'private-sensitive-detail'])),
                       ['private-sensitive-detail']):
            wire = WireSocket(successful_login() + response(5, result))
            with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                client = self.transport.KillboardClient(synthetic_bundle())
                for _ in range(2):
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'malformed')
                    self.assertNotIn('private-sensitive-detail', str(caught.exception))
                self.assertTrue(wire.closed)
                connect.assert_called_once()

    def test_explicit_structured_auth_and_rate_statuses_stop_without_rotation(self):
        for code in ('unauthorized', 'rate_limited'):
            wire = WireSocket(successful_login() + response(5, {'error': {'code': code, 'detail': 'private-sensitive-detail'}}))
            with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                client = self.transport.KillboardClient(synthetic_bundle())
                for _ in range(2):
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, code)
                    self.assertNotIn('private-sensitive-detail', str(caught.exception))
                self.assertTrue(wire.closed)
                connect.assert_called_once()

    def test_observed_throttle_latches_rate_limit_without_retry_or_account_fallback(self):
        wire = WireSocket(successful_login() + response(5, throttle()))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            with patch.object(self.bundle_module, 'load_random_session') as choose:
                client = self.transport.KillboardClient(synthetic_bundle())
                for _ in range(2):
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'rate_limited')
                choose.assert_not_called()
            connect.assert_called_once()
        self.assertTrue(wire.closed)
        self.assertEqual(len(wire.sent), 6)

    def test_session_itself_latches_throttle_and_never_reconnects(self):
        wire = WireSocket(successful_login() + response(5, throttle()))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            session = self.transport.KillboardSession(synthetic_bundle())
            session.__enter__()
            with self.assertRaises(self.transport.CollectorError) as caught:
                session._rpc('get_kill_info', item_id=100)
            self.assertEqual(caught.exception.code, 'rate_limited')
            self.assertTrue(wire.closed)
            with self.assertRaises(self.transport.CollectorError) as caught:
                session.__enter__()
            self.assertEqual(caught.exception.code, 'rate_limited')
            connect.assert_called_once()

    def test_throttle_lookalikes_remain_malformed(self):
        lookalikes = [
            ['UserError', 'RequestTooOften', None],
            msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', None])),
            msgpack.ExtType(16, pack(['UserError', 'RequestTooOften'])),
            msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', {}])),
            msgpack.ExtType(16, pack(['OtherError', 'RequestTooOften', None])),
            msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', None, None])),
            msgpack.ExtType(17, pack(['UserError', 'RequestTooOften', None])),
            msgpack.ExtType(16, b'private-sensitive-detail'),
            msgpack.ExtType(10, pack(throttle())),
            msgpack.ExtType(55, pack(msgpack.ExtType(16, pack(['UserError', 'RequestTooOften', None])))),
        ]
        for value in lookalikes:
            with self.subTest(shape=type(value).__name__):
                wire = WireSocket(successful_login() + response(5, value))
                with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
                    client = self.transport.KillboardClient(synthetic_bundle())
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'malformed')
                    self.assertNotIn('private-sensitive-detail', str(caught.exception))
                self.assertTrue(wire.closed)

    def test_observed_throttle_during_each_auth_stage_stops_the_session(self):
        normal = [[0, {'client_id': 77, 'proxy_node_id': 88}], [0], [0], 1]
        for stage in range(4):
            wire = WireSocket(frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                              + b''.join(response(i + 1, throttle() if i == stage else value)
                                         for i, value in enumerate(normal)))
            with self.subTest(stage=stage), patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                client = self.transport.KillboardClient(synthetic_bundle())
                for _ in range(2):
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'rate_limited')
                self.assertEqual(len(wire.sent), stage + 2)
                connect.assert_called_once()
                self.assertTrue(wire.closed)

    def test_before_rpc_is_lazy_and_covers_auth_and_every_business_call(self):
        observed = []
        wire = WireSocket(successful_login() + response(5, []) + response(6, []))
        callback = lambda: observed.append(len(wire.sent))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(synthetic_bundle(), before_rpc=callback)
            self.assertEqual(observed, [])
            connect.assert_not_called()
            client.set_before_rpc(callback)
            client.get_kill_info(100)
            client.get_kill_info(101)
            client.close()
        self.assertEqual(observed, [1, 2, 3, 4, 5, 6])

    def test_before_rpc_budget_stop_propagates_unchanged_and_closes(self):
        class BudgetStop(Exception):
            code = 'budget_exhausted'
        stop = BudgetStop('synthetic budget exhausted')
        wire = WireSocket(successful_login() + response(5, []))
        def before_rpc():
            if len(wire.sent) == 5:
                raise stop
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(synthetic_bundle(), before_rpc=before_rpc)
            with self.assertRaises(BudgetStop) as caught:
                client.get_kill_info(100)
            self.assertIs(caught.exception, stop)
            with self.assertRaises(self.transport.CollectorError):
                client.get_kill_info(101)
            connect.assert_called_once()
        self.assertEqual(len(wire.sent), 5)
        self.assertTrue(wire.closed)

    def test_profiles_batch_exact_requested_ids_and_share_run_pacer(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'get_public_info'), 'profile batch client is missing')
        wire = WireSocket(successful_login() + response(5, [character()]) + response(6, [corporation()]))
        paced = []
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.transport.KillboardClient(with_profiles(), before_rpc=lambda: paced.append(len(wire.sent))) as client:
                self.assertEqual(client.get_public_info([101])[101]['name'], 'Synthetic pilot')
                self.assertEqual(client.get_corp_brief([201])[201]['ticker'], 'TEST')
        self.assertEqual([sent_rpc(raw)[3] for raw in wire.sent[-2:]],
                         [['get_public_info', [[101]], {}], ['get_corp_brief', [[201]], {}]])
        self.assertEqual(paced, [1, 2, 3, 4, 5, 6])

    def test_optional_missing_profiles_are_empty_without_network_or_fabrication(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'get_public_info'), 'optional profile API is missing')
        with patch('Market.collector_protocol.socket.create_connection') as connect:
            client = self.transport.KillboardClient(synthetic_bundle())
            self.assertEqual(client.get_public_info([101]), {})
            self.assertEqual(client.get_corp_brief([201]), {})
            connect.assert_not_called()

    def test_enrichment_uses_victim_and_first_seven_positive_characters_and_run_cache(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'get_public_info'), 'identity enrichment is missing')
        blob = '<attackers><a s=901 d=999/>' + ''.join(f'<a c={i} r=201 d={i}/>' for i in range(101, 110)) + '</attackers>'
        report = envelope({'kill_blob': blob, 'kill_id': 100, 'victim_character_id': 1000})
        next_report = envelope({'kill_blob': blob, 'kill_id': 101, 'victim_character_id': 1000})
        characters = [character(i) for i in [1000, *range(101, 108)]]
        wire = WireSocket(successful_login() + response(5, report) + response(6, characters)
                          + response(7, [corporation()]) + response(8, next_report))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.transport.KillboardClient(with_profiles()) as client:
                first = client.get_kill_info(100)
                second = client.get_kill_info(101)
        self.assertEqual(set(first['identity_map']['characters']), {1000, *range(101, 108)})
        self.assertEqual(first['identity_map'], second['identity_map'])
        self.assertEqual(first['identity_map']['alliances'][301]['name'], 'Synthetic alliance')
        self.assertEqual([sent_rpc(raw)[3][0] for raw in wire.sent[1:]],
                         [*self.bundle_module.REQUIRED_METHODS, 'get_public_info', 'get_corp_brief', 'get_kill_info'])

    def test_enrich_false_keeps_known_report_smoke_to_auth4_plus_km_only(self):
        wire = WireSocket(successful_login() + response(5, envelope({'kill_blob': '<other/>', 'kill_id': 100})))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            try:
                client = self.transport.KillboardClient(with_profiles(), enrich=False)
            except TypeError:
                self.fail('enrich=False smoke/bootstrap escape hatch is missing')
            with client:
                self.assertEqual(decode_kill_info_response(client.get_kill_info(100))['kill_id'], 100)
        self.assertEqual(len(wire.sent), 6)

    def test_policy_threshold_skips_identity_rpcs_for_missing_equal_or_lower_loss(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'set_enrichment_min_isk'),
                        'Policy-aware enrichment threshold is missing')
        for value in (None, '0', '19999999999.99', '20000000000.00'):
            with self.subTest(value=value):
                report = {'kill_blob': '<other/>', 'kill_id': 100, 'victim_character_id': 101}
                if value is not None:
                    report['isk_lost'] = value
                wire = WireSocket(successful_login() + response(5, envelope(report)))
                with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
                    with self.transport.KillboardClient(with_profiles()) as client:
                        client.set_enrichment_min_isk(Decimal('20000000000.00'))
                        decoded = client.get_kill_info(100)
                self.assertEqual(decoded['kill_id'], 100)
                self.assertNotIn('identity_map', decoded)
                self.assertEqual([sent_rpc(raw)[3][0] for raw in wire.sent[1:]],
                                 list(self.bundle_module.REQUIRED_METHODS))

    def test_loss_strictly_above_policy_threshold_still_enriches_identities(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'set_enrichment_min_isk'),
                        'Policy-aware enrichment threshold is missing')
        report = {'kill_blob': '<other/>', 'kill_id': 100,
                  'victim_character_id': 101, 'isk_lost': '20000000000.01'}
        wire = WireSocket(successful_login() + response(5, envelope(report))
                          + response(6, [character()]) + response(7, [corporation()]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.transport.KillboardClient(with_profiles()) as client:
                client.set_enrichment_min_isk('20000000000.00')
                decoded = client.get_kill_info(100)
        self.assertEqual(decoded['identity_map']['characters'][101]['name'], 'Synthetic pilot')
        self.assertEqual([sent_rpc(raw)[3][0] for raw in wire.sent[-2:]],
                         ['get_public_info', 'get_corp_brief'])

    def test_nonfinite_loss_never_spends_identity_rpcs_and_keeps_malformed_stop(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'set_enrichment_min_isk'),
                        'Policy-aware enrichment threshold is missing')
        for value in ('NaN', 'Infinity', '-Infinity'):
            with self.subTest(value=value):
                report = {'kill_blob': '<other/>', 'kill_id': 100,
                          'victim_character_id': 101, 'isk_lost': value}
                wire = WireSocket(successful_login() + response(5, envelope(report)))
                with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                    client = self.transport.KillboardClient(with_profiles())
                    client.set_enrichment_min_isk(Decimal('20000000000.00'))
                    with self.assertRaises(self.transport.CollectorError) as caught:
                        client.get_kill_info(100)
                    self.assertEqual(caught.exception.code, 'malformed')
                    with self.assertRaises(self.transport.CollectorError):
                        client.get_kill_info(101)
                    connect.assert_called_once()
                self.assertEqual(len(wire.sent), 6)
                self.assertTrue(wire.closed)

    def test_enrichment_threshold_validates_without_connection_and_none_restores_default(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'set_enrichment_min_isk'),
                        'Policy-aware enrichment threshold is missing')
        with patch('Market.collector_protocol.socket.create_connection') as connect:
            client = self.transport.KillboardClient(with_profiles())
            for value in (True, False, -1, 'NaN', 'Infinity', '', [], object()):
                with self.subTest(value_type=type(value).__name__), self.assertRaises(ValueError):
                    client.set_enrichment_min_isk(value)
            connect.assert_not_called()
        wire = WireSocket(successful_login() + response(5, envelope({
            'kill_blob': '<other/>', 'kill_id': 100, 'victim_character_id': 101}))
            + response(6, [character()]) + response(7, [corporation()]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with client:
                client.set_enrichment_min_isk(Decimal('20000000000.00'))
                client.set_enrichment_min_isk(None)
                self.assertEqual(client.get_kill_info(100)['identity_map']['characters'][101]['name'],
                                 'Synthetic pilot')

    def test_throttle_during_enrichment_latches_and_never_returns_partial_report(self):
        self.assertTrue(hasattr(self.transport.KillboardClient, 'get_public_info'), 'identity enrichment is missing')
        report = envelope({'kill_blob': '<other/>', 'kill_id': 100, 'victim_character_id': 101})
        wire = WireSocket(successful_login() + response(5, report) + response(6, throttle()))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(with_profiles())
            for _ in range(2):
                with self.assertRaises(self.transport.CollectorError) as caught:
                    client.get_kill_info(100)
                self.assertEqual(caught.exception.code, 'rate_limited')
            connect.assert_called_once()
        self.assertEqual(len(wire.sent), 7)
        self.assertTrue(wire.closed)

    def test_mismatched_kill_id_stops_before_any_identity_rpc(self):
        report = envelope({'kill_blob': '<other/>', 'kill_id': 101, 'victim_character_id': 1000})
        wire = WireSocket(successful_login() + response(5, report))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(with_profiles())
            for _ in range(2):
                with self.assertRaises(self.transport.CollectorError) as caught:
                    client.get_kill_info(100)
                self.assertEqual(caught.exception.code, 'malformed')
            connect.assert_called_once()
        self.assertEqual(len(wire.sent), 6)
        self.assertTrue(wire.closed)

    def test_structured_stop_at_any_auth_stage_prevents_later_rpc_and_reconnect(self):
        auth_results = [[0, {'client_id': 77, 'proxy_node_id': 88}], [0], [0], 1]
        for stage in range(4):
            for code in ('unauthorized', 'rate_limited'):
                data = frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                for index, normal in enumerate(auth_results):
                    result = {'error': {'code': code, 'detail': 'private-sensitive-detail'}} if index == stage else normal
                    data += response(index + 1, result)
                data += response(5, [])
                wire = WireSocket(data)
                with self.subTest(stage=stage, code=code):
                    with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
                        client = self.transport.KillboardClient(synthetic_bundle())
                        with self.assertRaises(self.transport.CollectorError) as caught:
                            client.get_kill_info(100)
                        self.assertEqual(caught.exception.code, code)
                        self.assertEqual(len(wire.sent), stage + 2)
                        self.assertTrue(wire.closed)
                        with self.assertRaises(self.transport.CollectorError):
                            client.get_kill_info(100)
                        connect.assert_called_once()

    def test_unknown_auth_error_shape_stops_malformed_instead_of_continuing(self):
        auth_results = [[0, {'client_id': 77, 'proxy_node_id': 88}], [0], [0], 1]
        errors = [{'error': {'code': 429, 'detail': 'private-sensitive-detail'}},
                  {'error': {'code': 'unobserved', 'detail': 'private-sensitive-detail'}},
                  {'error': 'private-sensitive-detail'}]
        for stage in range(4):
            for error in errors:
                data = frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                for index, normal in enumerate(auth_results):
                    data += response(index + 1, error if index == stage else normal)
                data += response(5, [])
                wire = WireSocket(data)
                with self.subTest(stage=stage, error_shape=type(error['error']).__name__):
                    with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
                        client = self.transport.KillboardClient(synthetic_bundle())
                        with self.assertRaises(self.transport.CollectorError) as caught:
                            client.get_kill_info(100)
                        self.assertEqual(caught.exception.code, 'malformed')
                        self.assertNotIn('private-sensitive-detail', str(caught.exception))
                        self.assertEqual(len(wire.sent), stage + 2)
                        self.assertTrue(wire.closed)

    def test_oversized_frame_stops_malformed_and_closes(self):
        wire = WireSocket(successful_login() + struct.pack('<I', 10_000_001))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            client = self.transport.KillboardClient(synthetic_bundle())
            with self.assertRaises(self.transport.CollectorError) as caught:
                client.get_kill_info(100)
            self.assertEqual(caught.exception.code, 'malformed')
            self.assertTrue(wire.closed)

    def test_close_is_idempotent_and_never_opens_a_socket(self):
        with patch('Market.collector_protocol.socket.create_connection') as connect:
            client = self.transport.KillboardClient(synthetic_bundle())
            client.close()
            client.close()
            with self.assertRaises(self.transport.CollectorError):
                client.get_kill_info(100)
            connect.assert_not_called()

    def test_cancellation_during_business_rpc_closes_without_being_reclassified(self):
        class CancelledWire(WireSocket):
            def recv(self, size):
                if not self.data:
                    raise KeyboardInterrupt()
                return super().recv(size)

        wire = CancelledWire(successful_login())
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire) as connect:
            client = self.transport.KillboardClient(synthetic_bundle())
            with self.assertRaises(KeyboardInterrupt):
                client.get_kill_info(100)
            self.assertTrue(wire.closed)
            with self.assertRaises(self.transport.CollectorError):
                client.get_kill_info(101)
            connect.assert_called_once()

    def test_invalid_timeout_is_rejected_before_connect(self):
        for value in (0, -1, True, float('inf'), 121, '10'):
            with self.subTest(value=value), patch('Market.collector_protocol.socket.create_connection') as connect:
                with self.assertRaises(ValueError):
                    self.transport.KillboardClient(synthetic_bundle(), timeout=value)
                connect.assert_not_called()

    def test_factory_selects_exactly_one_private_session_and_is_lazy(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = [Path(temporary) / 'one.json', Path(temporary) / 'two.json']
            for index, path in enumerate(paths):
                self.bundle_module.save_session(synthetic_bundle(bytes([index])), path)
            with patch.dict(os.environ, {'KILLBOARD_SESSION_FILES': os.pathsep.join(map(str, paths))}):
                with patch('Market.collector_protocol.socket.create_connection') as connect:
                    with patch.object(self.bundle_module.random, 'choice', side_effect=lambda values: values[1]) as choose:
                        client = self.transport.build_client()
                    choose.assert_called_once()
                    self.assertEqual(client.session.bundle['hello']['synthetic'], b'\x01')
                    connect.assert_not_called()
                    client.close()


if __name__ == '__main__':
    unittest.main()
