"""Synthetic-only checks for QA account provisioning; no MySQL is contacted."""

import importlib
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
import json
import os
from pathlib import Path
import stat
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest import mock


SERVER_UUID = '01234567-89ab-4cde-8123-456789abcdef'


class IdentityConnection:
    def __init__(self, database='eve_echoes', server_uuid=SERVER_UUID, mandatory_roles=''):
        self.database = database
        self.server_uuid = server_uuid
        self.mandatory_roles = mandatory_roles
        self.commands = []

    def cursor(self):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, sql, params=None):
        self.commands.append((sql, params))

    def fetchone(self):
        return self.database, self.server_uuid, self.mandatory_roles


class ProvisionConnection(IdentityConnection):
    def __init__(self, *, schema_count=0, user_count=0, **kwargs):
        super().__init__(**kwargs)
        self.schema_count = schema_count
        self.user_count = user_count

    def fetchone(self):
        sql = self.commands[-1][0]
        if sql == 'SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles':
            return super().fetchone()
        if 'information_schema.SCHEMATA' in sql:
            return (self.schema_count,)
        if 'mysql.user' in sql:
            return (self.user_count,)
        raise AssertionError('Unexpected query')


class QaProvisionTests(unittest.TestCase):
    def setUp(self):
        try:
            self.provisioner = importlib.import_module('scripts.deploy.market_mysql_qa_provision')
        except ModuleNotFoundError:
            self.fail('QA provisioning helper is missing')

    def test_source_and_loopback_must_prove_same_database_and_server_uuid(self):
        self.assertTrue(hasattr(self.provisioner, 'verify_same_server'))
        source = IdentityConnection()
        loopback = IdentityConnection()
        self.assertEqual(self.provisioner.verify_same_server(source, loopback, 'eve_echoes'), SERVER_UUID)
        self.assertEqual(source.commands, [('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None)])
        self.assertEqual(loopback.commands, [('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None)])

    def test_mandatory_roles_rejected_before_account_or_credential_creation(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            for source, loopback in (
                (IdentityConnection(mandatory_roles='security_role@%'), ProvisionConnection()),
                (IdentityConnection(), ProvisionConnection(mandatory_roles='security_role@%')),
            ):
                with self.subTest(source_roles=source.mandatory_roles,
                                  loopback_roles=loopback.mandatory_roles):
                    with mock.patch.object(self.provisioner, 'write_private_env') as writer:
                        with self.assertRaises(self.provisioner.QaProvisionError):
                            self.provisioner.provision_qa_account(
                                backup, {'NAME': 'eve_echoes'}, source, loopback,
                                expected_database='eve_echoes', backup_root=root,
                                effective_uid=0, stat_reader=reader,
                            )
                    writer.assert_not_called()
                    self.assertFalse(any('CREATE USER' in sql or 'GRANT ' in sql
                                         for sql, _ in source.commands + loopback.commands))

    def test_identity_mismatch_or_empty_uuid_fails_closed(self):
        cases = (
            (IdentityConnection(database='other'), IdentityConnection()),
            (IdentityConnection(), IdentityConnection(database='other')),
            (IdentityConnection(server_uuid=''), IdentityConnection()),
            (IdentityConnection(), IdentityConnection(server_uuid='fedcba98-7654-4cba-8123-456789abcdef')),
        )
        for source, loopback in cases:
            with self.subTest(source=source.database, loopback=loopback.database):
                with self.assertRaises(self.provisioner.QaProvisionError):
                    self.provisioner.verify_same_server(source, loopback, 'eve_echoes')
                self.assertFalse(any('CREATE USER' in sql or 'GRANT ' in sql
                                     for sql, _params in source.commands + loopback.commands))

    def test_requires_exact_root_private_backup_directory_and_matching_manifest(self):
        self.assertTrue(hasattr(self.provisioner, 'validate_backup_directory'))
        with TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            backup = root / 'new-backup'
            backup.mkdir()
            dump = backup / 'default-before-market.sql'
            dump.write_bytes(b'-- synthetic backup\n')
            manifest = backup / 'backup.json'
            manifest.write_text(json.dumps({
                'file': str(dump), 'size': dump.stat().st_size,
                'sha256': 'a' * 64, 'database': 'eve_echoes',
            }), encoding='utf-8')
            metadata = {
                root: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0),
                backup: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0),
                dump: SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0, st_size=dump.stat().st_size),
                manifest: SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0),
            }
            reader = lambda path: metadata[path]
            result = self.provisioner.validate_backup_directory(
                backup, 'eve_echoes', backup_root=root, effective_uid=0, stat_reader=reader,
            )
            self.assertEqual(result, backup)
            metadata[backup] = SimpleNamespace(st_mode=stat.S_IFDIR | 0o750, st_uid=0)
            with self.assertRaises(self.provisioner.QaProvisionError):
                self.provisioner.validate_backup_directory(
                    backup, 'eve_echoes', backup_root=root, effective_uid=0, stat_reader=reader,
                )

    def _backup_fixture(self, temporary):
        root = Path(temporary).resolve()
        backup = root / 'new-backup'
        backup.mkdir()
        dump = backup / 'default-before-market.sql'
        dump.write_bytes(b'-- synthetic backup\n')
        manifest = backup / 'backup.json'
        manifest.write_text(json.dumps({
            'file': str(dump), 'size': dump.stat().st_size,
            'sha256': 'a' * 64, 'database': 'eve_echoes',
        }), encoding='utf-8')
        metadata = {
            root: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0),
            backup: SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0),
            dump: SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0,
                                  st_size=dump.stat().st_size),
            manifest: SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=0),
        }
        return root, backup, lambda path: metadata[path]

    def test_provision_proves_server_and_absence_before_exact_loopback_grant(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            source = IdentityConnection()
            loopback = ProvisionConnection()
            written = []
            schema = 'evem_market_qa_aaaaaaaaaaaa'
            with (mock.patch.object(self.provisioner.secrets, 'token_hex', return_value='a' * 12),
                  mock.patch.object(self.provisioner.secrets, 'token_urlsafe',
                                    return_value='P' * 43),
                  mock.patch.object(self.provisioner, 'write_private_env',
                                    side_effect=lambda *_args: written.append(len(loopback.commands)))):
                result = self.provisioner.provision_qa_account(
                    backup, {'NAME': 'eve_echoes'}, source, loopback,
                    expected_database='eve_echoes', backup_root=root,
                    effective_uid=0, stat_reader=reader,
                )
            self.assertEqual(result, schema)
            self.assertEqual(source.commands, [('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None)])
            self.assertEqual(loopback.commands[:3], [
                ('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None),
                ('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s',
                 (schema,)),
                ('SELECT COUNT(*) FROM mysql.user WHERE User = %s', (schema,)),
            ])
            self.assertEqual(written, [3])
            self.assertEqual(loopback.commands[3],
                             ("CREATE USER %s@'127.0.0.1' IDENTIFIED BY %s", (schema, 'P' * 43)))
            self.assertEqual(loopback.commands[4],
                             ("GRANT ALL PRIVILEGES ON `evem\\_market\\_qa\\_aaaaaaaaaaaa`.* "
                              "TO %s@'127.0.0.1'", (schema,)))
            self.assertFalse(any('CREATE DATABASE' in sql or 'DROP DATABASE' in sql
                                 or 'ON *.*' in sql for sql, _ in loopback.commands))

    def test_no_mutation_if_identity_or_absence_cannot_be_proven(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            for loopback in (ProvisionConnection(server_uuid=''),
                             ProvisionConnection(database='other'),
                             ProvisionConnection(schema_count=1),
                             ProvisionConnection(user_count=1)):
                with self.subTest(loopback=loopback.database,
                                  schema_count=loopback.schema_count,
                                  user_count=loopback.user_count):
                    with (mock.patch.object(self.provisioner.secrets, 'token_hex',
                                            return_value='a' * 12),
                          mock.patch.object(self.provisioner, 'write_private_env') as writer):
                        with self.assertRaises(self.provisioner.QaProvisionError):
                            self.provisioner.provision_qa_account(
                                backup, {'NAME': 'eve_echoes'}, IdentityConnection(), loopback,
                                expected_database='eve_echoes', backup_root=root,
                                effective_uid=0, stat_reader=reader,
                            )
                        writer.assert_not_called()
                    self.assertFalse(any('CREATE USER' in sql or 'GRANT ' in sql
                                         for sql, _ in loopback.commands))

    def test_refuses_non_private_directory_before_database_access(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            source = IdentityConnection()
            loopback = ProvisionConnection()
            with self.assertRaises(self.provisioner.QaProvisionError):
                self.provisioner.provision_qa_account(
                    backup, {'NAME': 'eve_echoes'}, source, loopback,
                    expected_database='eve_echoes', backup_root=root,
                    effective_uid=1000, stat_reader=reader,
                )
            self.assertEqual(source.commands, [])
            self.assertEqual(loopback.commands, [])

    def test_env_is_exclusive_owner_private_and_records_server_uuid(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary)
            real_open = os.open
            requested = []
            modes = []
            fake_nofollow = 0x400000

            def open_file(path, flags, mode):
                requested.append((path, flags, mode))
                return real_open(path, flags & ~fake_nofollow, mode)

            options = {'platform_name': 'posix', 'nofollow_flag': fake_nofollow,
                       'open_file': open_file,
                       'chmod_file': lambda _fd, mode: modes.append(mode)}
            schema = 'evem_market_qa_0123456789ab'
            password = 'P' * 43
            self.provisioner.write_private_env(target, schema, password, SERVER_UUID,
                                               **options)
            contents = (target / 'market-qa.env').read_text(encoding='ascii')
            self.assertEqual(contents, (
                'EVEM_REHEARSAL_ENABLE=1\n'
                f'EVEM_REHEARSAL_DB_NAME={schema}\n'
                f'EVEM_REHEARSAL_DB_USER={schema}\n'
                f'EVEM_REHEARSAL_DB_PASSWORD={password}\n'
                f'EVEM_REHEARSAL_EXPECTED_SERVER_UUID={SERVER_UUID}\n'
            ))
            self.assertEqual(modes, [0o600])
            self.assertEqual(requested[0][2], 0o600)
            self.assertTrue(requested[0][1] & os.O_EXCL)
            self.assertTrue(requested[0][1] & fake_nofollow)
            with self.assertRaises(self.provisioner.QaProvisionError):
                self.provisioner.write_private_env(target, schema, 'Q' * 43, SERVER_UUID,
                                                   **options)
            self.assertEqual((target / 'market-qa.env').read_text(encoding='ascii'), contents)

    def test_failed_env_sync_removes_partial_secret_file(self):
        with TemporaryDirectory() as temporary:
            target = Path(temporary)
            real_open = os.open
            fake_nofollow = 0x400000

            def open_file(path, flags, mode):
                return real_open(path, flags & ~fake_nofollow, mode)

            with mock.patch.object(self.provisioner.os, 'fsync', side_effect=OSError):
                with self.assertRaises(self.provisioner.QaProvisionError):
                    self.provisioner.write_private_env(
                        target, 'evem_market_qa_0123456789ab', 'P' * 43, SERVER_UUID,
                        platform_name='posix', nofollow_flag=fake_nofollow,
                        open_file=open_file, chmod_file=lambda *_args: None,
                    )
            self.assertFalse((target / 'market-qa.env').exists())

    def test_candidate_wiring_uses_loaded_identity_and_fixed_loopback_endpoint(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            source = IdentityConnection()
            loopback = ProvisionConnection()
            loopback.close = mock.Mock()
            calls = []
            settings = {'NAME': 'eve_echoes', 'USER': 'synthetic_admin',
                        'PASSWORD': 'synthetic-password'}

            def connect_loopback(**kwargs):
                calls.append(kwargs)
                return loopback

            with mock.patch.object(self.provisioner, 'provision_qa_account',
                                   return_value='evem_market_qa_aaaaaaaaaaaa') as provision:
                result = self.provisioner.provision_from_candidate(
                    Path(temporary) / 'candidate', backup, 'eve_echoes',
                    load_settings=lambda _backend: (settings, 'eve_echoes'),
                    get_source_connection=lambda: source,
                    connect_loopback=connect_loopback,
                    backup_root=root, effective_uid=0, stat_reader=reader,
                    platform_name='posix',
                )
            self.assertEqual(result, 'evem_market_qa_aaaaaaaaaaaa')
            self.assertEqual(calls, [{
                'host': '127.0.0.1', 'port': 3306, 'user': 'synthetic_admin',
                'passwd': 'synthetic-password', 'db': 'eve_echoes',
                'connect_timeout': 5, 'charset': 'utf8mb4',
            }])
            self.assertEqual(provision.call_count, 1)
            loopback.close.assert_called_once_with()

    def test_candidate_mismatch_never_opens_loopback_or_mutates(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)
            for settings_name, actual_name in (('other', 'eve_echoes'),
                                               ('eve_echoes', 'other')):
                with self.subTest(settings_name=settings_name, actual_name=actual_name):
                    connector = mock.Mock()
                    with mock.patch.object(self.provisioner, 'provision_qa_account') as provision:
                        with self.assertRaises(self.provisioner.QaProvisionError):
                            self.provisioner.provision_from_candidate(
                                Path(temporary) / 'candidate', backup, 'eve_echoes',
                                load_settings=lambda _backend: (
                                    {'NAME': settings_name, 'USER': 'synthetic_admin',
                                     'PASSWORD': 'synthetic-password'}, actual_name),
                                get_source_connection=lambda: IdentityConnection(),
                                connect_loopback=connector, backup_root=root,
                                effective_uid=0, stat_reader=reader,
                                platform_name='posix',
                            )
                    connector.assert_not_called()
                    provision.assert_not_called()

    def test_grant_failure_is_sanitized_and_private_env_is_retained(self):
        with TemporaryDirectory() as temporary:
            root, backup, reader = self._backup_fixture(temporary)

            class FailingGrant(ProvisionConnection):
                def execute(self, sql, params=None):
                    super().execute(sql, params)
                    if sql.startswith('GRANT '):
                        raise RuntimeError('synthetic-password and /synthetic/private/path')

            loopback = FailingGrant()
            with (mock.patch.object(self.provisioner.secrets, 'token_hex',
                                    return_value='a' * 12),
                  mock.patch.object(self.provisioner.secrets, 'token_urlsafe',
                                    return_value='P' * 43),
                  mock.patch.object(self.provisioner, 'write_private_env') as writer):
                with self.assertRaises(self.provisioner.QaProvisionError) as caught:
                    self.provisioner.provision_qa_account(
                        backup, {'NAME': 'eve_echoes'}, IdentityConnection(), loopback,
                        expected_database='eve_echoes', backup_root=root,
                        effective_uid=0, stat_reader=reader,
                    )
                writer.assert_called_once()
            self.assertNotIn('synthetic-password', str(caught.exception))
            self.assertNotIn('/synthetic/private/path', str(caught.exception))
            self.assertEqual([sql.split()[0] for sql, _ in loopback.commands][-2:],
                             ['CREATE', 'GRANT'])

    def test_cli_requires_explicit_switch_and_never_prints_paths_or_password(self):
        backend = Path('C:/synthetic/candidate')
        backup = Path('C:/synthetic/private-backup')
        args = ['--backend', str(backend), '--expected-database', 'eve_echoes',
                '--backup-dir', str(backup)]
        stdout, stderr = StringIO(), StringIO()
        runner = mock.Mock(return_value='evem_market_qa_aaaaaaaaaaaa')
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(self.provisioner.main(args, provisioner=runner), 2)
        runner.assert_not_called()
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(self.provisioner.main(args + ['--provision-qa'],
                                                   provisioner=runner), 0)
        runner.assert_called_once()
        self.assertNotIn(str(backup), stdout.getvalue() + stderr.getvalue())
        self.assertNotIn(str(backend), stdout.getvalue() + stderr.getvalue())
        self.assertNotIn('evem_market_qa_aaaaaaaaaaaa', stdout.getvalue())
        self.assertNotIn('synthetic-password', stdout.getvalue())
        stdout, stderr = StringIO(), StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            self.assertEqual(self.provisioner.main(
                args + ['--provision-qa'],
                provisioner=mock.Mock(side_effect=RuntimeError(
                    'synthetic-password C:/synthetic/private-backup')),
            ), 2)
        self.assertNotIn('synthetic-password', stdout.getvalue() + stderr.getvalue())
        self.assertNotIn(str(backup), stdout.getvalue() + stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
