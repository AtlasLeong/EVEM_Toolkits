import importlib
import importlib.util
import json
from pathlib import Path
import tempfile

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.db import connections
from django.db.migrations.recorder import MigrationRecorder


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
