"""Synthetic-only worker account provisioning tests; never contact MySQL."""

import importlib
import io
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import ModuleType
import unittest
from unittest.mock import patch


SERVER_UUID = '01234567-89ab-4cde-8123-456789abcdef'
TABLES = (
    'Market_collectionrun', 'Market_latestprice', 'Market_marketconfig',
    'Market_marketconfigaudit', 'Market_marketitem', 'Market_pricesnapshot',
)


class IdentityConnection:
    def __init__(self, database='eve_echoes', server_uuid=SERVER_UUID,
                 mandatory_roles='', tables=TABLES):
        self.database = database
        self.server_uuid = server_uuid
        self.mandatory_roles = mandatory_roles
        self.tables = tables
        self.commands = []
        self.closed = False

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

    def fetchall(self):
        return [(table, 'BASE TABLE') if isinstance(table, str) else table
                for table in self.tables]

    def close(self):
        self.closed = True


class CandidateConnection(IdentityConnection):
    vendor = 'mysql'

    def __init__(self, *local_connections, **kwargs):
        super().__init__(**kwargs)
        self.settings_dict = {
            'ENGINE': 'django.db.backends.mysql', 'NAME': 'eve_echoes',
            'USER': 'synthetic-admin', 'PASSWORD': 'synthetic-admin-secret',
            'HOST': '192.0.2.25', 'PORT': '3306',
        }
        self.local_connections = list(local_connections)
        self.new_connection_parameters = []

    def get_new_connection(self, parameters):
        self.new_connection_parameters.append(dict(parameters))
        return self.local_connections.pop(0)


class WorkerLoginConnection(IdentityConnection):
    def __init__(self, username, **kwargs):
        super().__init__(**kwargs)
        self.username = username

    def fetchone(self):
        return f'{self.username}@127.0.0.1', self.database, self.server_uuid, 'NONE'


