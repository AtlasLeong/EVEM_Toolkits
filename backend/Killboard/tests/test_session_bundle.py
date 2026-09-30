"""Private Killboard bundle checks using invented material only."""

import importlib
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import msgpack


METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
           'select_character_id', 'get_kill_info')


def pack(value):
    return msgpack.packb(value, use_bin_type=True)


def synthetic_bundle(marker=b'synthetic-not-an-account'):
    templates = {}
    for method in METHODS:
        args = [100] if method == 'get_kill_info' else [marker]
        call = msgpack.ExtType(10, pack([method, args]))
        destination = 'char_mgr' if method == 'get_kill_info' else 'synthetic_auth'
        templates[method] = {
            'content': pack([1, [0, 41, 9], [0, destination, 2], [call]]), 'flag': 0,
        }
    return {'endpoint': ['192.0.2.10', 12345],
            'hello': {'token': '', 'synthetic': marker}, 'templates': templates}


def with_profiles(bundle=None):
    bundle = bundle or synthetic_bundle()
    for method, destination in (('get_public_info', 'char_proxy'), ('get_corp_brief', 'corp_rec_proxy')):
        call = msgpack.ExtType(10, pack([method, [[101]], {}]))
        bundle['templates'][method] = {'content': pack([1, [0, 41, 9], [0, destination, 2], [call]])}
    return bundle


