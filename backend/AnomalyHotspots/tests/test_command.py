import io
import os
from pathlib import Path
import tempfile
from unittest.mock import patch

from django.core.management import call_command, get_commands
from django.test import SimpleTestCase, override_settings
from AnomalyHotspots.tests.test_core import bundle
from AnomalyHotspots.session_bundle import save_session
from AnomalyHotspots.snapshot import read_snapshot
from Killboard.collector_transport import CollectorError


class CommandTests(SimpleTestCase):
    def test_worker_success_and_failure_preserve_rows_and_safe_journal(self):
        self.assertIn('anomaly_collect', get_commands(), 'command missing')
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            private, snapshot = parent / 'private.json', parent / 'snapshot.json'
            save_session(bundle(), private)
            if os.name == 'posix': parent.chmod(0o750)
            output = io.StringIO()
            with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)), patch.dict(os.environ, {'ANOMALY_SESSION_FILE': str(private)}):
                with patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', return_value=[{'solar_system_id': 1, 'destroy_num': 5}]):
                    call_command('anomaly_collect', stdout=output)
                good = read_snapshot(snapshot)
                self.assertEqual(good['status'], 'ok')
                with patch('AnomalyHotspots.management.commands.anomaly_collect.collect_once', side_effect=CollectorError('rate_limited')):
                    call_command('anomaly_collect', stdout=output)
                failed = read_snapshot(snapshot)
                self.assertEqual(failed['systems'], good['systems'])
                self.assertEqual(failed['collected_at_ms'], good['collected_at_ms'])
                self.assertEqual(failed['status'], 'rate_limited')
                self.assertNotIn(str(private), output.getvalue())
                self.assertNotIn('opaque', output.getvalue())
