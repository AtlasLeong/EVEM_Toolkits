import importlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.db import connections
from django.db.migrations.recorder import MigrationRecorder
from django.db.migrations.exceptions import InconsistentMigrationHistory


class DeploymentVersionTests(SimpleTestCase):
    def module(self):
        self.assertTrue(Path(__file__).with_name('deployment.py').exists(), 'version probe not implemented')
        return importlib.import_module('EVE_MDjango.deployment')

    def test_unconfigured_development_has_explicit_marker(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            self.assertEqual(module.read_version(Path(directory) / 'missing'), 'development')

    def test_version_endpoint_is_uncached_and_uses_loaded_version(self):
        module = self.module()
        response = module.deployment_version(RequestFactory().get('/api/deploy-version/'))
        self.assertEqual(json.loads(response.content), {'sha': module.VERSION})
        self.assertIn('no-store', response['Cache-Control'])

    def test_invalid_version_is_not_exposed(self):
        module = self.module()
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'version'
            path.write_text('secret accidentally stored here')
            self.assertEqual(module.read_version(path), 'invalid')
            path.write_text('a' * 40)
            self.assertEqual(module.read_version(path), 'a' * 40)

    def test_asgi_entry_can_opt_into_websocket_router(self):
        source = Path(__file__).with_name('asgi.py').read_text(encoding='utf-8')
        self.assertIn('TACTICAL_ASGI_ENABLED', source)
        self.assertIn('tactical_asgi', source)


class RoutedMigrationGateTests(TestCase):
    databases = {'default', 'license'}

    def checker(self):
        path = Path(__file__).resolve().parents[2] / 'scripts/deploy/migration_check.py'
        self.assertTrue(path.exists(), 'router-aware read-only gate is not implemented')
        spec = importlib.util.spec_from_file_location('migration_check', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module.pending_migrations

    def test_license_migration_on_default_is_not_required(self):
        MigrationRecorder(connections['default']).record_unapplied('License', '0001_initial')
        self.assertEqual(self.checker()('default'), [])

    def test_nonlicense_migrations_on_license_are_not_required(self):
        recorder = MigrationRecorder(connections['license'])
        recorder.migration_qs.exclude(app='License').delete()
        self.assertEqual(self.checker()('license'), [])

    def test_real_missing_license_migration_is_blocked(self):
        MigrationRecorder(connections['license']).record_unapplied('License', '0001_initial')
        self.assertIn('License.0001_initial', self.checker()('license'))

    def test_real_missing_default_migration_is_blocked(self):
        MigrationRecorder(connections['default']).record_unapplied('auth', '0012_alter_user_first_name_max_length')
        self.assertIn('auth.0012_alter_user_first_name_max_length', self.checker()('default'))

    def test_inconsistent_applied_history_is_not_mistaken_for_empty_plan(self):
        MigrationRecorder(connections['default']).record_unapplied('auth', '0001_initial')
        with self.assertRaises(InconsistentMigrationHistory):
            self.checker()('default')

class ProductionBoundarySettingsTests(SimpleTestCase):
    def production_settings(self):
        # These checks inspect production defaults, but must remain runnable
        # under isolated CI settings without reading a developer or production
        # .env file. The values are inert placeholders and no DB connection is
        # opened by these assertions.
        values = {
            'SECRET_KEY': 'isolated-boundary-check',
            'DB_NAME': 'boundary-check', 'DB_USER': 'boundary-check',
            'DB_PASSWORD': 'boundary-check', 'DB_HOST': '127.0.0.1', 'DB_PORT': '3306',
            'EMAIL_HOST_USER': 'boundary-check', 'EMAIL_HOST_PASSWORD': 'boundary-check',
        }
        with patch.dict(os.environ, values, clear=False):
            import sys
            sys.modules.pop('EVE_MDjango.settings', None)
            return importlib.import_module('EVE_MDjango.settings')

    def test_settings_expose_bounded_upload_limits(self):
        settings = self.production_settings()
        self.assertGreater(settings.DATA_UPLOAD_MAX_MEMORY_SIZE, 0)
        self.assertGreater(settings.FILE_UPLOAD_MAX_MEMORY_SIZE, 0)

    def test_settings_do_not_allow_all_hosts_in_release(self):
        settings = self.production_settings()
        if not settings.DEBUG:
            self.assertNotEqual(settings.ALLOWED_HOSTS, ['*'])
            self.assertFalse(settings.CORS_ALLOW_ALL_ORIGINS)
