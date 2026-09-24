"""Synthetic-only safety tests for the isolated MySQL restore rehearsal."""

from contextlib import redirect_stderr, redirect_stdout
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'market_mysql_restore_rehearsal.py'
spec = importlib.util.spec_from_file_location('market_mysql_restore_under_test', SCRIPT)
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestoreFixture:
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.dump = self.root / 'default-before-market.sql'
        self.manifest = self.root / 'backup.json'

    def write_backup(self, payload, **overrides):
        self.dump.write_bytes(payload)
        record = {
            'file': str(self.dump), 'size': len(payload),
            'sha256': hashlib.sha256(payload).hexdigest(),
            'database': 'eve_echoes', 'created_at': '2026-09-24T00:00:00+00:00',
        }
        record.update(overrides)
        self.manifest.write_text(json.dumps(record), encoding='utf-8')
        if os.name == 'posix':
            self.dump.chmod(0o600)
            self.manifest.chmod(0o600)


class RestorePreflightTests(RestoreFixture, unittest.TestCase):
    def test_qa_schema_requires_exact_prefix_and_nontrivial_suffix(self):
        for unsafe in ('eve_echoes', 'evem_market_qa_', 'evem_market_qa_x',
                       'evem_market_qa_20260924a', 'evem_market_qa_ghijklmnopqr',
                       'evem_market_qa_abc;DROP DATABASE eve_echoes',
                       'EVEM_MARKET_QA_abcdefgh', 'evem_market_qa_abcdefgh/other'):
            with self.subTest(unsafe=unsafe), self.assertRaises(restore.RehearsalError):
                restore.validate_qa_schema(unsafe, 'eve_echoes')
        self.assertEqual(restore.validate_qa_schema('evem_market_qa_0123456789ab', 'eve_echoes'),
                         'evem_market_qa_0123456789ab')

    def test_manifest_hash_and_footer_are_verified_before_any_connection(self):
        payload = b'CREATE TABLE `one` (`id` int);\n-- Dump completed on 2026-09-24\n'
        self.write_backup(payload)
        verified = restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')
        self.assertEqual(verified.dump_path, self.dump)
        self.manifest.write_text(self.manifest.read_text().replace('a', 'b', 1), encoding='utf-8')
        with self.assertRaises(restore.RehearsalError):
            restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')
        self.write_backup(b'CREATE TABLE `one` (`id` int);\n')
        with self.assertRaises(restore.RehearsalError):
            restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')

    def test_manifest_cannot_redirect_to_other_file_or_source_schema(self):
        payload = b'CREATE TABLE `one` (`id` int);\n-- Dump completed on 2026-09-24\n'
        self.write_backup(payload, file=str(self.root.parent / 'other.sql'))
        with self.assertRaises(restore.RehearsalError):
            restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')
        self.write_backup(payload, database='evem_market_qa_0123456789ab')
        with self.assertRaises(restore.RehearsalError):
            restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')

    def test_manifest_parent_must_be_real_owner_private_directory(self):
        self.assertTrue(restore.private_backup_parent(stat.S_IFDIR | 0o700, 1000, 1000))
        for mode, owner in ((stat.S_IFDIR | 0o750, 1000),
                            (stat.S_IFDIR | 0o707, 1000),
                            (stat.S_IFREG | 0o600, 1000),
                            (stat.S_IFDIR | 0o700, 2000)):
            with self.subTest(mode=mode, owner=owner):
                self.assertFalse(restore.private_backup_parent(mode, owner, 1000))

    def test_standard_mysqldump_conditional_comments_and_strings_are_allowed(self):
        payload = (b'-- MySQL dump\n/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n'
                   b'DROP TABLE IF EXISTS `sample`;\nCREATE TABLE `sample` (`text` text);\n'
                   b'INSERT INTO `sample` VALUES (\'USE eve_echoes; CREATE DATABASE evil\');\n'
                   b'/*!50003 CREATE*/ /*!50017 DEFINER=`qa`@`%`*/ '
                   b'/*!50003 TRIGGER `sample_trigger` BEFORE INSERT ON `sample` '
                   b'FOR EACH ROW SET @x = 1 */;;\n'
                   b'DELIMITER ;;\nDELIMITER ;\n-- Dump completed on 2026-09-24\n')
        self.write_backup(payload)
        restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')

    def test_database_switch_and_source_qualification_are_rejected(self):
        preamble = b'CREATE TABLE `one` (`id` int);\n'
        footer = b'\n-- Dump completed on 2026-09-24\n'
        forbidden = (
            b'CREATE DATABASE `eve_echoes`;', b'/*!40100 CREATE DATABASE `eve_echoes` */;',
            b'USE `eve_echoes`;', b'DROP SCHEMA eve_echoes;',
            b'INSERT INTO `eve_echoes`.`one` VALUES (1);',
            b'\\! touch /tmp/unsafe', b'SOURCE /tmp/unsafe.sql',
        )
        for sql in forbidden:
            with self.subTest(sql=sql):
                self.write_backup(preamble + sql + footer)
                with self.assertRaises(restore.RehearsalError):
                    restore.verify_backup(self.manifest, 'evem_market_qa_0123456789ab')


