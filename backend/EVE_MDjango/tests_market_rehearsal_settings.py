"""The restore rehearsal must never inherit the live website database."""

import importlib.util
import os
from pathlib import Path
import runpy
from unittest.mock import patch

from django.test import SimpleTestCase


SCHEMA = 'evem_market_qa_abcdef123456'
PASSWORD = 'rehearsal-only-synthetic-password-123'


class MarketRehearsalSettingsTests(SimpleTestCase):
    def test_rehearsal_settings_module_exists(self):
        self.assertIsNotNone(importlib.util.find_spec('EVE_MDjango.market_rehearsal_settings'))

    def environment(self, **overrides):
        values = {
            'EVEM_REHEARSAL_ENABLE': '1',
            'EVEM_REHEARSAL_DB_NAME': SCHEMA,
            'EVEM_REHEARSAL_DB_USER': SCHEMA,
            'EVEM_REHEARSAL_DB_PASSWORD': PASSWORD,
            'DB_NAME': 'eve_echoes',
            'DB_USER': 'root',
            'DB_HOST': 'production.example',
        }
        values.update(overrides)
        return values

    def test_isolated_settings_ignore_website_env_and_pin_qa_identity(self):
        original_open = Path.open

        def deny_website_env(path, *args, **kwargs):
            if path.name == '.env':
                raise AssertionError('Rehearsal settings must not open website .env')
            return original_open(path, *args, **kwargs)

        with patch.dict(os.environ, self.environment(), clear=True), patch.object(Path, 'open', deny_website_env):
            configured = runpy.run_module('EVE_MDjango.market_rehearsal_settings')

        database = configured['DATABASES']['default']
        self.assertEqual(database['ENGINE'], 'django.db.backends.mysql')
        self.assertEqual(database['NAME'], SCHEMA)
        self.assertEqual(database['USER'], SCHEMA)
        self.assertEqual(database['PASSWORD'], PASSWORD)
        self.assertEqual(database['HOST'], '127.0.0.1')
        self.assertEqual(str(database['PORT']), '3306')
        self.assertEqual(configured['AUTH_USER_MODEL'], 'Authentication.EVEMUser')
        self.assertEqual(set(configured['INSTALLED_APPS']), {
            'django.contrib.auth', 'django.contrib.contenttypes', 'Authentication', 'Market',
        })
        self.assertEqual(configured['MIDDLEWARE'], [])

    def test_rejects_missing_explicit_rehearsal_marker(self):
        with patch.dict(os.environ, self.environment(EVEM_REHEARSAL_ENABLE=''), clear=True):
            with self.assertRaises(RuntimeError):
                runpy.run_module('EVE_MDjango.market_rehearsal_settings')

    def test_rejects_production_or_mismatched_schema_user(self):
        for name, user in [
            ('eve_echoes', SCHEMA),
            (SCHEMA, 'root'),
            (SCHEMA, 'evem_market_qa_123456abcdef'),
            ('evem_market_qa_ABCDEF123456', 'evem_market_qa_ABCDEF123456'),
        ]:
            with self.subTest(name=name, user=user):
                with patch.dict(os.environ, self.environment(
                    EVEM_REHEARSAL_DB_NAME=name, EVEM_REHEARSAL_DB_USER=user,
                ), clear=True):
                    with self.assertRaises(RuntimeError):
                        runpy.run_module('EVE_MDjango.market_rehearsal_settings')

    def test_rejects_missing_or_short_password(self):
        for password in ('', 'short'):
            with self.subTest(password_length=len(password)):
                with patch.dict(os.environ, self.environment(EVEM_REHEARSAL_DB_PASSWORD=password), clear=True):
                    with self.assertRaises(RuntimeError):
                        runpy.run_module('EVE_MDjango.market_rehearsal_settings')