class WorkerProvisionTests(unittest.TestCase):
    def setUp(self):
        try:
            self.provisioner = importlib.import_module('scripts.deploy.market_mysql_worker_provision')
        except ModuleNotFoundError:
            self.fail('Worker provisioning helper is missing')

    def test_source_and_loopback_must_prove_same_exact_schema_and_server(self):
        source = IdentityConnection()
        loopback = IdentityConnection()
        self.assertEqual(self.provisioner.verify_local_target(source, loopback), SERVER_UUID)
        expected_query = ('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None)
        self.assertEqual(source.commands, [expected_query])
        self.assertEqual(loopback.commands, [expected_query])
        for altered in (
            IdentityConnection(database='other'),
            IdentityConnection(server_uuid='11111111-1111-4111-8111-111111111111'),
            IdentityConnection(server_uuid='not-a-uuid'),
            IdentityConnection(mandatory_roles='extra@localhost'),
        ):
            with self.subTest(altered=altered.__dict__):
                with self.assertRaises(self.provisioner.ProvisionError):
                    self.provisioner.verify_local_target(source, altered)

    def test_all_six_migrated_market_tables_must_be_real_base_tables(self):
        self.assertTrue(hasattr(self.provisioner, 'require_market_tables'))
        connection = IdentityConnection(tables=(*TABLES, 'Authentication_evemuser'))
        self.provisioner.require_market_tables(connection)
        self.assertEqual(connection.commands, [(
            'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES '
            'WHERE TABLE_SCHEMA = DATABASE()', None,
        )])
        for tables in (TABLES[:-1], (*TABLES[:-1], (TABLES[-1], 'VIEW')),
                       (*TABLES, TABLES[0])):
            with self.subTest(tables=tables):
                with self.assertRaises(self.provisioner.ProvisionError):
                    self.provisioner.require_market_tables(IdentityConnection(tables=tables))

    def test_account_creation_uses_exact_loopback_host_and_minimal_table_grants(self):
        self.assertTrue(hasattr(self.provisioner, 'grant_market_worker'))
        connection = IdentityConnection()
        username = 'evem_market_worker_0123456789ab'
        password = 'Synthetic_safe_password_0123456789abcdef'
        self.provisioner.grant_market_worker(connection, username, password)
        self.assertEqual(connection.commands, [
            ('CREATE USER %s@%s IDENTIFIED BY %s', (username, '127.0.0.1', password)),
            ('GRANT SELECT, INSERT, UPDATE ON `eve_echoes`.`Market_collectionrun` TO %s@%s',
             (username, '127.0.0.1')),
            ('GRANT SELECT, INSERT, UPDATE ON `eve_echoes`.`Market_latestprice` TO %s@%s',
             (username, '127.0.0.1')),
            ('GRANT SELECT, INSERT, UPDATE ON `eve_echoes`.`Market_marketconfig` TO %s@%s',
             (username, '127.0.0.1')),
            ('GRANT SELECT, UPDATE ON `eve_echoes`.`Market_marketitem` TO %s@%s',
             (username, '127.0.0.1')),
            ('GRANT SELECT, INSERT ON `eve_echoes`.`Market_pricesnapshot` TO %s@%s',
             (username, '127.0.0.1')),
        ])
        self.assertNotIn('Market_marketconfigaudit', repr(connection.commands))
        self.assertNotIn('DELETE', repr(connection.commands))
        self.assertNotIn('ON *.*', repr(connection.commands))

    def test_invalid_generated_identity_fails_before_any_account_sql(self):
        self.assertTrue(hasattr(self.provisioner, 'grant_market_worker'))
        for username, password in (
            ('evem_market_worker_wrong', 'Synthetic_safe_password_0123456789abcdef'),
            ('evem_market_worker_0123456789ab', 'unsafe\npassword'),
        ):
            with self.subTest(username=username):
                connection = IdentityConnection()
                with self.assertRaises(self.provisioner.ProvisionError):
                    self.provisioner.grant_market_worker(connection, username, password)
                self.assertEqual(connection.commands, [])

    def test_environment_is_complete_before_atomic_no_overwrite_install(self):
        self.assertTrue(hasattr(self.provisioner, 'write_private_environment'))
        with tempfile.TemporaryDirectory() as temporary:
            parent = Path(temporary).resolve()
            target = parent / 'database.env'
            password = 'Synthetic_safe_password_0123456789abcdef'
            username = 'evem_market_worker_0123456789ab'
            real_link = os.link
            observed = []

            def inspect_link(source, destination, *args, **kwargs):
                self.assertEqual(Path(destination), target)
                self.assertFalse(target.exists())
                self.assertEqual(Path(source).parent, parent)
                data = Path(source).read_text(encoding='utf-8')
                self.assertEqual(data, (
                    'MARKET_DB_NAME="eve_echoes"\n'
                    f'MARKET_DB_USER="{username}"\n'
                    f'MARKET_DB_PASSWORD="{password}"\n'
                    'MARKET_DB_HOST="127.0.0.1"\n'
                    'MARKET_DB_PORT="3306"\n'
                ))
                if os.name != 'nt':
                    self.assertEqual(stat.S_IMODE(Path(source).stat().st_mode), 0o600)
                observed.append(Path(source))
                return real_link(source, destination, *args, **kwargs)

            with patch.object(self.provisioner.os, 'link', side_effect=inspect_link):
                self.provisioner.write_private_environment(target, username, password)
            self.assertEqual(len(observed), 1)
            self.assertFalse(observed[0].exists())
            self.assertEqual(target.read_text(encoding='utf-8').count('\n'), 5)
            if os.name != 'nt':
                self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o600)
            with self.assertRaises(self.provisioner.ProvisionError):
                self.provisioner.write_private_environment(target, username, password)
            self.assertEqual(target.read_text(encoding='utf-8').count('\n'), 5)

    def test_private_parent_rule_rejects_other_writers_and_wrong_owner(self):
        self.assertTrue(hasattr(self.provisioner, 'private_market_directory'))
        self.assertTrue(self.provisioner.private_market_directory(0o40750, 1000, 1000))
        self.assertFalse(self.provisioner.private_market_directory(0o40770, 1000, 1000))
        self.assertFalse(self.provisioner.private_market_directory(0o40755, 1000, 1000))
        self.assertFalse(self.provisioner.private_market_directory(0o40757, 1000, 1000))
        self.assertFalse(self.provisioner.private_market_directory(0o40750, 1001, 1000))

    def test_full_provision_checks_before_creating_and_verifies_worker_host_match(self):
        self.assertTrue(hasattr(self.provisioner, 'provision_worker'))
        username = 'evem_market_worker_0123456789ab'
        password = 'Synthetic_safe_password_0123456789abcdef'
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary).resolve() / 'database.env'
            admin = IdentityConnection()
            worker = WorkerLoginConnection(username)
            source = CandidateConnection(admin, worker)
            real_execute = admin.execute

            def inspect_admin_sql(sql, params=None):
                if sql.startswith('CREATE USER'):
                    self.assertTrue(target.is_file(), 'env must be durable before account creation')
                    self.assertIn(password, target.read_text(encoding='utf-8'))
                real_execute(sql, params)

            with patch.object(admin, 'execute', side_effect=inspect_admin_sql), \
                    patch.object(self.provisioner.secrets, 'token_hex', return_value='0123456789ab'), \
                    patch.object(self.provisioner.secrets, 'token_urlsafe', return_value=password):
                self.assertEqual(self.provisioner.provision_worker(source, target), SERVER_UUID)
            self.assertEqual(source.commands, [
                ('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles', None),
            ])
            self.assertEqual(admin.commands[0], source.commands[0])
            self.assertEqual(admin.commands[1][0],
                             'SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES '
                             'WHERE TABLE_SCHEMA = DATABASE()')
            self.assertEqual(admin.commands[2][0], 'CREATE USER %s@%s IDENTIFIED BY %s')
            self.assertEqual(worker.commands, [
                ('SELECT CURRENT_USER(), DATABASE(), @@server_uuid, CURRENT_ROLE()', None),
            ])
            self.assertTrue(admin.closed)
            self.assertTrue(worker.closed)
            self.assertEqual(len(source.new_connection_parameters), 2)
            for parameters in source.new_connection_parameters:
                self.assertEqual(parameters['host'], '127.0.0.1')
                self.assertEqual(parameters['port'], 3306)
                self.assertEqual(parameters['database'], 'eve_echoes')
                self.assertNotIn('unix_socket', parameters)
            self.assertEqual(source.new_connection_parameters[0]['user'], 'synthetic-admin')
            self.assertEqual(source.new_connection_parameters[1]['user'], username)
            self.assertEqual(source.new_connection_parameters[1]['password'], password)

    def test_failed_preflight_writes_no_environment_or_account_sql(self):
        self.assertTrue(hasattr(self.provisioner, 'provision_worker'))
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary).resolve() / 'database.env'
            admin = IdentityConnection(tables=TABLES[:-1])
            source = CandidateConnection(admin)
            with self.assertRaises(self.provisioner.ProvisionError):
                self.provisioner.provision_worker(source, target)
            self.assertFalse(target.exists())
            self.assertFalse(any(sql.startswith('CREATE USER') for sql, _ in admin.commands))
            self.assertTrue(admin.closed)

    def test_account_sql_error_is_sanitized_and_private_env_is_retained(self):
        self.assertTrue(hasattr(self.provisioner, 'provision_worker'))
        username = 'evem_market_worker_0123456789ab'
        password = 'Synthetic_safe_password_0123456789abcdef'
        with tempfile.TemporaryDirectory() as temporary:
            target = Path(temporary).resolve() / 'database.env'
            admin = IdentityConnection()
            source = CandidateConnection(admin)
            real_execute = admin.execute

            def fail_create(sql, params=None):
                real_execute(sql, params)
                if sql.startswith('CREATE USER'):
                    raise RuntimeError('RAW MYSQL FAILURE ' + password)

            with patch.object(admin, 'execute', side_effect=fail_create), \
                    patch.object(self.provisioner.secrets, 'token_hex', return_value='0123456789ab'), \
                    patch.object(self.provisioner.secrets, 'token_urlsafe', return_value=password):
                with self.assertRaises(self.provisioner.ProvisionError) as caught:
                    self.provisioner.provision_worker(source, target)
            self.assertNotIn(password, str(caught.exception))
            self.assertNotIn('RAW MYSQL FAILURE', str(caught.exception))
            self.assertTrue(target.is_file())
            self.assertIn(username, target.read_text(encoding='utf-8'))
            self.assertEqual(len(source.new_connection_parameters), 1)
            self.assertTrue(admin.closed)

    def test_loader_uses_explicit_candidate_default_mysql_only(self):
        self.assertTrue(hasattr(self.provisioner, 'load_candidate_default_connection'))
        with tempfile.TemporaryDirectory() as temporary:
            backend = Path(temporary).resolve() / 'candidate' / 'backend'
            (backend / 'EVE_MDjango').mkdir(parents=True)
            (backend / 'logs').mkdir()
            (backend / 'manage.py').touch()
            (backend / 'EVE_MDjango' / 'settings.py').touch()
            (backend / '.env').touch()
            source = CandidateConnection()
            setup_calls = []
            django = ModuleType('django')
            django.__path__ = []
            django.setup = lambda: setup_calls.append('setup')
            django_db = ModuleType('django.db')
            django_db.connections = {'default': source, 'license': object()}
            with patch.dict(sys.modules, {'django': django, 'django.db': django_db}), \
                    patch.dict(os.environ, {'DJANGO_SETTINGS_MODULE': 'EVE_MDjango.settings'}), \
                    patch.object(sys, 'path', sys.path.copy()):
                result = self.provisioner.load_candidate_default_connection(backend)
                self.assertEqual(sys.path[0], str(backend))
            self.assertIs(result, source)
            self.assertEqual(setup_calls, ['setup'])
            with patch.dict(os.environ, {'DJANGO_SETTINGS_MODULE': 'other.settings'}):
                with self.assertRaises(self.provisioner.ProvisionError):
                    self.provisioner.load_candidate_default_connection(backend)

    def test_cli_refuses_nonroot_before_loading_candidate_and_prints_no_secret(self):
        self.assertTrue(hasattr(self.provisioner, 'main'))
        secret = 'synthetic-secret-never-print'
        error = io.StringIO()
        with patch.object(self.provisioner.os, 'geteuid', return_value=1000, create=True), \
                patch.object(self.provisioner.sys, 'platform', 'linux'), \
                patch.object(self.provisioner, 'load_candidate_default_connection') as loader, \
                patch('sys.stderr', error):
            with self.assertRaises(SystemExit) as caught:
                self.provisioner.main(['--backend', '/synthetic/backend', '--provision-worker'])
        self.assertNotEqual(caught.exception.code, 0)
        loader.assert_not_called()
        self.assertNotIn(secret, error.getvalue())

    def test_cli_sanitizes_unexpected_errors_and_closes_default_connection(self):
        self.assertTrue(hasattr(self.provisioner, 'main'))
        source = CandidateConnection()
        output = io.StringIO()
        error = io.StringIO()
        with patch.object(self.provisioner.os, 'geteuid', return_value=0, create=True), \
                patch.object(self.provisioner.sys, 'platform', 'linux'), \
                patch.object(self.provisioner, 'load_candidate_default_connection', return_value=source), \
                patch.object(self.provisioner, 'provision_worker', side_effect=RuntimeError('synthetic-secret-never-print')), \
                patch('sys.stdout', output), patch('sys.stderr', error):
            with self.assertRaises(SystemExit) as caught:
                self.provisioner.main(['--backend', '/synthetic/backend', '--provision-worker'])
        self.assertNotEqual(caught.exception.code, 0)
        self.assertEqual(output.getvalue(), '')
        self.assertNotIn('synthetic-secret-never-print', error.getvalue())
        self.assertTrue(source.closed)

    def test_cli_requires_explicit_provision_switch_before_loading_candidate(self):
        self.assertTrue(hasattr(self.provisioner, 'main'))
        error = io.StringIO()
        with patch.object(self.provisioner.os, 'geteuid', return_value=0, create=True), \
                patch.object(self.provisioner.sys, 'platform', 'linux'), \
                patch.object(self.provisioner, 'load_candidate_default_connection') as loader, \
                patch.object(self.provisioner, 'provision_worker') as provision, \
                patch('sys.stderr', error):
            with self.assertRaises(SystemExit) as caught:
                self.provisioner.main(['--backend', '/synthetic/backend'])
        self.assertNotEqual(caught.exception.code, 0)
        loader.assert_not_called()
        provision.assert_not_called()


if __name__ == '__main__':
    unittest.main()
