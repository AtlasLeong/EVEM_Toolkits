"""Offline protocol checks: every byte and credential-like value is synthetic."""

import base64
import copy
import importlib
import json
import os
from pathlib import Path
import socket
import stat
import struct
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from decimal import Decimal

import msgpack


def pack(value):
    return msgpack.packb(value, use_bin_type=True)


def frame(kind, body):
    data = pack([kind, pack(body)])
    return struct.pack('<I', len(data)) + data


def response(call_id, result, seq=None):
    return frame(3, {'seq': call_id if seq is None else seq,
                     'content': pack([2, [], [0, 0, call_id], [result]])})


METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
           'select_character_id', 'get_super_orders')


def bundle():
    templates = {}
    for method in METHODS:
        call = msgpack.ExtType(10, pack([method, [10000000001, 8]]))
        templates[method] = {'content': pack([1, [0, 41, 9], [0, 0, 2], [call]]), 'flag': 0}
    return {'endpoint': ['192.0.2.10', 12345],
            'hello': {'token': '', 'synthetic': b'not-an-account'}, 'templates': templates}


def successful_login():
    return (frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
            + response(1, [0, {'client_id': 77, 'proxy_node_id': 88}])
            + response(2, [0]) + response(3, [0]) + response(4, 1))


class WireSocket:
    """A byte-stream boundary, not a replacement for RPC or parsing logic."""
    def __init__(self, data, chunk_size=7, timeout_when_empty=False):
        self.data = bytearray(data)
        self.chunk_size = chunk_size
        self.timeout_when_empty = timeout_when_empty
        self.sent = []
        self.closed = False
        self.timeouts = []

    def recv(self, size):
        if not self.data and self.timeout_when_empty:
            raise socket.timeout('synthetic sensitive remote detail')
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


class Modules(unittest.TestCase):
    def setUp(self):
        try:
            self.protocol = importlib.import_module('Market.collector_protocol')
            self.session = importlib.import_module('Market.session_bundle')
        except ModuleNotFoundError:
            self.fail('Market protocol/session implementation is not present yet')


