"""Synthetic strict-protocol and durable-snapshot contracts; no game traffic."""
import copy
import importlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import msgpack


def pack(value):
    return msgpack.packb(value, use_bin_type=True)


def bundle():
    methods = ('login_sigma', 'request_start_wait', 'get_newbie_info',
               'select_character_id', 'get_dungeon_destroy_statistics')
    return {'endpoint': ['192.0.2.1', 15182], 'hello': {'token': '', 'synthetic': b'opaque'},
            'templates': {method: {'flag': 2, 'content': pack(
                [1, [0, 41, 9], [0, 'char_mgr', -1],
                 [msgpack.ExtType(10, pack([method, [] if method == methods[-1] else [42], {}]))]])}
                for method in methods}}


def wire(rows, schema=112):
    return msgpack.ExtType(10, pack([msgpack.ExtType(19, pack([schema, pack(row)])) for row in rows]))


class ModuleTests(unittest.TestCase):
    def require(self, name):
        self.assertIsNotNone(importlib.util.find_spec('AnomalyHotspots.' + name), name + ' module missing')
        return importlib.import_module('AnomalyHotspots.' + name)


class ProtocolTests(ModuleTests):
    def test_total_count_is_also_safe_for_exact_region_aggregation(self):
        api = self.require('protocol')
        with self.assertRaises(api.AnomalyProtocolError):
            api.decode_statistics(wire([{'solar_system_id': 1, 'destroy_num': api.MAX_SAFE_INTEGER},
                                        {'solar_system_id': 2, 'destroy_num': 1}]))
    def test_exact_observed_rows_and_transport_unwrapped_list(self):
        api = self.require('protocol')
        rows = [{'solar_system_id': 30001211, 'destroy_num': 155},
                {'solar_system_id': 30000001, 'destroy_num': 0}]
        expected = sorted(rows, key=lambda row: row['solar_system_id'])
        self.assertEqual(api.decode_statistics(wire(rows)), expected)
        self.assertEqual(api.decode_statistics(msgpack.unpackb(wire(rows).data, raw=False)), expected)
        self.assertEqual(api.decode_statistics(wire([])), [])

    def test_observed_schema_113_preserves_the_exact_row_contract(self):
        api = self.require('protocol')
        rows = [{'solar_system_id': 30001211, 'destroy_num': 5},
                {'solar_system_id': 30000001, 'destroy_num': 0}]
        expected = sorted(rows, key=lambda row: row['solar_system_id'])
        response = wire(rows, schema=113)
        self.assertEqual(api.decode_statistics(response), expected)
        self.assertEqual(api.decode_statistics(msgpack.unpackb(response.data, raw=False)), expected)

    def test_schema_113_does_not_relax_field_value_or_record_validation(self):
        api = self.require('protocol')
        good = {'solar_system_id': 30001211, 'destroy_num': 5}
        invalid_rows = [[good, good], [{**good, 'private': 'secret'}],
                        [{'system_id': 1, 'destroy_num': 1}],
                        [{'solar_system_id': True, 'destroy_num': 1}],
                        [{'solar_system_id': 1, 'destroy_num': True}],
                        [{'solar_system_id': 1, 'destroy_num': -1}],
                        [{'solar_system_id': 1, 'destroy_num': 2**53}]]
        candidates = [wire(rows, schema=113) for rows in invalid_rows]
        candidates.extend([
            [msgpack.ExtType(58, pack([113, pack(good)]))],
            [msgpack.ExtType(19, pack([113, good]))],
            [msgpack.ExtType(19, pack([113, pack(good), 'extra']))],
        ])
        for response in candidates:
            with self.subTest(response=type(response).__name__), self.assertRaises(api.AnomalyProtocolError):
                api.decode_statistics(response)

    def test_unobserved_schema_ids_and_non_integer_schema_types_remain_rejected(self):
        api = self.require('protocol')
        row = {'solar_system_id': 30001211, 'destroy_num': 5}
        for schema in (111, 114, 115, True, 112.0, 113.0, '113', None):
            with self.subTest(schema=schema), self.assertRaises(api.AnomalyProtocolError):
                api.decode_statistics(wire([row], schema=schema))

    def test_rejects_drift_duplicates_bool_negative_and_unsafe_numbers(self):
        api = self.require('protocol')
        good = {'solar_system_id': 30001211, 'destroy_num': 155}
        candidates = [wire([good, good]), wire([{'solar_system_id': True, 'destroy_num': 1}]),
                      wire([{'solar_system_id': 0, 'destroy_num': 1}]),
                      wire([{'solar_system_id': 1, 'destroy_num': True}]),
                      wire([{'solar_system_id': 1, 'destroy_num': -1}]),
                      wire([{'solar_system_id': 1, 'destroy_num': 2**53}]),
                      wire([{**good, 'private': 'secret'}]), wire([{'system_id': 1, 'destroy_num': 2}]),
                      {'nested': [good]}, [good], msgpack.ExtType(55, pack([good])),
                      msgpack.ExtType(10, pack(wire([good]))),
                      [msgpack.ExtType(58, pack([112, pack(good)]))],
                      [msgpack.ExtType(19, pack([114, pack(good)]))],
                      [msgpack.ExtType(19, pack([112, good]))],
                      [msgpack.ExtType(19, pack([112, pack(good), 'extra']))],
                      [msgpack.ExtType(19, b'x' * (api.MAX_RESPONSE_BYTES + 1))]]
        for value in candidates:
            with self.subTest(value=type(value).__name__), self.assertRaises(api.AnomalyProtocolError) as error:
                api.decode_statistics(value)
            self.assertNotIn('secret', str(error.exception))
        with patch.object(api, 'MAX_SYSTEMS', 1), self.assertRaises(api.AnomalyProtocolError):
            api.decode_statistics(wire([good, {'solar_system_id': 2, 'destroy_num': 0}]))


