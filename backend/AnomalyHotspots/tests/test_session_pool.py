"""Offline conversion and explicit rotation using synthetic private material."""
import copy
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import msgpack
from AnomalyHotspots import session_bundle as api
from AnomalyHotspots.tests.test_core import bundle, pack
from Killboard import session_bundle as km


def km_bundle(number=0, target=-1, profiles=False):
    value = bundle()
    value['hello']['synthetic'] = ('opaque-' + str(number)).encode()
    body = msgpack.unpackb(value['templates'].pop(api.HOTSPOT_METHOD)['content'], raw=False)
    body[2][2] = target
    body[3][0] = msgpack.ExtType(10, pack(['get_kill_info', [20000001], {}]))
    value['templates']['get_kill_info'] = {'flag': 7, 'content': pack(body)}
    if profiles:
        for method, route in km.PROFILE_ROUTES.items():
            value['templates'][method] = {'content': pack(
                [1, [0, 41, 9], [0, route, -1], [msgpack.ExtType(10, pack([method, [[42]], {}]))]])}
    return value


class ConversionTests(unittest.TestCase):
    def test_conversion_preserves_own_auth_route_and_flags_without_source_mutation(self):
        self.assertTrue(callable(getattr(api, 'derive_from_killboard', None)), 'conversion missing')
        source = km_bundle(profiles=True)
        before = copy.deepcopy(source)
        with patch('socket.create_connection') as opened:
            result = api.derive_from_killboard(source)
        opened.assert_not_called()
        self.assertEqual(source, before)
        self.assertEqual(set(result['templates']), set(api.REQUIRED_METHODS))
        self.assertEqual(result['endpoint'], source['endpoint'])
        self.assertEqual(result['hello'], source['hello'])
        for method in api.AUTH_METHODS:
            self.assertEqual(result['templates'][method], source['templates'][method])
        original = msgpack.unpackb(source['templates']['get_kill_info']['content'], raw=False)
        derived = msgpack.unpackb(result['templates'][api.HOTSPOT_METHOD]['content'], raw=False)
        self.assertEqual(derived[:3], original[:3])
        self.assertEqual(result['templates'][api.HOTSPOT_METHOD]['flag'], 7)
        self.assertEqual(msgpack.unpackb(derived[3][0].data, raw=False), [api.HOTSPOT_METHOD, [], {}])
        api.validate_session(result)
        result['hello']['token'] = 'modified'
        self.assertEqual(source, before)
        with self.assertRaises(km.SessionBundleError): km.validate_session(result)

    def test_incompatible_targets_or_invalid_km_capture_rejected(self):
        self.assertTrue(callable(getattr(api, 'derive_from_killboard', None)), 'conversion missing')
        for target in (1, True, '-1'):
            with self.subTest(target=target), self.assertRaises(api.SessionBundleError):
                api.derive_from_killboard(km_bundle(target=target))
        for value in (None, bundle(), {**km_bundle(), 'private': 'secret'}):
            with self.assertRaises(api.SessionBundleError) as error: api.derive_from_killboard(value)
            self.assertNotIn('secret', str(error.exception))


class PoolTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.parent = Path(self.temporary.name)
        self.parent.chmod(0o700)
        self.paths = []
        for index in range(7):
            value = bundle()
            value['hello']['synthetic'] = ('opaque-' + str(index)).encode()
            path = self.parent / ('private-' + str(index) + '.json')
            api.save_session(value, path)
            self.paths.append(path)
        self.cursor = self.parent / 'anomaly-cursor.json'
        self.environment = {'ANOMALY_SESSION_FILES': os.pathsep.join(map(str, self.paths)),
                            'ANOMALY_SESSION_CURSOR_FILE': str(self.cursor)}

    def select(self, env=None):
        self.assertTrue(callable(getattr(api, 'load_round_robin_session', None)), 'pool selector missing')
        with patch.dict(os.environ, self.environment if env is None else env, clear=True):
            return api.load_round_robin_session()

    def test_seven_cycle_restart_continuation_and_unchanged_sources(self):
        before = [path.read_bytes() for path in self.paths]
        selections = [self.select() for _ in range(9)]
        self.assertEqual([item[1:] for item in selections],
                         [(chr(65 + index % 7), index % 7, 7) for index in range(9)])
        self.assertEqual(json.loads(self.cursor.read_text()), 2)
        self.assertEqual([path.read_bytes() for path in self.paths], before)
        for number, (value, _, _, _) in enumerate(selections):
            self.assertEqual(value['hello']['synthetic'], ('opaque-' + str(number % 7)).encode())

    def test_singular_compatibility_and_conflicting_or_missing_configuration(self):
        value, slot, index, size = self.select({'ANOMALY_SESSION_FILE': str(self.paths[2])})
        self.assertEqual((slot, index, size), ('A', 0, 1))
        self.assertEqual(value, api.load_session(self.paths[2]))
        self.assertFalse(self.cursor.exists())
        for env in ({}, {'ANOMALY_SESSION_FILES': str(self.paths[0]), 'ANOMALY_SESSION_FILE': str(self.paths[1])},
                    {'ANOMALY_SESSION_FILES': str(self.paths[0]), 'ANOMALY_SESSION_FILE': str(self.paths[0])},
                    {'ANOMALY_SESSION_FILES': os.pathsep.join(map(str, self.paths))},
                    {'ANOMALY_SESSION_FILES': 'relative.json'},
                    {'ANOMALY_SESSION_FILES': os.pathsep.join([str(self.paths[0]), ''])}):
            with self.subTest(env=list(env)), self.assertRaises(api.SessionBundleError): self.select(env)

    def test_whole_pool_validation_and_bounded_pool_before_cursor_advance(self):
        self.cursor.write_text('3')
        self.cursor.chmod(0o600)
        self.paths[-1].write_text('{}')
        with self.assertRaises(api.SessionBundleError): self.select()
        self.assertEqual(self.cursor.read_text(), '3')
        with patch.object(api, 'MAX_SESSIONS', 6), self.assertRaises(api.SessionBundleError): self.select()

    def test_duplicate_paths_material_and_inodes_fail_closed(self):
        self.assertTrue(callable(getattr(api, 'load_round_robin_session', None)), 'pool selector missing')
        duplicate = self.parent / 'copy.json'
        duplicate.write_bytes(self.paths[0].read_bytes())
        duplicate.chmod(0o600)
        hardlink = self.parent / 'hardlink.json'
        os.link(self.paths[0], hardlink)
        for paths in ([self.paths[0], self.paths[0]], [self.paths[0], duplicate], [self.paths[0], hardlink]):
            env = {**self.environment, 'ANOMALY_SESSION_FILES': os.pathsep.join(map(str, paths))}
            with self.subTest(paths=len(paths)), self.assertRaises(api.SessionBundleError): self.select(env)
        self.assertFalse(self.cursor.exists())

    def test_cursor_corruption_restarts_but_oversize_fails_closed(self):
        for content in ('broken', 'true', '-1', '99', '{"private":"x"}'):
            self.cursor.write_text(content)
            self.cursor.chmod(0o600)
            self.assertEqual(self.select()[1:], ('A', 0, 7))
        self.cursor.write_bytes(b'x' * 129)
        with self.assertRaises(api.SessionBundleError): self.select()
        self.assertEqual(self.cursor.stat().st_size, 129)

    def test_cursor_never_collides_with_source_or_km_cursor(self):
        original = self.paths[0].read_bytes()
        for collision in (self.paths[0], self.cursor):
            env = {**self.environment, 'ANOMALY_SESSION_CURSOR_FILE': str(collision),
                   'KILLBOARD_SESSION_CURSOR_FILE': str(self.cursor)}
            with self.assertRaises(api.SessionBundleError): self.select(env)
        env = {**self.environment, 'KILLBOARD_SESSION_FILES': str(self.cursor)}
        with self.assertRaises(api.SessionBundleError): self.select(env)
        with patch.object(km, 'DEFAULT_CURSOR_FILE', str(self.cursor)), self.assertRaises(api.SessionBundleError):
            self.select()
        hardlink = self.parent / 'source-cursor.json'
        os.link(self.paths[0], hardlink)
        with self.assertRaises(api.SessionBundleError):
            self.select({**self.environment, 'ANOMALY_SESSION_CURSOR_FILE': str(hardlink)})
        self.assertEqual(self.paths[0].read_bytes(), original)

    def test_invalid_account_map_never_advances_cursor(self):
        base = {**self.environment, 'GAME_SESSION_COORDINATOR_FILE': str(self.parent / 'coord.sqlite3')}
        for mapping in ('[]', 'null', '["same","same","c","d","e","f","g"]',
                        '["a","b","c","d","e","f",true]'):
            with self.assertRaises(api.SessionBundleError):
                self.select({**base, 'ANOMALY_SESSION_ACCOUNT_IDS': mapping})
        self.assertFalse(self.cursor.exists())

    @unittest.skipUnless(os.name == 'posix', 'POSIX owner-only cursor security')
    def test_cursor_and_parent_wrong_modes_or_owner_are_not_corruption(self):
        self.cursor.write_text('3')
        self.cursor.chmod(0o644)
        with self.assertRaises(api.SessionBundleError): self.select()
        self.cursor.chmod(0o600)
        self.parent.chmod(0o777)
        with self.assertRaises(api.SessionBundleError): self.select()
        self.parent.chmod(0o700)
        with patch.object(api.os, 'geteuid', return_value=os.geteuid() + 1), self.assertRaises(api.SessionBundleError):
            self.select()
        self.assertEqual(self.cursor.read_text(), '3')

    @unittest.skipUnless(os.name == 'posix', 'POSIX atomic cursor permissions')
    def test_atomic_cursor_is_owner_private_without_changing_parent_or_sources(self):
        before = [path.stat().st_mode & 0o7777 for path in self.paths]
        self.parent.chmod(0o750)
        self.select()
        first = self.cursor.stat()
        self.select()
        second = self.cursor.stat()
        self.assertEqual(second.st_mode & 0o7777, 0o600)
        self.assertEqual(second.st_uid, os.geteuid())
        self.assertEqual(second.st_nlink, 1)
        self.assertNotEqual(first.st_ino, second.st_ino)
        self.assertEqual(self.parent.stat().st_mode & 0o7777, 0o750)
        self.assertEqual([path.stat().st_mode & 0o7777 for path in self.paths], before)

    @unittest.skipUnless(os.name == 'posix', 'POSIX symbolic link contract')
    def test_symlink_source_cursor_and_directory_rejected_without_overwrite(self):
        link = self.parent / 'link.json'
        link.symlink_to(self.paths[0])
        with self.assertRaises(api.SessionBundleError):
            self.select({**self.environment, 'ANOMALY_SESSION_FILES': str(link)})
        link.unlink()
        link.symlink_to(self.cursor)
        with self.assertRaises(api.SessionBundleError):
            self.select({**self.environment, 'ANOMALY_SESSION_CURSOR_FILE': str(link)})
        directory = self.parent / 'linked-dir'
        directory.symlink_to(self.parent, target_is_directory=True)
        with self.assertRaises(api.SessionBundleError):
            self.select({**self.environment, 'ANOMALY_SESSION_CURSOR_FILE': str(directory / 'cursor.json')})
