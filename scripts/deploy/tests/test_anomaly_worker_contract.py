"""Offline packaging/scheduler/CI contracts, no live resources."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]


class AnomalyWorkerContractTests(unittest.TestCase):
    def test_isolated_worker_no_db_no_session_output_shared_lock_and_random_timer(self):
        unit = ROOT / 'scripts/deploy/evem-anomaly-collector.service.example'
        timer = ROOT / 'scripts/deploy/evem-anomaly-collector.timer.example'
        runner = ROOT / 'backend/AnomalyHotspots/run-collector.sh'
        settings = ROOT / 'backend/EVE_MDjango/anomaly_worker_settings.py'
        for path in (unit, timer, runner, settings): self.assertTrue(path.exists(), 'anomaly worker contract missing')
        self.assertIn('User=evem-killboard', unit.read_text())
        self.assertIn('shared/anomaly/collector.env', unit.read_text())
        self.assertNotIn('provision/database.env', unit.read_text())
        self.assertIn('/var/lib/evem-killboard', unit.read_text())
        self.assertIn('collector.lock', unit.read_text())
        self.assertIn('flock --nonblock /EVEMTK/deploy/shared/killboard/collector.lock', runner.read_text())
        self.assertIn('anomaly_collect', runner.read_text())
        self.assertIn('EVE_MDjango.anomaly_worker_settings', runner.read_text())
        self.assertIn('OnUnitActiveSec=5min', timer.read_text())
        self.assertIn('RandomizedDelaySec=5min', timer.read_text())
        self.assertNotIn('KILLBOARD_DB_', settings.read_text())
        self.assertNotIn('EVE_MDjango.settings', settings.read_text())

    def test_ci_executes_anomaly_app_and_offline_capture_suites(self):
        ci = (ROOT / '.github/workflows/ci.yml').read_text()
        self.assertIn('test AnomalyHotspots --settings=EVE_MDjango.anomaly_test_settings', ci)
        self.assertIn('discover -s scripts/anomaly_hotspots/tests', ci)