class SessionBundleTests(Modules):
    def test_json_round_trip_preserves_binary_templates_without_dpapi(self):
        original = bundle()
        encoded = self.session.encode_session(original)
        document = json.loads(encoded)
        self.assertEqual(document['version'], 1)
        self.assertEqual(base64.b64decode(document['templates']['login_sigma']['content']['$binary']),
                         original['templates']['login_sigma']['content'])
        self.assertEqual(self.session.decode_session(encoded), original)

    def test_save_and_environment_load_of_private_synthetic_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'synthetic-session.json'
            self.session.save_session(bundle(), path)
            with patch.dict(os.environ, {'MARKET_SESSION_FILE': str(path)}):
                self.assertEqual(self.session.load_session(), bundle())
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_missing_environment_is_needs_auth_and_does_not_open_socket(self):
        with patch.dict(os.environ, {}, clear=True), patch('socket.create_connection') as connect:
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                self.session.load_session()
            self.assertEqual(caught.exception.code, 'needs_auth')
            connect.assert_not_called()

    def test_relative_path_and_invalid_bundle_fail_closed(self):
        with self.assertRaises(self.session.NeedsAuthError):
            self.session.load_session('relative.json')
        for document in ('not-json', '{}', '{"version":2}', '{"version":1,"version":1}'):
            with self.subTest(document=document), self.assertRaises(self.session.NeedsAuthError):
                self.session.decode_session(document)

    def test_template_method_mismatch_is_rejected(self):
        candidate = bundle()
        candidate['templates']['login_sigma'] = candidate['templates']['get_super_orders']
        with self.assertRaises(self.session.NeedsAuthError):
            self.session.encode_session(candidate)

    def test_missing_template_and_invalid_endpoint_are_rejected(self):
        for endpoint in (['http://example.invalid/secret', 80], ['192.0.2.10', True], ['192.0.2.10', 0]):
            candidate = bundle()
            candidate['endpoint'] = endpoint
            with self.subTest(endpoint=endpoint), self.assertRaises(self.session.NeedsAuthError):
                self.session.encode_session(candidate)
        candidate = bundle()
        del candidate['templates']['login_sigma']
        with self.assertRaises(self.session.NeedsAuthError):
            self.session.encode_session(candidate)

    def test_invalid_base64_has_safe_error(self):
        document = json.loads(self.session.encode_session(bundle()))
        document['templates']['login_sigma']['content'] = {'$binary': 'sensitive-invalid%'}
        with self.assertRaises(self.session.NeedsAuthError) as caught:
            self.session.decode_session(json.dumps(document))
        self.assertNotIn('sensitive', str(caught.exception))

    def test_linux_permissions_reject_public_or_foreign_owned_file(self):
        with patch.object(self.session.os, 'name', 'posix'), patch.object(self.session.os, 'geteuid', return_value=1000, create=True):
            for mode, owner in ((0o644, 1000), (0o600, 1001), (0o660, 1000)):
                with self.subTest(mode=mode, owner=owner), self.assertRaises(self.session.NeedsAuthError):
                    self.session._check_file_stat(SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=owner))
            self.session._check_file_stat(SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=1000))

    def test_oversized_bundle_is_rejected_before_json_decode(self):
        with self.assertRaises(self.session.NeedsAuthError):
            self.session.decode_session(' ' * (self.session.MAX_BUNDLE_SIZE + 1))

    def test_nonregular_session_file_is_rejected_before_open(self):
        fake_info = SimpleNamespace(st_mode=stat.S_IFIFO | 0o600, st_uid=1000)
        path = Path(tempfile.gettempdir()) / 'synthetic-fifo'
        with patch('pathlib.Path.lstat', return_value=fake_info), patch.object(self.session.os, 'open', side_effect=OSError('must not open')) as opened:
            with self.assertRaises(self.session.NeedsAuthError):
                self.session.load_session(path)
            opened.assert_not_called()

    def test_save_failure_and_missing_file_do_not_disclose_path(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'private-account-name' / 'session.json'
            for action in (lambda: self.session.load_session(path), lambda: self.session.save_session(bundle(), path)):
                with self.assertRaises(self.session.NeedsAuthError) as caught:
                    action()
                self.assertNotIn('private-account', str(caught.exception))


class QuoteTests(Modules):
    def test_summary_keeps_best_prices_and_bounded_sorted_top_five_levels(self):
        sell_prices = [11, 4, 9, 3, 8, 7, 5]
        buy_prices = [2, 12, 6, 10, 1, 14, 13]
        quote = self.protocol.summarize_orders([
            [{'price': price} for price in sell_prices],
            [{'price': price} for price in buy_prices],
        ])
        self.assertEqual(quote.sell_prices, tuple(Decimal(str(price)) for price in [3, 4, 5, 7, 8]))
        self.assertEqual(quote.buy_prices, tuple(Decimal(str(price)) for price in [14, 13, 12, 10, 6]))
        self.assertEqual((quote.best_sell, quote.best_buy, quote.sell_count, quote.buy_count),
                         (Decimal('3'), Decimal('14'), 7, 7))

    def test_dictionary_orders_and_absent_side(self):
        quote = self.protocol.summarize_orders([[{'price': 12.3}, {'price': 9}], []])
        self.assertEqual(quote.best_sell, Decimal('9'))
        self.assertIsNone(quote.best_buy)
        self.assertEqual((quote.sell_count, quote.buy_count), (2, 0))

    def test_schema_single_row_and_multiple_rows(self):
        fields = [['id'], ['price']]
        quote = self.protocol.summarize_orders([[fields, [1, 12.5]], [fields, [[2, 11], [3, 12]]]])
        self.assertEqual((quote.best_sell, quote.best_buy), (Decimal('12.5'), Decimal('12')))

    def test_both_empty_sides_are_not_zero(self):
        quote = self.protocol.summarize_orders([[], []])
        self.assertEqual((quote.best_sell, quote.best_buy, quote.sell_count, quote.buy_count), (None, None, 0, 0))

    def test_bad_prices_are_errors_not_empty_or_zero(self):
        for price in (True, False, -1, 0, float('nan'), float('inf'), '12.0', None):
            with self.subTest(price=price), self.assertRaises(self.protocol.ProtocolError):
                self.protocol.summarize_orders([[{'price': price}], []])

    def test_nonempty_unrecognized_orders_are_not_silently_empty(self):
        for result in ([{'changed_schema': 1}, []], [None, []], ['secret-remote-error', []], [[[['price']], [True]], []]):
            with self.subTest(result=result), self.assertRaises(self.protocol.ProtocolError) as caught:
                self.protocol.summarize_orders(result)
            self.assertNotIn('secret', str(caught.exception))

    def test_error_or_unknown_container_never_becomes_an_empty_quote(self):
        for sell_side in (
            {'error': 'AUTH_FAILED', 'details': []},
            {'changed_schema': []},
            {'error': 'AUTH_FAILED', 'orders': [{'price': 8}]},
            {'price': 8, 'error': 'AUTH_FAILED'},
        ):
            with self.subTest(sell_side=sell_side):
                with self.assertRaises(self.protocol.ProtocolError):
                    self.protocol.summarize_orders([sell_side, {}])

    def test_nested_observed_extensions_are_decoded(self):
        value = msgpack.ExtType(10, pack([msgpack.ExtType(55, pack({'price': 9}))]))
        self.assertEqual(self.protocol.unpack_nested(pack(value)), [{'price': 9}])

    def test_prices_fit_persistence_without_rounding_or_overflow(self):
        for price in (Decimal('1.001'), Decimal('1000000000000000000'), Decimal('1e1000')):
            with self.subTest(price=price), self.assertRaises(self.protocol.ProtocolError):
                self.protocol.summarize_orders([[{'price': price}], []])

    def test_original_observed_nested_schema_fixture_is_supported(self):
        rows = [[[[ 'price', 0], ['volume_remain', 0]], [[22427620.03, 3], [22450000.00, 1]]],
                {'nested': {'price': 22430000.25}}]
        self.assertEqual(self.protocol.extract_prices(rows),
                         [Decimal('22427620.03'), Decimal('22450000.0'), Decimal('22430000.25')])


class SessionPoolTests(Modules):
    def test_random_session_pool_uses_private_files_without_passwords(self):
        with tempfile.TemporaryDirectory() as temporary:
            first = Path(temporary) / 'session-a.json'
            second = Path(temporary) / 'session-b.json'
            self.session.save_session(bundle(), first)
            self.session.save_session(bundle(), second)
            with patch.dict(os.environ, {'MARKET_SESSION_FILES': os.pathsep.join((str(first), str(second)))}, clear=False):
                loaded = self.session.load_session_pool()
                with patch.object(self.session.random, 'choice', return_value=loaded[1]) as choose:
                    selected = self.session.load_random_session()
            self.assertEqual(len(loaded), 2)
            self.assertEqual(selected, loaded[1])
            choose.assert_called_once()


class TransportTests(Modules):
    def test_cycle_authenticates_queries_and_closes_without_mutating_templates(self):
        original = bundle()
        before = copy.deepcopy(original)
        wire = WireSocket(successful_login() + response(5, [[{'price': 8.5}], [{'price': 8}]]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(original) as client:
                self.assertEqual(client.quote(10000000005, 9).best_sell, Decimal('8.5'))
            self.assertTrue(wire.closed)
        self.assertEqual(original, before)
        outer = msgpack.unpackb(wire.sent[-1][4:], raw=False)
        meta = msgpack.unpackb(outer[1], raw=False)
        body = msgpack.unpackb(meta['content'], raw=False)
        call = msgpack.unpackb(body[3][0].data, raw=False)
        self.assertEqual(call, ['get_super_orders', [10000000005, 9]])
        self.assertEqual(body[1][1:], [77, 5])
        self.assertEqual(body[2][2], 88)
        self.assertEqual((meta['seq'], meta['ack']), (4, 5))

    def test_each_context_opens_a_fresh_connection_and_resets_sequence(self):
        first, second = WireSocket(successful_login()), WireSocket(successful_login())
        client = self.protocol.MarketSession(bundle())
        with patch('Market.collector_protocol.socket.create_connection', side_effect=[first, second]) as connect:
            with client:
                pass
            with client:
                pass
            self.assertEqual(connect.call_count, 2)
        self.assertTrue(first.closed and second.closed)

    def test_login_rejection_is_needs_auth_and_closes_socket_without_remote_text(self):
        wire = WireSocket(frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                          + response(1, ['private-account-detail']))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                with self.protocol.MarketSession(bundle()):
                    self.fail('Rejected login entered the context')
        self.assertTrue(wire.closed)
        self.assertNotIn('private-account', str(caught.exception))

    def test_timeout_is_bounded_safe_and_closes_context(self):
        wire = WireSocket(successful_login(), timeout_when_empty=True)
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.assertRaises(self.protocol.ProtocolError) as caught:
                with self.protocol.MarketSession(bundle(), timeout=0.5) as client:
                    client.quote(10000000001)
        self.assertTrue(wire.closed)
        self.assertEqual(caught.exception.code, 'timeout')
        self.assertNotIn('sensitive', str(caught.exception))

    def test_unrelated_rpc_is_ignored_and_server_sequence_acknowledged(self):
        wire = WireSocket(successful_login() + response(999, ['ignored'], seq=50) + response(5, [[], []], seq=51))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(bundle()) as client:
                client.quote(10000000001)
                self.assertEqual(client.next_server_seq, 52)

    def test_frame_limits_and_truncated_stream_fail_safely(self):
        for payload in (struct.pack('<I', 0), struct.pack('<I', 10000001), b'\x01', struct.pack('<I', 1) + b'\xc1'):
            wire = WireSocket(payload)
            with self.subTest(payload=payload), patch('Market.collector_protocol.socket.create_connection', return_value=wire):
                with self.assertRaises(self.protocol.ProtocolError):
                    with self.protocol.MarketSession(bundle()):
                        pass
            self.assertTrue(wire.closed)

    def test_invalid_item_never_sends_market_rpc(self):
        wire = WireSocket(successful_login())
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(bundle()) as client:
                sent = len(wire.sent)
                with self.assertRaises(self.protocol.ProtocolError):
                    client.quote(True)
                self.assertEqual(len(wire.sent), sent)

    def test_invalid_bundle_is_rejected_before_connection(self):
        with patch('Market.collector_protocol.socket.create_connection') as connect:
            with self.assertRaises(self.session.NeedsAuthError):
                with self.protocol.MarketSession({}):
                    pass
            connect.assert_not_called()

    def test_noninteger_rpc_call_id_cannot_spoof_matching_response(self):
        wire = WireSocket(successful_login() + response(5.0, [[{'price': 99}], []])
                          + response(5, [[{'price': 8}], []]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(bundle()) as client:
                self.assertEqual(client.quote(10000000001).best_sell, Decimal('8'))

    def test_total_rpc_deadline_is_not_reset_for_fragmented_frames(self):
        wire = WireSocket(successful_login() + response(5, [[], []]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(bundle(), timeout=0.5) as client:
                with patch('Market.collector_protocol.time.monotonic', side_effect=[0, 0, 0.2, 0.6]):
                    with self.assertRaises(self.protocol.ProtocolError) as caught:
                        client.quote(10000000001)
                self.assertEqual(caught.exception.code, 'timeout')
                self.assertTrue(wire.closed)

    def test_character_entry_failure_is_needs_auth(self):
        wire = WireSocket(frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                          + response(1, [0, {'client_id': 77, 'proxy_node_id': 88}])
                          + response(2, ['private-character-info']))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                with self.protocol.MarketSession(bundle()):
                    pass
        self.assertTrue(wire.closed)
        self.assertNotIn('private-character', str(caught.exception))

    def test_parse_failure_for_one_item_allows_next_well_formed_item(self):
        wire = WireSocket(successful_login() + response(5, [[{'price': -1}], []])
                          + response(6, [[{'price': 8}], []]))
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire):
            with self.protocol.MarketSession(bundle()) as client:
                with self.assertRaises(self.protocol.ProtocolError):
                    client.quote(10000000001)
                self.assertFalse(wire.closed)
                self.assertEqual(client.quote(10000000002).best_sell, Decimal('8'))


if __name__ == '__main__':
    unittest.main()