class FakeMysql:
    """Minimal process boundary: records actual SQL and models schema creation."""

    def __init__(self, case, schema, password, *, existing=False, changed_identity=False,
                 unsafe_grant=False, fail_import=False, active_role=False,
                 account_host='127.0.0.1'):
        self.case = case
        self.schema = schema
        self.password = password
        self.existing = existing
        self.changed_identity = changed_identity
        self.unsafe_grant = unsafe_grant
        self.fail_import = fail_import
        self.active_role = active_role
        self.account_host = account_host
        self.commands = []
        self.created = False
        self.imported = False
        self.option_path = None

    def __call__(self, args, *, stdin, stdout, stderr, check, env):
        self.case.assertEqual(args[0], 'mysql')
        self.case.assertTrue(args[1].startswith('--defaults-file='))
        self.case.assertNotIn(self.password, ' '.join(args))
        self.case.assertFalse('MYSQL_PWD' in env, 'MySQL password env was forwarded')
        self.case.assertFalse('EVEM_REHEARSAL_DB_PASSWORD' in env,
                              'rehearsal password env was forwarded')
        self.case.assertFalse('PROVIDER_API_KEY' in env, 'provider key was forwarded')
        self.case.assertIn('--protocol=TCP', args)
        self.case.assertIn('--local-infile=0', args)
        self.case.assertIn('--binary-mode', args)
        self.case.assertFalse(check)
        self.case.assertEqual(stderr, subprocess.PIPE)
        option_path = Path(args[1].split('=', 1)[1])
        self.option_path = option_path
        self.case.assertTrue(option_path.exists())
        self.case.assertIn('password="' + self.password + '"', option_path.read_text())
        self.case.assertEqual(env['MYSQL_TEST_LOGIN_FILE'], str(option_path) + '.no-login-path')
        self.case.assertFalse(Path(env['MYSQL_TEST_LOGIN_FILE']).exists())
        if os.name != 'nt':
            self.case.assertEqual(stat.S_IMODE(option_path.stat().st_mode), 0o600)
        selected = f'--database={self.schema}' in args
        sql = next((arg.removeprefix('--execute=') for arg in args
                    if arg.startswith('--execute=')), None)
        self.commands.append((sql, selected))
        if stdin is not None:
            self.case.assertTrue(selected)
            self.case.assertEqual(stdin.read(20), b'CREATE TABLE `one` (')
            self.imported = True
            return SimpleNamespace(returncode=1 if self.fail_import else 0, stdout=b'',
                                   stderr=(b'ERROR 1227 (42000): ' + self.password.encode()
                                           if self.fail_import else b''))
        if sql in ('SELECT DATABASE(), CURRENT_USER(), @@server_uuid',
                   'SELECT DATABASE(), CURRENT_USER(), @@server_uuid, CURRENT_ROLE()'):
            database = self.schema if selected else 'NULL'
            server = ('ffffffff-ffff-ffff-ffff-ffffffffffff' if selected and self.changed_identity
                      else '123e4567-e89b-12d3-a456-426614174000')
            role = ('\tqa_admin@localhost' if self.active_role else '\tNONE') \
                if 'CURRENT_ROLE()' in sql else ''
            return SimpleNamespace(returncode=0, stdout=(
                f'{database}\t{self.schema}@{self.account_host}\t{server}{role}\n').encode())
        if sql == 'SHOW GRANTS':
            scope = '*.*' if self.unsafe_grant else '`' + self.schema.replace('_', '\\_') + '`.*'
            grants = (f"GRANT USAGE ON *.* TO '{self.schema}'@'{self.account_host}'\n"
                      f"GRANT ALL PRIVILEGES ON {scope} TO '{self.schema}'@'{self.account_host}'\n")
            return SimpleNamespace(returncode=0, stdout=grants.encode())
        if sql.startswith('SELECT COUNT(*) FROM information_schema.SCHEMATA'):
            return SimpleNamespace(returncode=0, stdout=b'1\n' if self.existing else b'0\n')
        if sql.startswith('CREATE DATABASE '):
            self.case.assertFalse(selected)
            self.created = True
            return SimpleNamespace(returncode=0, stdout=b'')
        if sql.startswith('SELECT TABLE_NAME FROM information_schema.TABLES'):
            return SimpleNamespace(returncode=0, stdout=b'one\n')
        if sql == 'SELECT DATABASE(), COUNT(*) FROM `one`':
            return SimpleNamespace(returncode=0, stdout=f'{self.schema}\t2\n'.encode())
        raise AssertionError(f'unexpected synthetic SQL: {sql}')


