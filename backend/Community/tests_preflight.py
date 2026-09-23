"""Read-only candidate and live-service readiness checks; no production settings."""
import importlib
import importlib.util
from io import StringIO
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.db import OperationalError
from django.test import SimpleTestCase, TestCase, override_settings


class StoragePreflightTests(SimpleTestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='community-preflight-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.private = self.root / 'private-community'
        self.private.mkdir()
        self.assertIsNotNone(importlib.util.find_spec('Community.preflight'), 'read-only preflight is missing')
        self.preflight = importlib.import_module('Community.preflight')

    def check(self, root, **settings):
        with override_settings(COMMUNITY_UPLOAD_ROOT=root, **settings):
            return self.preflight.check_storage_configuration()

    def test_requires_absolute_existing_directory(self):
        file = self.root / 'file'
        file.write_bytes(b'not a directory')
        for root in (None, '', 'relative/path', self.root / 'missing', file, Path(self.root.anchor)):
            with self.subTest(root=root), self.assertRaises(self.preflight.PreflightError):
                self.check(root)
        self.assertFalse((self.root / 'missing').exists())

    def test_rejects_public_release_and_candidate_trees(self):
        for name in ('static', 'uploads', 'public', 'dist', 'shared/assets', 'releases/abc', '.staging-abc'):
            unsafe = self.root / name / 'private-community'
            unsafe.mkdir(parents=True)
            with self.subTest(name=name), self.assertRaises(self.preflight.PreflightError):
                self.check(unsafe)
        for setting in ('STATIC_ROOT', 'MEDIA_ROOT', 'BASE_DIR'):
            with self.subTest(setting=setting), self.assertRaises(self.preflight.PreflightError):
                self.check(self.private, **{setting: self.root})
        with self.assertRaises(self.preflight.PreflightError):
            self.check(self.private, STATICFILES_DIRS=[('custom', self.root)])

    def test_valid_private_directory_does_not_create_or_modify_files(self):
        original = self.private / 'existing-original.webp'
        original.write_bytes(b'original user bytes')
        before = original.stat()
        with patch('pathlib.Path.mkdir', side_effect=AssertionError('no mkdir')), patch('pathlib.Path.chmod', side_effect=AssertionError('no chmod')):
            self.assertEqual(self.check(self.private), self.private.resolve())
            with override_settings(COMMUNITY_UPLOAD_ROOT=self.private):
                output = StringIO()
                call_command('community_preflight', stdout=output)
        self.assertIn('passed', output.getvalue())
        self.assertNotIn(str(self.private), output.getvalue())
        self.assertEqual(original.read_bytes(), b'original user bytes')
        self.assertEqual(original.stat().st_mtime_ns, before.st_mtime_ns)
        self.assertEqual(list(self.private.iterdir()), [original])

    def test_operator_supplied_public_or_release_root_is_rejected(self):
        with override_settings(COMMUNITY_UPLOAD_ROOT=self.private):
            with self.assertRaises(CommandError):
                call_command('community_preflight', '--forbidden-root', str(self.root), stdout=StringIO())

    def test_lexical_release_path_cannot_escape_by_parent_segments(self):
        (self.root / 'current').mkdir()
        unsafe = self.root / 'current/../private-community'
        with self.assertRaises(self.preflight.PreflightError):
            self.check(unsafe)

    def test_switchable_symlink_path_is_rejected_but_private_alias_allowed(self):
        alias = self.root / 'private-alias'
        try:
            alias.symlink_to(self.private, target_is_directory=True)
        except OSError:
            self.skipTest('symlink creation unavailable on this platform')
        self.assertEqual(self.check(alias), self.private.resolve())
        current = self.root / 'current'
        current.symlink_to(self.private, target_is_directory=True)
        with self.assertRaises(self.preflight.PreflightError):
            self.check(current)
        with override_settings(COMMUNITY_UPLOAD_ROOT=alias):
            with self.assertRaises(CommandError):
                call_command('community_preflight', '--forbidden-root', str(alias), stdout=StringIO())

    def test_command_failure_is_generic(self):
        with override_settings(COMMUNITY_UPLOAD_ROOT=self.root / 'private-secret-missing'):
            with self.assertRaises(CommandError) as failure:
                call_command('community_preflight', stdout=StringIO())
        self.assertNotIn(str(self.root), str(failure.exception))
        self.assertNotIn('private-secret', str(failure.exception))


class ReadinessTests(TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='community-ready-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.override = override_settings(COMMUNITY_UPLOAD_ROOT=self.root)
        self.override.enable()
        self.addCleanup(self.override.disable)

    def ready(self, status):
        response = self.client.get('/api/community/ready/')
        self.assertEqual(response.status_code, status)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertEqual(response.json(), {'status': 'ok' if status == 200 else 'unavailable'})
        self.assertNotIn(str(self.root), response.content.decode())
        return response

    def test_queries_real_community_tables_and_never_writes(self):
        original = self.root / 'existing.webp'
        original.write_bytes(b'untouched')
        with self.assertNumQueries(2):
            self.ready(200)
        self.assertEqual(original.read_bytes(), b'untouched')
        self.assertEqual(list(self.root.iterdir()), [original])

    def test_unconfigured_or_missing_storage_is_unavailable(self):
        for root in (None, self.root / 'missing'):
            with self.subTest(root=root), override_settings(COMMUNITY_UPLOAD_ROOT=root):
                self.ready(503)
        self.assertFalse((self.root / 'missing').exists())

    def test_actual_service_identity_permissions_and_parent_traversal_required(self):
        self.assertIsNotNone(importlib.util.find_spec('Community.preflight'))
        from Community import preflight
        for denied in (self.root, self.root.parent):
            calls = []
            def access(path, mode, **kwargs):
                calls.append((Path(path), mode, kwargs))
                return Path(path) != denied
            with self.subTest(denied=denied), patch.object(preflight.os, 'access', side_effect=access):
                self.ready(503)
            self.assertTrue(calls)
        calls = []
        with patch.object(preflight.os, 'access', side_effect=lambda path, mode, **kwargs: calls.append((Path(path), mode, kwargs)) or True) as access:
            with patch.object(preflight.os, 'supports_effective_ids', {access}):
                self.ready(200)
        self.assertIn((self.root, os.R_OK | os.W_OK | os.X_OK), [(path, mode) for path, mode, _ in calls])
        self.assertTrue(all(kwargs.get('effective_ids') is True for _, _, kwargs in calls))

    def test_database_failure_is_generic(self):
        with patch('Community.models.Corporation.objects.exists', side_effect=OperationalError('secret-host secret-password')):
            response = self.ready(503)
        self.assertNotIn('secret', response.content.decode())

    def test_read_only_http_methods(self):
        response = self.client.post('/api/community/ready/')
        self.assertEqual(response.status_code, 405)
        self.assertIn('no-store', response['Cache-Control'])
