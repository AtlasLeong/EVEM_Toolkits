"""Offline safety tests for the MySQL-only Market CI settings module."""

import importlib.util
import os
import runpy
from pathlib import Path
from unittest.mock import MagicMock, call, patch

from django.test import SimpleTestCase


class MarketMysqlCISettingsTests(SimpleTestCase):
    def test_settings_exist(self):
        self.assertIsNotNone(importlib.util.find_spec('EVE_MDjango.market_mysql_ci_settings'))

    def test_only_fixed_loopback_ci_schema_and_real_auth_model_are_loaded(self):
        original_open = Path.open

        def deny_website_env(path, *args, **kwargs):
            if path.name == '.env':
                raise AssertionError('MySQL CI settings must not open the website .env file.')
            return original_open(path, *args, **kwargs)

        environment = {
            'MARKET_CI_MYSQL': '1',
            'MARKET_CI_DB_PASSWORD': 'temporary-test-password',
            'DB_NAME': 'website_database_must_not_be_used',
            'DB_HOST': 'website_database_host_must_not_be_used',
        }
        with patch.dict(os.environ, environment, clear=True), patch.object(Path, 'open', deny_website_env):
            configured = runpy.run_module('EVE_MDjango.market_mysql_ci_settings')

        self.assertEqual(set(configured['DATABASES']), {'default'})
        database = configured['DATABASES']['default']
        self.assertEqual(database['ENGINE'], 'django.db.backends.mysql')
        self.assertEqual(database['NAME'], 'market_ci')
        self.assertEqual(database['USER'], 'market_ci')
        self.assertEqual(database['PASSWORD'], 'temporary-test-password')
        self.assertEqual(database['HOST'], '127.0.0.1')
        self.assertEqual(str(database['PORT']), '3306')
        self.assertEqual(configured['AUTH_USER_MODEL'], 'Authentication.EVEMUser')
        self.assertEqual(set(configured['INSTALLED_APPS']), {
            'django.contrib.auth', 'django.contrib.contenttypes', 'Authentication', 'Market',
        })
        self.assertIs(configured['USE_TZ'], False)
        self.assertFalse(configured['ROOT_URLCONF'])
        self.assertEqual(configured['MIDDLEWARE'], [])

    def test_requires_explicit_ci_marker_and_temporary_password(self):
        with patch.dict(os.environ, {'MARKET_CI_DB_PASSWORD': 'temporary-test-password'}, clear=True):
            with self.assertRaises(RuntimeError):
                runpy.run_module('EVE_MDjango.market_mysql_ci_settings')
        with patch.dict(os.environ, {'MARKET_CI_MYSQL': '1'}, clear=True):
            with self.assertRaises(RuntimeError):
                runpy.run_module('EVE_MDjango.market_mysql_ci_settings')

    def test_snapshot_cleanup_checks_actual_ci_schema_before_raw_delete(self):
        from EVE_MDjango.market_mysql_ci_cleanup import clear_price_snapshots

        database = MagicMock()
        database.vendor = 'mysql'
        database.settings_dict = {'NAME': 'market_ci'}
        database.ops.quote_name.side_effect = lambda name: f'`{name}`'
        cursor = database.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ('market_ci',)

        clear_price_snapshots(database)

        self.assertEqual(cursor.execute.call_args_list, [
            call('SELECT DATABASE()'),
            call('DELETE FROM `Market_pricesnapshot`'),
        ])

    def test_snapshot_cleanup_refuses_a_non_ci_database_without_deleting(self):
        from EVE_MDjango.market_mysql_ci_cleanup import clear_price_snapshots

        database = MagicMock()
        database.vendor = 'mysql'
        database.settings_dict = {'NAME': 'market_ci'}
        database.cursor.return_value.__enter__.return_value.fetchone.return_value = ('production',)

        with self.assertRaises(RuntimeError):
            clear_price_snapshots(database)
        self.assertEqual(database.cursor.return_value.__enter__.return_value.execute.call_args_list,
                         [call('SELECT DATABASE()')])

        database.cursor.reset_mock()
        database.settings_dict = {'NAME': 'production'}
        with self.assertRaises(RuntimeError):
            clear_price_snapshots(database)
        database.cursor.assert_not_called()
