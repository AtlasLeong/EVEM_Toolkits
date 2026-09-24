"""The production preflight is exercised with temporary files and fake DB adapters only."""
import hashlib
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

from scripts.deploy import tactical_multiboard_preflight as preflight


class TacticalPreflightSafetyTests(unittest.TestCase):
    def test_only_exact_0007_plan_is_accepted(self):
        self.assertEqual(
            preflight.require_plan([('TacticalCollaboration', '0007_multiboard_pirate')]),
            preflight.TARGET,
        )
        for plan in ([], [('TacticalCollaboration', '0006_organization_state_version')],
                     [('TacticalCollaboration', '0007_multiboard_pirate'), ('Other', '0001_initial')]):
            with self.subTest(plan=plan), self.assertRaises(preflight.PreflightError):
                preflight.require_plan(plan)

    def test_reverse_plan_is_never_silently_filtered(self):
        forward = (SimpleNamespace(app_label='TacticalCollaboration', name='0007_multiboard_pirate'), False)
        backwards = (SimpleNamespace(app_label='Other', name='0001_initial'), True)
        self.assertEqual(preflight.normalize_migration_plan([forward]), preflight.TARGET)
        with self.assertRaises(preflight.PreflightError):
            preflight.normalize_migration_plan([forward, backwards])

    def test_backup_directory_must_be_new_direct_child(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'private-backups'
            root.mkdir()
            os.chmod(root, 0o700)
            self.assertEqual(preflight.backup_destination(root / 'run-1', root), root / 'run-1')
            (root / 'existing').mkdir()
            for candidate in (root / 'existing', root / 'nested' / 'run', root.parent / 'outside'):
                with self.subTest(candidate=candidate), self.assertRaises(preflight.PreflightError):
                    preflight.backup_destination(candidate, root)

    def test_backup_root_must_be_private_and_operator_owned(self):
        if os.name != 'posix':
            self.skipTest('POSIX ownership gate')
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backups'
            root.mkdir(mode=0o700)
            os.chmod(root, 0o755)
            with self.assertRaises(preflight.PreflightError):
                preflight.backup_destination(root / 'new-run', root)

    def test_candidate_identity_is_bound_to_release_marker_and_migration_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            backend = Path(temporary)
            migration = backend / 'TacticalCollaboration' / 'migrations' / '0007_multiboard_pirate.py'
            migration.parent.mkdir(parents=True)
            migration.write_bytes(b'candidate migration\n')
            (backend / '.release-sha').write_text('a' * 40, encoding='ascii')
            self.assertEqual(preflight.candidate_identity(backend), {
                'sha': 'a' * 40,
                'migration_sha256': hashlib.sha256(b'candidate migration\n').hexdigest(),
            })
            (backend / '.release-sha').write_text('development', encoding='ascii')
            with self.assertRaises(preflight.PreflightError):
                preflight.candidate_identity(backend)

    def test_manifest_rejects_other_candidate_database_or_changed_counts(self):
        candidate = {'sha': 'a' * 40, 'migration_sha256': 'b' * 64}
        source = {'database': 'evem', 'server_uuid': 'server-1', 'version': '8.0.37',
                  'host': 'localhost', 'port': '3306', 'charset': 'utf8mb4',
                  'collation': 'utf8mb4_unicode_ci'}
        snapshot = {'organizations': [{'id': 1, 'region_ids': [100], 'border_hops': 1,
                                       'scope_version': 3, 'reports': 3, 'forces': 4}],
                    'report_count': 3, 'force_count': 4}
        manifest = {'format': 1, 'candidate': candidate, 'source': source,
                    'snapshot': snapshot, 'dump': {'file': '/private/backup.sql', 'sha256': 'c' * 64, 'size': 1}}
        preflight.require_manifest_match(manifest, candidate, source, snapshot)
        for changed_candidate, changed_source, changed_snapshot in (
            ({**candidate, 'sha': 'd' * 40}, source, snapshot),
            (candidate, {**source, 'database': 'other'}, snapshot),
            (candidate, source, {**snapshot, 'force_count': 5}),
        ):
            with self.assertRaises(preflight.PreflightError):
                preflight.require_manifest_match(manifest, changed_candidate, changed_source, changed_snapshot)

    def test_dump_evidence_checks_footer_size_and_sha256(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            dump = folder / 'before-0007.sql'
            dump.write_bytes(b'CREATE TABLE test (id int);\n-- Dump completed on 2026-09-24\n')
            os.chmod(dump, 0o600)
            evidence = preflight.dump_evidence(dump, folder)
            self.assertEqual(evidence['sha256'], hashlib.sha256(dump.read_bytes()).hexdigest())
            preflight.require_dump(evidence, folder)
            dump.write_bytes(b'CREATE TABLE test (id int);\n-- Dump completed on 2026-09-25\n')
            with self.assertRaises(preflight.PreflightError):
                preflight.require_dump(evidence, folder)
            dump.write_bytes(b'no completion marker\n')
            with self.assertRaises(preflight.PreflightError):
                preflight.dump_evidence(dump, folder)
            dump.write_bytes(b'-- Dump completed on 2026-09-24\nDROP TABLE test;\n')
            with self.assertRaises(preflight.PreflightError):
                preflight.dump_evidence(dump, folder)

    def test_admin_option_file_must_be_private_regular_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            option = Path(temporary) / 'mysql.cnf'
            option.write_text('[client]\nuser=example\n', encoding='utf-8')
            os.chmod(option, 0o600)
            self.assertEqual(preflight.private_option_file(option), option.resolve())
            if os.name == 'posix':
                os.chmod(option, 0o644)
                with self.assertRaises(preflight.PreflightError):
                    preflight.private_option_file(option)

    def test_mysql_option_file_rejects_command_specific_or_included_overrides(self):
        with tempfile.TemporaryDirectory() as temporary:
            option = Path(temporary) / 'mysql.cnf'
            for contents in ('[client]\nhost=localhost\n[mysql]\nhost=other\n',
                             '[client]\nhost=localhost\n[mysqldump]\nhost=other\n',
                             '[client]\n!include /tmp/other.cnf\n',
                             '[client]\ninit-command=DROP TABLE tactical\n'):
                with self.subTest(contents=contents):
                    option.write_text(contents, encoding='utf-8')
                    os.chmod(option, 0o600)
                    with self.assertRaises(preflight.PreflightError):
                        preflight.private_option_file(option)

    def test_rehearsal_evidence_is_bound_to_dump_and_clone_database(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            manifest = {'format': 1, 'dump': {'sha256': 'a' * 64},
                        'qa': {'database': 'evem_tactical_qa_123456789abc',
                               'dump_sha256': 'a' * 64, 'passed': True}}
            preflight.require_rehearsal(manifest)
            for qa in ({'database': 'production', 'dump_sha256': 'a' * 64, 'passed': True},
                       {'database': 'evem_tactical_qa_123456789abc', 'dump_sha256': 'b' * 64, 'passed': True},
                       {'database': 'evem_tactical_qa_123456789abc', 'dump_sha256': 'a' * 64, 'passed': False}):
                with self.subTest(qa=qa), self.assertRaises(preflight.PreflightError):
                    preflight.require_rehearsal({**manifest, 'qa': qa})

    def test_manifest_update_is_atomic_and_private(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            path = folder / 'backup.json'
            preflight.save_manifest(path, {'format': 1, 'qa': {'passed': True}})
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['qa']['passed'], True)
            if os.name == 'posix':
                self.assertEqual(path.stat().st_mode & 0o077, 0)

    def test_source_counts_are_pinned_to_known_production_baseline(self):
        snapshot = {'organizations': [{'id': 7, 'region_ids': [1], 'border_hops': 2,
                                       'scope_version': 3, 'reports': 3, 'forces': 4}],
                    'report_count': 3, 'force_count': 4}
        preflight.require_source_counts(snapshot)
        with self.assertRaises(preflight.PreflightError):
            preflight.require_source_counts({**snapshot, 'report_count': 2})

    def test_row_fingerprint_detects_changes_even_when_counts_match(self):
        original = [{'id': 1, 'people': 100}, {'id': 2, 'people': 50}]
        changed = [{'id': 1, 'people': 101}, {'id': 2, 'people': 50}]
        self.assertNotEqual(preflight.row_fingerprint(original), preflight.row_fingerprint(changed))

    def test_partial_0007_schema_or_non_innodb_source_is_rejected(self):
        preflight.require_unmigrated_schema([], [], ['InnoDB', 'InnoDB', 'InnoDB'])
        for tables, columns, engines in ((['TacticalCollaboration_board'], [], ['InnoDB'] * 3),
                                         ([], ['TacticalCollaboration_report.board_id'], ['InnoDB'] * 3),
                                         ([], [], ['InnoDB', 'MyISAM', 'InnoDB'])):
            with self.assertRaises(preflight.PreflightError):
                preflight.require_unmigrated_schema(tables, columns, engines)

    def test_full_consistent_dump_requires_all_source_tables_innodb(self):
        preflight.require_all_innodb([])
        with self.assertRaises(preflight.PreflightError):
            preflight.require_all_innodb([('legacy_table', 'MyISAM')])

    def test_source_events_require_a_separate_isolated_backup_plan(self):
        preflight.require_no_events([])
        with self.assertRaisesRegex(preflight.PreflightError, 'event'):
            preflight.require_no_events([('scheduled_tactical_refresh',)])

    def test_administrator_connection_also_refuses_hidden_source_events(self):
        cursor = mock.MagicMock()
        cursor.fetchone.side_effect = [('server-1', '8.0.37'), ('utf8mb4', 'utf8mb4_unicode_ci')]
        cursor.fetchall.side_effect = [
            [("GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'",)],
            [('scheduled_tactical_refresh',)],
        ]
        administrator = mock.MagicMock()
        administrator.cursor.return_value.__enter__.return_value = cursor
        mysql_module = SimpleNamespace(connect=mock.Mock(return_value=administrator))
        source = {'database': 'evem', 'server_uuid': 'server-1', 'version': '8.0.37',
                  'charset': 'utf8mb4', 'collation': 'utf8mb4_unicode_ci'}
        with (mock.patch.dict(sys.modules, {'MySQLdb': mysql_module}),
              mock.patch.object(preflight, 'private_option_file', return_value=Path('/private/admin.cnf'))):
            with self.assertRaisesRegex(preflight.PreflightError, 'event'):
                preflight.admin_server(Path('/private/admin.cnf'), source)

    def test_event_metadata_requires_direct_database_or_global_event_grant(self):
        preflight.require_event_visibility(
            [("GRANT ALL PRIVILEGES ON *.* TO 'root'@'localhost'",)], 'evem')
        preflight.require_event_visibility(
            [("GRANT SELECT, EVENT ON `evem`.* TO 'operator'@'localhost'",)], 'evem')
        preflight.require_event_visibility(
            [("GRANT EVENT ON `eve``pirate`.* TO 'operator'@'localhost'",)], 'eve`pirate')
        preflight.require_event_visibility(
            [("GRANT EVENT ON *.* TO 'operator'@'localhost'",)], 'evem')
        for grants in (
            [("GRANT SELECT ON *.* TO 'operator'@'localhost'",)],
            [("GRANT EVENT ON `different_db`.* TO 'operator'@'localhost'",)],
            [("GRANT `role_with_event`@`%` TO 'operator'@'localhost'",)],
            [("GRANT EVENT ON `evem` TO 'operator'@'localhost'",)],
            [("GRANT EVENT ON *.* TO 'operator'@'localhost'",),
             ("REVOKE EVENT ON `evem`.* FROM 'operator'@'localhost'",)],
        ):
            with self.subTest(grants=grants), self.assertRaisesRegex(preflight.PreflightError, 'EVENT'):
                preflight.require_event_visibility(grants, 'evem')

    def test_preflight_operator_must_be_root(self):
        preflight.require_root_operator(0)
        with self.assertRaisesRegex(preflight.PreflightError, 'root'):
            preflight.require_root_operator(1001)

    def test_candidate_code_must_be_root_owned_and_not_writable_by_other_users(self):
        preflight.require_root_controlled(SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=0))
        for metadata in (SimpleNamespace(st_mode=stat.S_IFREG | 0o664, st_uid=0),
                         SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=1001),
                         SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0)):
            with self.subTest(metadata=metadata), self.assertRaises(preflight.PreflightError):
                preflight.require_root_controlled(metadata)

    def test_pirate_visibility_index_requires_exact_columns_and_order(self):
        expected = [(1, 'board_id'), (2, 'author_id'), (3, 'status')]
        preflight.require_pirate_visibility_index(expected)
        for changed in ([(1, 'board_id'), (2, 'status'), (3, 'author_id')],
                        [(1, 'board_id'), (2, 'author_id'), (3, 'other')], expected[:2]):
            with self.subTest(changed=changed), self.assertRaises(preflight.PreflightError):
                preflight.require_pirate_visibility_index(changed)

    def test_clone_must_be_unique_schema_on_same_mysql_server_and_version(self):
        source = {'database': 'evem', 'server_uuid': 'abc', 'version': '8.0.37'}
        clone = {'database': 'evem_tactical_qa_123456789abc', 'server_uuid': 'abc', 'version': '8.0.37'}
        preflight.require_clone_identity(source, clone, clone['database'])
        for altered in ({**clone, 'database': 'evem'}, {**clone, 'server_uuid': 'other'},
                        {**clone, 'version': '8.0.36'}):
            with self.subTest(altered=altered), self.assertRaises(preflight.PreflightError):
                preflight.require_clone_identity(source, altered, clone['database'])

    def test_backfill_verification_requires_every_legacy_row_on_its_default_board(self):
        snapshot = {'organizations': [{'id': 7, 'region_ids': [1], 'border_hops': 2,
                                       'scope_version': 3, 'reports': 3, 'forces': 4}],
                    'report_count': 3, 'force_count': 4}
        board = {'id': 11, 'organization_id': 7, 'name': '战争沙盘', 'kind': 'war',
                 'is_default': True, 'region_ids': [1], 'border_hops': 2, 'scope_version': 3}
        reports = [(7, 11)] * 3
        forces = [(7, 11)] * 4
        preflight.verify_migration_data(snapshot, [board], reports, forces, 0)
        for changed_boards, changed_reports, changed_forces, changed_sightings in (
            ([{**board, 'scope_version': 4}], reports, forces, 0),
            ([board], [(7, None), *reports[1:]], forces, 0),
            ([board], reports, [(7, 12), *forces[1:]], 0),
            ([board], reports, forces, 1),
        ):
            with self.assertRaises(preflight.PreflightError):
                preflight.verify_migration_data(snapshot, changed_boards, changed_reports,
                                                changed_forces, changed_sightings)

    def test_backup_uses_private_file_and_does_not_record_failed_dump(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backups'
            root.mkdir()
            os.chmod(root, 0o700)
            options = Path(temporary) / 'mysql.cnf'
            options.write_text('[client]\nuser=operator\n', encoding='utf-8')
            os.chmod(options, 0o600)
            folder = root / 'run-1'
            with (mock.patch.object(preflight, 'admin_server'),
                  mock.patch.object(preflight.subprocess, 'run', return_value=mock.Mock(returncode=1)) as run):
                with self.assertRaises(preflight.PreflightError):
                    preflight.perform_backup(folder, root, options, 'evem', {'sha': 'a' * 40},
                                             {'database': 'evem'}, {'report_count': 3})
            self.assertFalse((folder / 'backup.json').exists())
            arguments = run.call_args.args[0]
            self.assertEqual(arguments[0], 'mysqldump')
            self.assertIn('--single-transaction', arguments)
            self.assertIn('--quick', arguments)
            self.assertTrue(arguments[1].startswith('--defaults-file='))
            self.assertFalse(any('password' in argument.lower() for argument in arguments))

    def test_backup_records_complete_dump_with_bound_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backups'
            root.mkdir()
            os.chmod(root, 0o700)
            options = Path(temporary) / 'mysql.cnf'
            options.write_text('[client]\nuser=operator\n', encoding='utf-8')
            os.chmod(options, 0o600)
            candidate, source, snapshot = {'sha': 'a' * 40}, {'database': 'evem'}, {'report_count': 3}

            def successful_dump(_args, *, stdout, **_kwargs):
                stdout.write(b'-- Dump completed on 2026-09-24\n')
                return mock.Mock(returncode=0)

            with (mock.patch.object(preflight, 'admin_server'),
                  mock.patch.object(preflight.os, 'open', wraps=os.open) as secure_open,
                  mock.patch.object(preflight.subprocess, 'run', side_effect=successful_dump)):
                result = preflight.perform_backup(root / 'run-2', root, options, 'evem',
                                                  candidate, source, snapshot)
            self.assertTrue(any(call.args[0] == root / 'run-2' / 'before-0007.sql' and
                                call.args[2] == 0o600 for call in secure_open.call_args_list))
            self.assertEqual(result['candidate'], candidate)
            self.assertEqual(result['source'], source)
            self.assertEqual(result['snapshot'], snapshot)
            preflight.require_dump(result['dump'], root / 'run-2')
            self.assertTrue((root / 'run-2' / 'backup.json').is_file())

    def test_backup_does_not_start_if_admin_options_point_elsewhere(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / 'backups'
            root.mkdir()
            option = Path(temporary) / 'mysql.cnf'
            option.write_text('[client]\nuser=operator\n', encoding='utf-8')
            os.chmod(option, 0o600)
            with (mock.patch.object(preflight, 'admin_server',
                                    side_effect=preflight.PreflightError('other server')),
                  mock.patch.object(preflight.subprocess, 'run') as run):
                with self.assertRaises(preflight.PreflightError):
                    preflight.perform_backup(root / 'run-3', root, option, 'evem',
                                             {'sha': 'a' * 40}, {'database': 'evem'}, {})
                run.assert_not_called()
            self.assertFalse((root / 'run-3').exists())

    def test_production_gate_requires_recent_backup_rehearsal_and_maintenance(self):
        now = datetime(2026, 9, 24, 10, tzinfo=timezone.utc)
        candidate = {'sha': 'a' * 40, 'migration_sha256': 'b' * 64}
        source = {'database': 'evem', 'server_uuid': 'server', 'version': '8.0.37'}
        snapshot = {'organizations': [], 'report_count': 3, 'force_count': 4}
        manifest = {'format': 1, 'candidate': candidate, 'source': source, 'snapshot': snapshot,
                    'created_at': (now - timedelta(hours=1)).isoformat(),
                    'dump': {'sha256': 'c' * 64},
                    'qa': {'database': 'evem_tactical_qa_123456789abc',
                           'dump_sha256': 'c' * 64, 'passed': True}}
        preflight.require_ready_to_migrate(manifest, candidate, source, snapshot, True, now)
        for altered, confirmed in ((manifest, False),
                                   ({**manifest, 'created_at': (now - timedelta(hours=25)).isoformat()}, True),
                                   ({**manifest, 'qa': None}, True)):
            with self.assertRaises(preflight.PreflightError):
                preflight.require_ready_to_migrate(altered, candidate, source, snapshot, confirmed, now)

    def test_restore_command_never_targets_production_and_verifies_dump_first(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            dump = folder / 'before-0007.sql'
            dump.write_bytes(b'-- Dump completed on 2026-09-24\n')
            os.chmod(dump, 0o600)
            evidence = preflight.dump_evidence(dump, folder)
            options = folder / 'mysql.cnf'
            options.write_text('[client]\nuser=operator\n', encoding='utf-8')
            os.chmod(options, 0o600)
            with mock.patch.object(preflight.subprocess, 'run', return_value=mock.Mock(returncode=0)) as run:
                with self.assertRaises(preflight.PreflightError):
                    preflight.restore_dump(evidence, folder, options, 'evem')
                run.assert_not_called()
                preflight.restore_dump(evidence, folder, options, 'evem_tactical_qa_123456789abc')
            self.assertEqual(run.call_args.args[0][-1], 'evem_tactical_qa_123456789abc')
            self.assertIn('--defaults-file=', run.call_args.args[0][1])

    def test_private_configured_env_is_parsed_as_literal_data_not_executed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backend = root / 'candidate-backend'
            backend.mkdir()
            environment = root / 'backend.env'
            environment.write_text('SECRET_KEY=local-test\nDB_NAME=evem\nDB_USER=operator\n'
                                   'DB_PASSWORD=$(never_execute)\nDB_HOST=localhost\nDB_PORT=3306\n',
                                   encoding='utf-8')
            config = root / 'config.json'
            config.write_text(json.dumps({'env_file': str(environment)}), encoding='utf-8')
            os.chmod(config, 0o640)
            os.chmod(environment, 0o640)
            values = preflight.load_private_environment(environment, config, backend)
            self.assertEqual(values['DB_PASSWORD'], '$(never_execute)')
            self.assertEqual(values['SECRET_KEY'], 'local-test')
            other = root / 'other.env'
            other.write_text('SECRET_KEY=other\n', encoding='utf-8')
            with self.assertRaises(preflight.PreflightError):
                preflight.load_private_environment(other, config, backend)
            if os.name == 'posix':
                os.chmod(environment, 0o644)
                with self.assertRaises(preflight.PreflightError):
                    preflight.load_private_environment(environment, config, backend)

    def test_controlled_env_must_define_every_default_database_field(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backend = root / 'candidate'
            backend.mkdir()
            environment = root / 'backend.env'
            environment.write_text('SECRET_KEY=local-test\nDB_NAME=evem\nDB_PASSWORD=secret\n', encoding='utf-8')
            config = root / 'config.json'
            config.write_text(json.dumps({'env_file': str(environment)}), encoding='utf-8')
            os.chmod(environment, 0o600)
            os.chmod(config, 0o600)
            with self.assertRaisesRegex(preflight.PreflightError, 'database'):
                preflight.load_private_environment(environment, config, backend)

    def test_django_default_connection_must_match_controlled_env(self):
        env = {'DB_NAME': 'evem', 'DB_USER': 'operator', 'DB_PASSWORD': 'secret',
               'DB_HOST': 'localhost', 'DB_PORT': '3306'}
        connection = SimpleNamespace(settings_dict={'NAME': 'evem', 'USER': 'operator',
                                                    'PASSWORD': 'secret', 'HOST': 'localhost', 'PORT': '3306'})
        preflight.require_source_connection_settings(connection, env)
        connection.settings_dict['HOST'] = 'other-server'
        with self.assertRaisesRegex(preflight.PreflightError, 'controlled'):
            preflight.require_source_connection_settings(connection, env)

    def test_rehearsal_rejects_changed_dump_before_creating_database(self):
        manifest = {'format': 1, 'candidate': {'sha': 'a' * 40},
                    'source': {'database': 'evem'}, 'snapshot': {'report_count': 3},
                    'dump': {'file': '/missing/before-0007.sql', 'sha256': 'b' * 64, 'size': 1}}
        with (mock.patch.object(preflight, 'inspect_source', return_value=(manifest['candidate'],
                                                                           manifest['source'], manifest['snapshot'])),
              mock.patch.object(preflight, 'create_qa_schema', create=True) as create):
            with self.assertRaises(preflight.PreflightError):
                preflight.perform_rehearsal(manifest, Path('/missing'), Path('/missing/admin.cnf'),
                                            mock.Mock(), Path('/candidate'))
            create.assert_not_called()

    def test_rehearsal_cannot_overwrite_previous_success(self):
        manifest = {'format': 1, 'candidate': {'sha': 'a' * 40},
                    'source': {'database': 'evem'}, 'snapshot': {'report_count': 3},
                    'dump': {'file': '/missing/before-0007.sql', 'sha256': 'b' * 64, 'size': 1},
                    'qa': {'passed': True}}
        with (mock.patch.object(preflight, 'inspect_source', return_value=(manifest['candidate'],
                                                                           manifest['source'], manifest['snapshot'])),
              mock.patch.object(preflight, 'require_dump'),
              mock.patch.object(preflight, 'admin_server'),
              mock.patch.object(preflight, 'create_qa_schema') as create):
            with self.assertRaises(preflight.PreflightError):
                preflight.perform_rehearsal(manifest, Path('/missing'), Path('/missing/admin.cnf'),
                                            mock.Mock(), Path('/candidate'))
            create.assert_not_called()

    def test_production_mode_cannot_apply_without_maintenance_confirmation(self):
        manifest = {'format': 1, 'candidate': {'sha': 'a' * 40},
                    'source': {'database': 'evem'}, 'snapshot': {'report_count': 3},
                    'created_at': datetime.now(timezone.utc).isoformat(),
                    'dump': {'file': '/missing/before-0007.sql', 'sha256': 'b' * 64, 'size': 1},
                    'qa': {'database': 'evem_tactical_qa_123456789abc',
                           'dump_sha256': 'b' * 64, 'passed': True}}
        with (mock.patch.object(preflight, 'inspect_source', return_value=(manifest['candidate'],
                                                                           manifest['source'], manifest['snapshot'])),
              mock.patch.object(preflight, 'apply_0007', create=True) as apply):
            with self.assertRaises(preflight.PreflightError):
                preflight.perform_production_migration(manifest, Path('/missing'), Path('/missing/admin.cnf'),
                                                       mock.Mock(), Path('/candidate'), False)
            apply.assert_not_called()


if __name__ == '__main__':
    unittest.main()
