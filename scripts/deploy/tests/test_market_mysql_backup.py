"""Synthetic checks for Market's root-private MySQL backup command."""

from pathlib import Path
import hashlib
import importlib.util
import io
import json
import os
import stat
import subprocess
import tempfile
from types import ModuleType
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import sys


SCRIPT = Path(__file__).resolve().parents[1] / 'market_mysql_backup.py'
spec = importlib.util.spec_from_file_location('market_mysql_backup_under_test', SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class MarketMysqlBackupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.destination = self.root / 'market-backup'
        self.database = {
            'NAME': 'eve_echoes', 'USER': 'synthetic-user',
            'PASSWORD': 'synthetic-password-#=\\x', 'HOST': '127.0.0.1', 'PORT': '3306',
        }

    def test_standalone_backup_helper_exists(self):
        self.assertTrue(SCRIPT.is_file())

    def test_full_dump_uses_private_option_file_and_writes_verified_manifest(self):
        self.assertTrue(hasattr(backup, 'backup_default_database'))
        dump_bytes = b'-- synthetic fixture\nCREATE TABLE `one` (`id` int);\n-- Dump completed on 2026-09-24\n'
        seen = {}

        def fake_run(args, *, stdout, stderr, check, env=None):
            seen['args'] = args
            self.assertEqual(stderr, subprocess.PIPE)
            self.assertFalse(check)
            self.assertTrue(args[0] == 'mysqldump', 'wrong dump executable')
            self.assertTrue(args[1].startswith('--defaults-file='))
            self.assertIsNotNone(env)
            self.assertTrue('--single-transaction' in args, 'missing consistent snapshot option')
            for flag in ('--quick', '--routines', '--triggers', '--events',
                         '--no-tablespaces', '--set-gtid-purged=OFF'):
                self.assertTrue(flag in args, f'missing dump option {flag}')
            self.assertTrue(args[-1] == 'eve_echoes', 'wrong dump schema')
            self.assertFalse(self.database['PASSWORD'] in ' '.join(args),
                             'password leaked into arguments')
            for forbidden_key in ('MYSQL_PWD', 'MYSQL_HOME', 'DB_PASSWORD', 'SECRET_KEY'):
                self.assertFalse(forbidden_key in env, forbidden_key)
            self.assertEqual(env['MYSQL_TEST_LOGIN_FILE'], str(self.destination / 'no-login-file.cnf'))
            self.assertFalse(Path(env['MYSQL_TEST_LOGIN_FILE']).exists())
            option_file = Path(args[1].split('=', 1)[1])
            seen['option_file'] = option_file
            options = option_file.read_text(encoding='utf-8')
            self.assertTrue('user="synthetic-user"' in options, 'user option missing')
            self.assertTrue('password="synthetic-password-#=\\\\x"' in options,
                            'password option missing')
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE(option_file.stat().st_mode), 0o600)
            stdout.write(dump_bytes)
            return SimpleNamespace(returncode=0, stderr=b'')

        with patch.dict(os.environ, {'MYSQL_PWD': 'inherited-synthetic-secret',
                                     'MYSQL_HOME': 'inherited-synthetic-path',
                                     'MYSQL_TEST_LOGIN_FILE': 'inherited-synthetic-login',
                                     'DB_PASSWORD': 'inherited-synthetic-secret',
                                     'SECRET_KEY': 'inherited-synthetic-secret'}, clear=False):
            record = backup.backup_default_database(
                self.destination, self.database, backup_root=self.root, runner=fake_run,
            )

        self.assertFalse(seen['option_file'].exists())
        self.assertTrue(self.destination.is_dir())
        self.assertEqual(hashlib.sha256((self.destination / 'default-before-market.sql').read_bytes()).hexdigest(),
                         hashlib.sha256(dump_bytes).hexdigest())
        self.assertEqual(record['sha256'], hashlib.sha256(dump_bytes).hexdigest())
        self.assertEqual(record['size'], len(dump_bytes))
        self.assertEqual(record['database'], 'eve_echoes')
        saved = json.loads((self.destination / 'backup.json').read_text())
        for key in ('file', 'size', 'sha256', 'database', 'created_at'):
            self.assertTrue(saved[key] == record[key], f'manifest mismatch in {key}')
        self.assertFalse(self.database['PASSWORD'] in json.dumps(saved),
                         'password leaked into saved manifest')
        self.assertFalse(self.database['PASSWORD'] in json.dumps(record),
                         'password leaked into manifest')
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((self.destination / 'default-before-market.sql').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE((self.destination / 'backup.json').stat().st_mode), 0o600)

    def test_rejects_line_breaks_in_option_values(self):
        self.database['PASSWORD'] = 'synthetic-secret\rhost=other-server'
        with self.assertRaises(backup.BackupError) as failure:
            backup.backup_default_database(
                self.destination, self.database, backup_root=self.root,
                runner=lambda *args, **kwargs: self.fail('mysqldump must not run'),
            )
        self.assertFalse('synthetic-secret' in str(failure.exception),
                         'password leaked into error')

    def test_failed_dump_sanitizes_stderr_and_removes_partial_dump_and_credentials(self):
        seen = {}

        def fake_run(args, *, stdout, stderr, check, env=None):
            seen['option_file'] = Path(args[1].split('=', 1)[1])
            stdout.write(b'partial SQL containing private data')
            return SimpleNamespace(returncode=2, stderr=self.database['PASSWORD'].encode())

        with self.assertRaises(backup.BackupError) as failure:
            backup.backup_default_database(
                self.destination, self.database, backup_root=self.root, runner=fake_run,
            )
        self.assertFalse(self.database['PASSWORD'] in str(failure.exception),
                         'password leaked into error')
        self.assertFalse(seen['option_file'].exists())
        self.assertFalse((self.destination / 'default-before-market.sql').exists())
        self.assertFalse((self.destination / 'backup.json').exists())

    def test_success_exit_without_footer_is_not_accepted(self):
        def fake_run(args, *, stdout, stderr, check, env=None):
            stdout.write(b'-- synthetic SQL without completion footer\n')
            return SimpleNamespace(returncode=0, stderr=b'')

        with self.assertRaises(backup.BackupError):
            backup.backup_default_database(
                self.destination, self.database, backup_root=self.root, runner=fake_run,
            )
        self.assertFalse((self.destination / 'default-before-market.sql').exists())
        self.assertFalse((self.destination / 'backup.json').exists())

    def test_existing_destination_is_never_overwritten(self):
        self.destination.mkdir()
        sentinel = self.destination / 'sentinel'
        sentinel.write_text('unchanged', encoding='utf-8')
        with self.assertRaises(backup.BackupError):
            backup.backup_default_database(
                self.destination, self.database, backup_root=self.root,
                runner=lambda *args, **kwargs: self.fail('mysqldump must not run'),
            )
        self.assertEqual(sentinel.read_text(encoding='utf-8'), 'unchanged')

    def test_destination_must_be_immediate_child_of_backup_root(self):
        outside = self.root.parent / (self.root.name + '-outside')
        with self.assertRaises(backup.BackupError):
            backup.backup_default_database(
                outside, self.database, backup_root=self.root,
                runner=lambda *args, **kwargs: self.fail('mysqldump must not run'),
            )
        self.assertFalse(outside.exists())

    @unittest.skipIf(os.name == 'nt', 'POSIX directory modes are required')
    def test_writable_backup_parent_is_rejected_before_credentials_are_written(self):
        self.root.chmod(0o777)
        with self.assertRaises(backup.BackupError):
            backup.backup_default_database(
                self.destination, self.database, backup_root=self.root,
                runner=lambda *args, **kwargs: self.fail('mysqldump must not run'),
            )
        self.assertFalse(self.destination.exists())

    def test_private_parent_rule_rejects_group_or_world_writable_mode(self):
        self.assertTrue(hasattr(backup, 'private_backup_parent'))
        self.assertTrue(backup.private_backup_parent(0o40755, 1000, 1000))
        self.assertFalse(backup.private_backup_parent(0o40775, 1000, 1000))
        self.assertFalse(backup.private_backup_parent(0o40757, 1000, 1000))
        self.assertFalse(backup.private_backup_parent(0o40755, 2000, 1000))

    def test_cli_requires_explicit_backend_and_matching_live_database(self):
        backend = self.root / 'candidate' / 'backend'
        (backend / 'EVE_MDjango').mkdir(parents=True)
        (backend / 'manage.py').touch()
        (backend / 'EVE_MDjango' / 'settings.py').touch()
        self.assertTrue(hasattr(backup, 'main'))
        command = [
            '--backend', str(backend), '--expected-database', 'eve_echoes',
            '--backup-dir', str(self.destination),
        ]
        error_output = io.StringIO()
        with patch.object(backup.os, 'geteuid', return_value=0, create=True), \
                patch.object(backup, 'load_default_database_settings',
                             return_value=(self.database, 'different_database')) as loader, \
                patch.object(backup, 'backup_default_database') as dump, \
                patch('sys.stderr', error_output):
            with self.assertRaises(SystemExit) as failure:
                backup.main(command)
        self.assertNotEqual(failure.exception.code, 0)
        self.assertFalse(self.database['PASSWORD'] in error_output.getvalue(),
                         'password leaked into CLI error')
        self.assertFalse(self.destination.exists())
        loader.assert_called_once_with(backend)
        dump.assert_not_called()

    def test_cli_uses_explicit_backend_and_prints_only_safe_metadata(self):
        backend = self.root / 'candidate' / 'backend'
        (backend / 'EVE_MDjango').mkdir(parents=True)
        (backend / 'manage.py').touch()
        (backend / 'EVE_MDjango' / 'settings.py').touch()
        command = [
            '--backend', str(backend), '--expected-database', 'eve_echoes',
            '--backup-dir', str(self.destination),
        ]
        safe_record = {'file': str(self.destination / 'default-before-market.sql'),
                       'size': 123, 'sha256': 'a' * 64, 'database': 'eve_echoes'}
        output = io.StringIO()
        with patch.object(backup.os, 'geteuid', return_value=0, create=True), \
                patch.object(backup, 'load_default_database_settings',
                             return_value=(self.database, 'eve_echoes')) as loader, \
                patch.object(backup, 'backup_default_database', return_value=safe_record) as dump, \
                patch('sys.stdout', output):
            self.assertEqual(backup.main(command), 0)
        loader.assert_called_once_with(backend)
        dump.assert_called_once()
        self.assertEqual(dump.call_args.args[0], self.destination)
        self.assertTrue(dump.call_args.args[1] is self.database,
                        'unexpected database settings source')
        self.assertFalse(self.database['PASSWORD'] in output.getvalue(),
                         'password leaked into output')
        printed = json.loads(output.getvalue())
        for key, value in safe_record.items():
            self.assertTrue(printed[key] == value, f'output mismatch in {key}')

    def test_loader_uses_only_explicit_backend_and_reads_database_identity(self):
        backend = self.root / 'candidate' / 'backend'
        (backend / 'EVE_MDjango').mkdir(parents=True)
        (backend / 'logs').mkdir()
        (backend / 'manage.py').touch()
        (backend / '.env').touch()
        (backend / 'EVE_MDjango' / 'settings.py').touch()
        queries = []

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_):
                return None

            def execute(self, query):
                queries.append(query)

            def fetchone(self):
                return ('eve_echoes',)

        django = ModuleType('django')
        django.__path__ = []
        django.setup = lambda: None
        django_db = ModuleType('django.db')
        django_db.connections = {'default': SimpleNamespace(
            vendor='mysql', settings_dict=self.database, cursor=Cursor,
        )}
        with patch.dict(sys.modules, {'django': django, 'django.db': django_db}), \
                patch.dict(os.environ, {'DJANGO_SETTINGS_MODULE': 'EVE_MDjango.settings'}), \
                patch.object(sys, 'path', sys.path.copy()):
            settings, active = backup.load_default_database_settings(backend)
            self.assertEqual(sys.path[0], str(backend))
        self.assertEqual(settings['NAME'], 'eve_echoes')
        self.assertEqual(active, 'eve_echoes')
        self.assertEqual(queries, ['SELECT DATABASE()'])


if __name__ == '__main__':
    unittest.main()