class BundleTests(ModuleTests):
    def test_roundtrip_detached_private_file_and_km_allowlist_unchanged(self):
        api = self.require('session_bundle')
        candidate = bundle()
        self.assertEqual(api.decode_session(api.encode_session(candidate)), candidate)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private.json'
            api.save_session(candidate, path)
            self.assertEqual(api.load_session(path), candidate)
            with self.assertRaises(api.SessionBundleError):
                api.save_session(candidate, path)
        from Killboard.session_bundle import validate_session, SessionBundleError
        with self.assertRaises(SessionBundleError):
            validate_session(candidate)

    def test_exact_capabilities_route_args_kwargs_and_private_error(self):
        api = self.require('session_bundle')
        candidates = []
        for change in ('extra', 'missing', 'kwargs', 'args', 'route', 'target', 'ext', 'top'):
            candidate = bundle()
            method = 'get_dungeon_destroy_statistics'
            if change == 'extra':
                candidate['templates']['get_kill_info'] = candidate['templates'][method]
            elif change == 'missing':
                del candidate['templates']['login_sigma']
            elif change == 'top':
                candidate['secret'] = 'private-secret'
            else:
                body = msgpack.unpackb(candidate['templates'][method]['content'], raw=False)
                call = [method, [], {}]
                if change == 'kwargs': call[2] = {'private-secret': 1}
                if change == 'args': call[1] = [1]
                if change == 'route': body[2][1] = 'other'
                if change == 'target': body[2][2] = 4
                body[3][0] = msgpack.ExtType(19 if change == 'ext' else 10, pack(call))
                candidate['templates'][method]['content'] = pack(body)
            candidates.append(candidate)
        for candidate in candidates:
            with self.assertRaises(api.SessionBundleError) as error:
                api.validate_session(candidate)
            self.assertNotIn('private-secret', str(error.exception))
        for encoded in ('{}', '{"version":1,"version":1}', 'x' * (api.MAX_BUNDLE_SIZE + 1)):
            with self.assertRaises(api.SessionBundleError): api.decode_session(encoded)


class SnapshotTests(ModuleTests):
    @unittest.skipUnless(os.name == 'posix', 'POSIX filesystem security contract')
    def test_protected_owner_mode_and_setgid_group_inheritance(self):
        api = self.require('snapshot')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            for mode in (0o700, 0o755, 0o777):
                path.parent.chmod(mode)
                with self.assertRaises(api.SnapshotError): api.write_success(path, [], now_ms=1000)
            path.parent.chmod(0o2750)
            api.write_success(path, [], now_ms=1000)
            self.assertEqual(path.stat().st_mode & 0o7777, 0o640)
            self.assertEqual(path.stat().st_uid, os.geteuid())
            self.assertEqual(path.stat().st_gid, path.parent.stat().st_gid)
            path.chmod(0o644)
            self.assertEqual(api.read_snapshot(path)['status'], 'unavailable')

    @unittest.skipUnless(os.name == 'posix', 'POSIX private-bundle security contract')
    def test_private_bundle_public_permissions_and_oversize_fail_closed(self):
        api = self.require('session_bundle')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'private.json'
            api.save_session(bundle(), path)
            self.assertEqual(path.stat().st_mode & 0o7777, 0o600)
            path.chmod(0o644)
            with self.assertRaises(api.SessionBundleError): api.load_session(path)
            path.chmod(0o600)
            path.write_bytes(b'x' * (api.MAX_BUNDLE_SIZE + 1))
            with self.assertRaises(api.SessionBundleError): api.load_session(path)
    def test_atomic_success_and_failure_preserve_last_good(self):
        api = self.require('snapshot')
        rows = [{'solar_system_id': 2, 'destroy_num': 5}]
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            if os.name == 'posix': path.parent.chmod(0o750)
            initial = api.read_snapshot(path)
            self.assertEqual(initial['status'], 'unavailable')
            api.write_success(path, rows, now_ms=1000)
            saved = api.read_snapshot(path)
            self.assertEqual(saved, {'version': 1, 'collected_at_ms': 1000,
                                     'last_attempt_at_ms': 1000, 'status': 'ok',
                                     'systems': rows, 'statistics_window': None})
            api.write_failure(path, 'rate_limited', now_ms=2000)
            failed = api.read_snapshot(path)
            self.assertEqual(failed['systems'], rows)
            self.assertEqual(failed['collected_at_ms'], 1000)
            self.assertEqual(failed['last_attempt_at_ms'], 2000)
            self.assertEqual(failed['status'], 'rate_limited')
            self.assertIsNone(failed['statistics_window'])
            with self.assertRaises(api.SnapshotError):
                api.write_failure(path, 'raw-private-exception', now_ms=3000)
            self.assertEqual(api.read_snapshot(path), failed)

    def test_rejects_unknown_fields_corrupt_oversize_and_link_components(self):
        api = self.require('snapshot')
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            if os.name == 'posix': path.parent.chmod(0o750)
            api.write_success(path, [], now_ms=1000)
            good = json.loads(path.read_text())
            for candidate in ({**good, 'secret': 'private'}, {**good, 'statistics_window': '24h'},
                              {**good, 'systems': [{'solar_system_id': True, 'destroy_num': 1}]}):
                path.write_text(json.dumps(candidate))
                self.assertEqual(api.read_snapshot(path)['status'], 'unavailable')
            path.write_text('x' * (api.MAX_SNAPSHOT_BYTES + 1))
            self.assertEqual(api.read_snapshot(path)['status'], 'unavailable')
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaises(api.SnapshotError): api.write_success(path, [], now_ms=2000)


if __name__ == '__main__':
    unittest.main()
