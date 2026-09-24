import importlib.util
import os
import runpy
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase


MARKET_ENV = {
    'MARKET_DB_NAME': 'market_worker_test',
    'MARKET_DB_USER': 'market_worker_test_user',
    'MARKET_DB_PASSWORD': 'nonsecret-test-value',
    'MARKET_DB_HOST': 'db.test.invalid',
    'MARKET_DB_PORT': '3307',
}


class MarketWorkerSettingsTests(SimpleTestCase):
    def test_isolated_settings_module_exists(self):
        self.assertIsNotNone(importlib.util.find_spec('EVE_MDjango.market_worker_settings'))

    def test_only_market_database_environment_is_used_without_env_file(self):
        real_open = Path.open

        def deny_env_file(path, *args, **kwargs):
            if path.name == '.env':
                raise AssertionError('Worker settings must not open the website .env file.')
            return real_open(path, *args, **kwargs)

        environment = {**MARKET_ENV, 'DB_NAME': 'website_db_should_not_be_used'}
        with patch.dict(os.environ, environment, clear=True), patch.object(Path, 'open', deny_env_file):
            configured = runpy.run_module('EVE_MDjango.market_worker_settings')

        self.assertIn('DATABASES', configured)
        self.assertEqual(set(configured['DATABASES']), {'default'})
        database = configured['DATABASES']['default']
        self.assertEqual(database['ENGINE'], 'django.db.backends.mysql')
        self.assertEqual(database['NAME'], MARKET_ENV['MARKET_DB_NAME'])
        self.assertEqual(database['USER'], MARKET_ENV['MARKET_DB_USER'])
        self.assertEqual(database['PASSWORD'], MARKET_ENV['MARKET_DB_PASSWORD'])
        self.assertEqual(database['HOST'], MARKET_ENV['MARKET_DB_HOST'])
        self.assertEqual(str(database['PORT']), MARKET_ENV['MARKET_DB_PORT'])
        self.assertEqual(configured.get('AUTH_USER_MODEL'), 'Authentication.EVEMUser')
        self.assertEqual(configured.get('TIME_ZONE'), 'Asia/Shanghai')
        self.assertIs(configured.get('USE_TZ'), False)
        self.assertEqual(set(configured.get('INSTALLED_APPS', [])), {
            'django.contrib.auth', 'django.contrib.contenttypes', 'Authentication', 'Market',
        })
        self.assertFalse(configured.get('ROOT_URLCONF'))
        self.assertFalse(configured.get('CHANNEL_LAYERS'))
        self.assertEqual(configured.get('MIDDLEWARE'), [])
        self.assertNotIn('REST_FRAMEWORK', configured)
        self.assertEqual(configured.get('CACHES', {}).get('default', {}).get('BACKEND'),
                         'django.core.cache.backends.dummy.DummyCache')

    def test_missing_market_database_credentials_fail_closed(self):
        for missing in MARKET_ENV:
            with self.subTest(missing=missing):
                environment = {key: value for key, value in MARKET_ENV.items() if key != missing}
                with patch.dict(os.environ, environment, clear=True):
                    with self.assertRaisesRegex(RuntimeError, missing):
                        runpy.run_module('EVE_MDjango.market_worker_settings')

    def test_invalid_market_database_port_fails_before_django_setup(self):
        with patch.dict(os.environ, {**MARKET_ENV, 'MARKET_DB_PORT': 'not-a-port'}, clear=True):
            with self.assertRaisesRegex(RuntimeError, 'MARKET_DB_PORT'):
                runpy.run_module('EVE_MDjango.market_worker_settings')

    def test_market_foreign_keys_target_production_user_model(self):
        project_dir = Path(__file__).resolve().parent.parent
        environment = {**MARKET_ENV, 'DJANGO_SETTINGS_MODULE': 'EVE_MDjango.market_worker_settings'}
        if 'SystemRoot' in os.environ:
            environment['SystemRoot'] = os.environ['SystemRoot']
        script = (
            'import importlib, django; '
            'worker=importlib.import_module("EVE_MDjango.market_worker_settings"); '
            'worker.DATABASES["default"]={"ENGINE":"django.db.backends.sqlite3","NAME":":memory:"}; '
            'django.setup(); '
            'from Market.models import CollectionRun, MarketConfigAudit; '
            'expected="Authentication.EVEMUser"; '
            'assert CollectionRun._meta.get_field("requested_by").remote_field.model._meta.label == expected; '
            'assert MarketConfigAudit._meta.get_field("actor").remote_field.model._meta.label == expected'
        )
        result = subprocess.run(
            [sys.executable, '-c', script], cwd=project_dir, env=environment,
            capture_output=True, text=True, check=False,
        )

        self.assertEqual(result.returncode, 0, result.stderr)
