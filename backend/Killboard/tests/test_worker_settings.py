import os
import runpy
from pathlib import Path
from unittest.mock import patch
from django.test import SimpleTestCase


class WorkerSettingsTests(SimpleTestCase):
    environment = {f'KILLBOARD_DB_{key}': value for key, value in {
        'NAME': 'kb_test', 'USER': 'kb_test', 'PASSWORD': 'synthetic-only',
        'HOST': 'db.test.invalid', 'PORT': '3306'}.items()}

    def test_only_dedicated_config_is_read_and_no_file_logging(self):
        with patch.dict(os.environ, self.environment, clear=True), patch.object(Path, 'open', side_effect=AssertionError('no env reads')):
            configured = runpy.run_module('EVE_MDjango.killboard_worker_settings')
        self.assertEqual(configured['DATABASES']['default']['NAME'], 'kb_test')
        self.assertEqual(configured['INSTALLED_APPS'], ['django.contrib.contenttypes', 'Killboard'])
        self.assertFalse(configured.get('ROOT_URLCONF'))
        self.assertFalse(configured.get('DATABASE_ROUTERS'))
        self.assertFalse(configured['USE_TZ'])
        self.assertNotIn('FileHandler', str(configured.get('LOGGING', {})))

    def test_missing_or_invalid_environment_fails_closed(self):
        for key in self.environment:
            with patch.dict(os.environ, {k:v for k,v in self.environment.items() if k != key}, clear=True):
                with self.assertRaises(RuntimeError):
                    runpy.run_module('EVE_MDjango.killboard_worker_settings')