class SessionBundleTests(unittest.TestCase):
    def setUp(self):
        try:
            self.session = importlib.import_module('Killboard.session_bundle')
        except ModuleNotFoundError:
            self.fail('Killboard private bundle implementation is missing')

    def test_round_trip_preserves_bytes_and_detaches_caller_data(self):
        original = synthetic_bundle()
        encoded = self.session.encode_session(original)
        self.assertEqual(json.loads(encoded)['version'], 1)
        self.assertEqual(self.session.decode_session(encoded), original)
        validated = self.session.validate_session(original)
        validated['hello']['token'] = 'different'
        self.assertEqual(original['hello']['token'], '')

    def test_optional_observed_batch_profiles_preserve_five_template_compatibility(self):
        candidate = with_profiles()
        self.assertEqual(self.session.decode_session(self.session.encode_session(candidate)), candidate)
        self.assertEqual(self.session.validate_session(synthetic_bundle()), synthetic_bundle())

    def test_optional_profiles_reject_wrong_route_scalar_invalid_ids_and_oversize(self):
        for method, destination, args in (
            ('get_public_info', 'char_mgr', [[101]]),
            ('get_public_info', 'char_proxy', [101]),
            ('get_public_info', 'char_proxy', [[True]]),
            ('get_public_info', 'char_proxy', [[0]]),
            ('get_public_info', 'char_proxy', [[101, 101]]),
            ('get_corp_brief', 'corp_rec_proxy', [[]]),
            ('get_corp_brief', 'corp_rec_proxy', [list(range(1, 514))]),
        ):
            candidate = with_profiles()
            candidate['templates'][method]['content'] = pack(
                [1, [0, 41, 9], [0, destination, 2], [msgpack.ExtType(10, pack([method, args, {}]))]])
            with self.subTest(method=method, destination=destination), self.assertRaises(self.session.NeedsAuthError):
                self.session.validate_session(candidate)

    def test_save_never_overwrites_or_follows_symlink_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'private.json'
            self.session.save_session(synthetic_bundle(b'first'), path)
            with self.assertRaises(self.session.NeedsAuthError):
                self.session.save_session(synthetic_bundle(b'second'), path)
            self.assertEqual(self.session.load_session(path)['hello']['synthetic'], b'first')
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.save_session(synthetic_bundle(), Path(temporary) / 'other.json')

    def test_kill_template_is_required_and_market_or_mutating_methods_are_denied(self):
        missing = synthetic_bundle()
        del missing['templates']['get_kill_info']
        candidates = [missing]
        for method in ('get_super_orders', 'buy', 'get_public_info'):
            candidate = synthetic_bundle()
            candidate['templates'][method] = candidate['templates']['get_kill_info']
            candidates.append(candidate)
        for candidate in candidates:
            with self.subTest(methods=list(candidate['templates'])):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.validate_session(candidate)

    def test_kill_call_requires_ext10_exact_method_single_valid_id_and_char_mgr(self):
        for extension_code, method, args, destination in (
            (19, 'get_kill_info', [100], 'char_mgr'),
            (10, 'buy', [100], 'char_mgr'),
            (10, 'get_kill_info', [100, 8], 'char_mgr'),
            (10, 'get_kill_info', [True], 'char_mgr'),
            (10, 'get_kill_info', [0], 'char_mgr'),
            (10, 'get_kill_info', [2**63], 'char_mgr'),
            (10, 'get_kill_info', [100], 'market_mgr'),
        ):
            candidate = synthetic_bundle()
            body = [1, [0, 41, 9], [0, destination, 2],
                    [msgpack.ExtType(extension_code, pack([method, args]))]]
            candidate['templates']['get_kill_info']['content'] = pack(body)
            with self.subTest(method=method, args=args, destination=destination):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.validate_session(candidate)

    def test_auth_template_method_mismatch_and_non_ext10_are_rejected(self):
        for method, extension_code in (('get_kill_info', 10), ('login_sigma', 19)):
            candidate = synthetic_bundle()
            candidate['templates']['login_sigma']['content'] = pack(
                [1, [0, 41, 9], [0, 'synthetic_auth', 2],
                 [msgpack.ExtType(extension_code, pack([method, []]))]])
            with self.subTest(method=method, extension_code=extension_code):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.validate_session(candidate)

    def test_auth_arguments_can_contain_an_opaque_extension(self):
        candidate = synthetic_bundle()
        body = msgpack.unpackb(candidate['templates']['login_sigma']['content'], raw=False)
        body[3][0] = msgpack.ExtType(10, pack(['login_sigma', [msgpack.ExtType(55, b'synthetic')]]))
        candidate['templates']['login_sigma']['content'] = pack(body)
        self.assertEqual(self.session.decode_session(self.session.encode_session(candidate)), candidate)

    def test_captured_empty_kwargs_dictionary_is_preserved_for_all_methods(self):
        candidate = synthetic_bundle()
        for meta in candidate['templates'].values():
            body = msgpack.unpackb(meta['content'], raw=False)
            call = msgpack.unpackb(body[3][0].data, raw=False)
            call.append({})
            body[3][0] = msgpack.ExtType(10, pack(call))
            meta['content'] = pack(body)
        try:
            recovered = self.session.decode_session(self.session.encode_session(candidate))
        except self.session.NeedsAuthError:
            self.fail('Observed empty-kwargs call shape must be accepted')
        self.assertEqual(recovered, candidate)

    def test_hidden_extra_rpc_or_top_level_payload_is_denied(self):
        for extra_location in ('rpc_payload', 'top_level'):
            candidate = synthetic_bundle()
            body = msgpack.unpackb(candidate['templates']['get_kill_info']['content'], raw=False)
            hidden = msgpack.ExtType(10, pack(['buy', [123, 1]]))
            if extra_location == 'rpc_payload':
                body[3].append(hidden)
            else:
                body.append(hidden)
            candidate['templates']['get_kill_info']['content'] = pack(body)
            with self.subTest(extra_location=extra_location):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.validate_session(candidate)

    def test_unobserved_call_kwargs_or_trailing_call_fields_are_denied(self):
        for tail in ([{'private-marker': True}], [False], [{}, 'extra']):
            candidate = synthetic_bundle()
            body = msgpack.unpackb(candidate['templates']['get_kill_info']['content'], raw=False)
            body[3][0] = msgpack.ExtType(10, pack(['get_kill_info', [100], *tail]))
            candidate['templates']['get_kill_info']['content'] = pack(body)
            with self.subTest(tail=tail):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.validate_session(candidate)

    def test_invalid_endpoint_flag_and_depth_are_sanitized(self):
        candidates = []
        for endpoint in (['password.example.invalid', 80], ['192.0.2.10', True], ['192.0.2.10', 0]):
            candidate = synthetic_bundle()
            candidate['endpoint'] = endpoint
            candidates.append(candidate)
        for flag in ('private-secret', True, -1):
            candidate = synthetic_bundle()
            candidate['templates']['get_kill_info']['flag'] = flag
            candidates.append(candidate)
        candidate = synthetic_bundle()
        nested = 'private-secret'
        for _ in range(40):
            nested = [nested]
        candidate['hello']['nested'] = nested
        candidates.append(candidate)
        for candidate in candidates:
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                self.session.validate_session(candidate)
            self.assertEqual(caught.exception.code, 'unauthorized')
            self.assertNotIn('private-secret', str(caught.exception))

    def test_bad_json_duplicate_keys_base64_and_oversize_are_rejected(self):
        document = json.loads(self.session.encode_session(synthetic_bundle()))
        document['hello']['synthetic'] = {'$binary': 'private-invalid%'}
        for encoded in ('{}', 'not-json', '{"version":1,"version":1}',
                        json.dumps(document), ' ' * (self.session.MAX_BUNDLE_SIZE + 1)):
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                self.session.decode_session(encoded)
            self.assertNotIn('private-invalid', str(caught.exception))

    def test_save_and_load_private_synthetic_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'private.json'
            self.session.save_session(synthetic_bundle(), path)
            self.assertEqual(self.session.load_session(path), synthetic_bundle())
            if os.name == 'posix':
                self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)

    def test_file_error_never_discloses_path_or_reads_nonregular_file(self):
        path = Path(tempfile.gettempdir()) / 'private-account-name.json'
        with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFIFO | 0o600)):
            with patch.object(self.session.os, 'open') as opened:
                with self.assertRaises(self.session.NeedsAuthError) as caught:
                    self.session.load_session(path)
                opened.assert_not_called()
        self.assertNotIn('private-account', str(caught.exception))

    def test_posix_permission_and_ownership_checks_require_0600_owner(self):
        with patch.object(self.session.os, 'name', 'posix'):
            with patch.object(self.session.os, 'geteuid', return_value=1000, create=True):
                for mode, owner in ((0o644, 1000), (0o400, 1000), (0o600, 1001)):
                    with self.subTest(mode=mode, owner=owner):
                        with self.assertRaises(self.session.NeedsAuthError):
                            self.session._check_file_stat(SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=owner))
                self.session._check_file_stat(SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=1000))

    def test_file_replacement_race_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'synthetic.json'
            self.session.save_session(synthetic_bundle(), path)
            actual = path.lstat()
            changed = SimpleNamespace(st_mode=actual.st_mode, st_uid=getattr(actual, 'st_uid', 0),
                                      st_size=actual.st_size, st_dev=actual.st_dev, st_ino=actual.st_ino + 1)
            with patch.object(Path, 'lstat', return_value=changed):
                with self.assertRaises(self.session.NeedsAuthError):
                    self.session.load_session(path)

    def test_pool_uses_only_explicit_absolute_unique_paths_and_caps_at_201(self):
        root = Path(tempfile.gettempdir())
        for paths in ([], ['relative.json'], [root / 'one', root / 'one'],
                      [root / str(index) for index in range(202)]):
            with self.subTest(count=len(paths)):
                with patch.object(self.session, 'load_session') as load:
                    with self.assertRaises(self.session.NeedsAuthError):
                        self.session.load_session_pool(paths)
                    load.assert_not_called()
        paths = [root / str(index) for index in range(201)]
        with patch.object(self.session, 'load_session', side_effect=[synthetic_bundle(bytes([index])) for index in range(201)]):
            self.assertEqual(len(self.session.load_session_pool(paths)), 201)

    def test_missing_pool_environment_does_not_read_password_or_market_settings(self):
        with patch.dict(os.environ, {'MARKET_SESSION_FILE': 'private-marker',
                                    'KILLBOARD_PASSWORD': 'private-marker'}, clear=True):
            with self.assertRaises(self.session.NeedsAuthError) as caught:
                self.session.load_session_pool()
        self.assertNotIn('private-marker', str(caught.exception))

    def test_environment_pool_random_choice_selects_once_without_fallback_order(self):
        with tempfile.TemporaryDirectory() as temporary:
            first, second = Path(temporary) / 'one.json', Path(temporary) / 'two.json'
            bundles = [synthetic_bundle(b'one'), synthetic_bundle(b'two')]
            self.session.save_session(bundles[0], first)
            self.session.save_session(bundles[1], second)
            with patch.dict(os.environ, {'KILLBOARD_SESSION_FILES': os.pathsep.join(map(str, [first, second]))}):
                with patch.object(self.session.random, 'choice', side_effect=lambda pool: pool[1]) as choose:
                    self.assertEqual(self.session.load_random_session(), bundles[1])
                choose.assert_called_once()

    def test_pool_rejects_duplicate_session_material_in_different_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            paths = [Path(temporary) / name for name in ('one.json', 'two.json')]
            for path in paths:
                self.session.save_session(synthetic_bundle(), path)
            with self.assertRaises(self.session.NeedsAuthError):
                self.session.load_session_pool(paths)


if __name__ == '__main__':
    unittest.main()
