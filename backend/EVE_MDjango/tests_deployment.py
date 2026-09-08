import importlib
import json
from pathlib import Path
import tempfile

from django.test import RequestFactory, SimpleTestCase


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