class RestoreExecutionTests(RestoreFixture, unittest.TestCase):
    SCHEMA = 'evem_market_qa_0123456789ab'
    PASSWORD = 'synthetic-secret-at-least-24-chars'

    def setUp(self):
        super().setUp()
        self.write_backup(b'CREATE TABLE `one` (`id` int);\n'
                          b'INSERT INTO `one` VALUES (1),(2);\n'
                          b'-- Dump completed on 2026-09-24\n')
        self.environ = {
            'EVEM_REHEARSAL_ENABLE': '1', 'EVEM_REHEARSAL_DB_NAME': self.SCHEMA,
            'EVEM_REHEARSAL_DB_USER': self.SCHEMA,
            'EVEM_REHEARSAL_DB_PASSWORD': self.PASSWORD,
            'EVEM_REHEARSAL_EXPECTED_SERVER_UUID': '123e4567-e89b-12d3-a456-426614174000',
            'MYSQL_PWD': 'inherited-unsafe-secret',
        }

    def test_rehearsal_creates_only_fresh_qa_schema_and_preserves_it(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with patch.dict(os.environ, {'PROVIDER_API_KEY': 'synthetic-provider-secret'}):
            result = restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertTrue(fake.created)
        self.assertTrue(fake.imported)
        self.assertEqual(result['schema'], self.SCHEMA)
        self.assertEqual(result['table_counts'], {'one': 2})
        self.assertTrue(fake.option_path and not fake.option_path.exists())
        self.assertFalse(any(sql and 'DROP DATABASE' in sql for sql, _ in fake.commands))
        self.assertTrue(all(selected for sql, selected in fake.commands[fake.commands.index(
            (f'CREATE DATABASE `{self.SCHEMA}` CHARACTER SET utf8mb4', False)) + 1:]))

    def test_existing_schema_is_never_reused_or_dropped(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, existing=True)
        with self.assertRaisesRegex(restore.RehearsalError, 'already exists'):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertFalse(fake.created)
        self.assertFalse(fake.imported)

    def test_unsafe_grants_fail_before_create(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, unsafe_grant=True)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertFalse(fake.created)

    def test_unexpected_server_uuid_fails_before_create(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(
                self.manifest, self.SCHEMA,
                environ={**self.environ, 'EVEM_REHEARSAL_EXPECTED_SERVER_UUID':
                         'ffffffff-ffff-ffff-ffff-ffffffffffff'}, runner=fake,
            )
        self.assertFalse(fake.created)

    def test_active_mysql_role_is_rejected_before_create(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, active_role=True)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertFalse(fake.created)

    def test_non_loopback_account_host_is_rejected_before_create(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, account_host='localhost')
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertFalse(fake.created)

    def test_switched_connection_must_match_same_server_and_schema(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, changed_identity=True)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertTrue(fake.created)
        self.assertFalse(fake.imported)

    def test_import_failure_leaves_schema_for_manual_review_without_secret_output(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD, fail_import=True)
        with self.assertRaises(restore.RehearsalError) as failure:
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertTrue(fake.created)
        self.assertTrue(fake.imported)
        self.assertNotIn(self.PASSWORD, str(failure.exception))
        self.assertIn('1227', str(failure.exception))
        self.assertTrue(fake.option_path and not fake.option_path.exists())

    def test_optional_manifest_table_counts_are_compared_exactly(self):
        payload = self.dump.read_bytes()
        self.write_backup(payload, table_counts={'one': 2})
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        result = restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertTrue(result['source_counts_compared'])
        self.write_backup(payload, table_counts={'one': 3})
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with self.assertRaisesRegex(restore.RehearsalError, 'table counts differ'):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertTrue(fake.created)
        self.assertTrue(fake.imported)

    def test_invalid_manifest_table_counts_are_rejected_before_db_call(self):
        self.write_backup(self.dump.read_bytes(), table_counts={'one': -1})
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, environ=self.environ, runner=fake)
        self.assertEqual(fake.commands, [])

    def test_enable_and_env_schema_match_are_required_before_db_call(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        for changed in ({'EVEM_REHEARSAL_ENABLE': '0'},
                        {'EVEM_REHEARSAL_DB_NAME': 'eve_echoes'},
                        {'EVEM_REHEARSAL_DB_USER': 'qa'},
                        {'EVEM_REHEARSAL_DB_PASSWORD': ''},
                        {'EVEM_REHEARSAL_DB_PASSWORD': 'short'}):
            with self.subTest(changed=changed), self.assertRaises(restore.RehearsalError):
                restore.rehearse(self.manifest, self.SCHEMA,
                                 environ={**self.environ, **changed}, runner=fake)
        self.assertEqual(fake.commands, [])

    def candidate_backend(self):
        backend = self.root / 'candidate' / 'backend'
        (backend / 'EVE_MDjango').mkdir(parents=True)
        (backend / 'Market' / 'migrations').mkdir(parents=True)
        (backend / 'Market' / 'management' / 'commands').mkdir(parents=True)
        (backend / 'Market' / 'data').mkdir(parents=True)
        (backend / 'manage.py').write_text('# synthetic\n')
        (backend / 'EVE_MDjango' / 'market_rehearsal_settings.py').write_text('# synthetic\n')
        (backend / 'Market' / 'migrations' / '0001_initial.py').write_text('# synthetic\n')
        (backend / 'Market' / 'management' / 'commands' / 'market_seed_catalog.py').write_text(
            '# synthetic\n')
        (backend / 'Market' / 'data' / 'market_catalog.json').write_text(
            json.dumps([{'item_id': 1, 'item_name': 'Synthetic item'}]))
        return backend

    def test_candidate_assets_are_checked_without_running_django(self):
        backend = self.candidate_backend()
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        result = restore.rehearse(self.manifest, self.SCHEMA, backend_dir=backend,
                                  environ=self.environ, runner=fake)
        self.assertEqual(result['candidate_assets']['migration_files'], ['0001_initial'])
        self.assertEqual(result['candidate_assets']['catalog_rows'], 1)
        self.assertTrue(result['candidate_assets']['guarded_settings_present'])
        self.assertFalse(any('migrate' in str(sql).lower() for sql, _ in fake.commands))

    def test_missing_guarded_candidate_fails_before_any_database_call(self):
        backend = self.candidate_backend()
        (backend / 'EVE_MDjango' / 'market_rehearsal_settings.py').unlink()
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, backend_dir=backend,
                             environ=self.environ, runner=fake)
        self.assertEqual(fake.commands, [])

    def test_invalid_seed_catalog_fails_before_any_database_call(self):
        backend = self.candidate_backend()
        (backend / 'Market' / 'data' / 'market_catalog.json').write_text(json.dumps([
            {'item_id': 1, 'item_name': 'x' * 256, 'market_group_name_3rd': 'Ships'},
        ]))
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        with self.assertRaises(restore.RehearsalError):
            restore.rehearse(self.manifest, self.SCHEMA, backend_dir=backend,
                             environ=self.environ, runner=fake)
        self.assertEqual(fake.commands, [])

    def test_cli_outputs_only_safe_report_and_never_accepts_password_arg(self):
        fake = FakeMysql(self, self.SCHEMA, self.PASSWORD)
        output = io.StringIO()
        with redirect_stdout(output):
            code = restore.main(['--manifest', str(self.manifest), '--qa-schema', self.SCHEMA],
                                environ=self.environ, runner=fake)
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue())['schema'], self.SCHEMA)
        self.assertNotIn(self.PASSWORD, output.getvalue())

    def test_verify_only_scans_dump_and_candidate_without_env_or_mysql(self):
        backend = self.candidate_backend()
        output = io.StringIO()
        with redirect_stdout(output), patch.dict(os.environ, {
            'EVEM_REHEARSAL_DB_PASSWORD': 'synthetic-hidden-secret',
            'PROVIDER_API_KEY': 'synthetic-provider-secret',
        }):
            code = restore.main(
                ['--verify-only', '--manifest', str(self.manifest), '--backend-dir', str(backend)],
                environ={}, runner=lambda *args, **kwargs: self.fail('MySQL must not be called'),
            )
        self.assertEqual(code, 0)
        report = json.loads(output.getvalue())
        self.assertEqual(report, {
            'size': self.dump.stat().st_size,
            'sha256': hashlib.sha256(self.dump.read_bytes()).hexdigest(),
            'catalog_rows': 1,
        })
        self.assertNotIn('synthetic-hidden-secret', output.getvalue())
        self.assertNotIn('synthetic-provider-secret', output.getvalue())
        self.assertNotIn('CREATE TABLE', output.getvalue())

    def test_verify_only_rejects_unsafe_dump_without_mysql_or_dump_output(self):
        backend = self.candidate_backend()
        self.write_backup(b'USE `eve_echoes`; -- synthetic-private-marker\n'
                          b'-- Dump completed on 2026-09-24\n')
        output = io.StringIO()
        errors = io.StringIO()
        with redirect_stdout(output), redirect_stderr(errors):
            code = restore.main(
                ['--verify-only', '--manifest', str(self.manifest), '--backend-dir', str(backend)],
                environ={}, runner=lambda *args, **kwargs: self.fail('MySQL must not be called'),
            )
        self.assertEqual(code, 2)
        self.assertEqual(output.getvalue(), '')
        self.assertNotIn('synthetic-private-marker', errors.getvalue())
        self.assertIn('database switch', errors.getvalue())


if __name__ == '__main__':
    unittest.main()
