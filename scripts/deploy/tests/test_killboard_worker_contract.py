"""Offline deployment contracts; no sessions, database or server contacted."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import MagicMock, Mock, patch
import tempfile
import os
import stat
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[3]


class WorkerContractTests(unittest.TestCase):
    def test_recovery_environment_directory_is_durable_before_account_creation(self):
        spec = importlib.util.spec_from_file_location('kb_provision_durable', ROOT/'scripts/deploy/killboard_mysql_worker_provision.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        events = []
        admin, worker = MagicMock(), MagicMock()
        cursor = admin.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [(table, 'BASE TABLE') for table in module.GRANTS]
        cursor.execute.side_effect = lambda sql, *args: events.append('create' if sql.startswith('CREATE USER') else 'sql')
        original_open, original_close, original_fsync = os.open, os.close, os.fsync
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary).resolve()
            def opened(path, flags, *args, **kwargs):
                if Path(path) == directory:
                    events.append('directory_open')
                    return 987654
                return original_open(path, flags, *args, **kwargs)
            def synced(fd):
                if fd == 987654:
                    events.append('directory_fsync')
                else:
                    original_fsync(fd)
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)), \
                 patch.object(module.os, 'geteuid', return_value=0, create=True), \
                 patch.object(module.os, 'open', side_effect=opened), \
                 patch.object(module.os, 'close', side_effect=lambda fd: None if fd == 987654 else original_close(fd)), \
                 patch.object(module.os, 'fsync', side_effect=synced), \
                 patch.object(module.shared, '_open_loopback', side_effect=[admin, worker]), \
                 patch.object(module.shared, 'verify_local_target', return_value='verified-server'), \
                 patch.object(module.shared, '_verify_worker_login'):
                module.provision(Mock(), directory)
            self.assertIn('directory_fsync', events)
            self.assertLess(events.index('directory_fsync'), events.index('create'))
            self.assertTrue((directory/'database.env').is_file())
        admin.close.assert_called_once()
        worker.close.assert_called_once()

    def test_only_killboard_tables_receive_dml_never_ddl_or_global_grants(self):
        spec = importlib.util.spec_from_file_location('kb_provision', ROOT/'scripts/deploy/killboard_mysql_worker_provision.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertEqual(len(module.GRANTS), 8)
        for table, privileges in module.GRANTS.items():
            self.assertTrue(table.startswith('Killboard_'))
            self.assertLessEqual(set(privileges.split(', ')), {'SELECT', 'INSERT', 'UPDATE', 'DELETE'})

    def test_unit_uses_packaged_runner_isolated_settings_and_start_to_start_timer(self):
        unit = (ROOT/'scripts/deploy/evem-killboard-collector.service.example').read_text()
        timer = (ROOT/'scripts/deploy/evem-killboard-collector.timer.example').read_text()
        runner = (ROOT/'backend/Killboard/run-collector.sh').read_text()
        self.assertIn('current/backend/Killboard/run-collector.sh', unit)
        self.assertIn('shared/market-python', unit)
        self.assertIn('ReadWriteDirectories=/EVEMTK/deploy/shared/killboard/collector.lock', unit)
        self.assertIn('KILLBOARD_SESSION_CURSOR_FILE=/EVEMTK/deploy/shared/killboard/session-cursor.json', unit)
        self.assertIn('ReadWriteDirectories=/EVEMTK/deploy/shared/killboard/collector.lock /EVEMTK/deploy/shared/killboard/session-cursor.json', unit)
        self.assertNotIn('ReadWritePaths=', unit)
        self.assertIn('EVE_MDjango.killboard_worker_settings', runner)
        self.assertIn('--max-seconds 210', runner)
        self.assertIn('--rpc-jitter 3', runner)
        self.assertIn('OnUnitActiveSec=10min', timer)
        self.assertIn('RandomizedDelaySec=1min', timer)
        self.assertIn('killboard_collect', runner)
        self.assertNotIn('OnUnitInactiveSec', timer)
