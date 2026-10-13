from pathlib import Path
import tempfile
import os
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection
from django.test import TransactionTestCase, override_settings
from django.core.cache import cache
from rest_framework.test import APIClient
from StarFieldSearch.models import Region, Constellation, Solarsystem
from AnomalyHotspots.snapshot import write_success, write_failure
from Authentication.viewer_access import is_public_read_request


class APITests(TransactionTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        with connection.schema_editor() as editor:
            for model in (Region, Constellation, Solarsystem): editor.create_model(model)

    @classmethod
    def tearDownClass(cls):
        with connection.schema_editor() as editor:
            for model in (Solarsystem, Constellation, Region): editor.delete_model(model)
        super().tearDownClass()

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.directory = tempfile.TemporaryDirectory()
        self.path = Path(self.directory.name) / 'snapshot.json'
        if os.name == 'posix': self.path.parent.chmod(0o750)
        self.addCleanup(self.directory.cleanup)
        self.setting = override_settings(ANOMALY_SNAPSHOT_FILE=str(self.path))
        self.setting.enable()
        self.addCleanup(self.setting.disable)

    def test_sanitized_stored_snapshot_verified_metadata_unknown_preserved_no_rpc(self):
        Region.objects.create(r_id='10000001', r_title='德里克')
        Solarsystem.objects.create(ss_id='30000001', ss_title='星系甲', ss_region_id='10000001')
        write_success(self.path, [{'solar_system_id': 30000001, 'destroy_num': 20},
                                  {'solar_system_id': 99999999, 'destroy_num': 5}], now_ms=1000)
        with patch('Market.collector_protocol.socket.create_connection') as opened:
            response = self.client.get('/api/anomaly-hotspots/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['systems'], [
                {'solar_system_id': 30000001, 'destroy_num': 20, 'system_name': '星系甲',
                 'region_id': 10000001, 'region_name': '德里克'},
                {'solar_system_id': 99999999, 'destroy_num': 5, 'system_name': None,
                 'region_id': None, 'region_name': None}])
            self.assertEqual(response['Cache-Control'], 'no-store')
            self.assertIsNone(response.data['statistics_window'])
            opened.assert_not_called()
        write_failure(self.path, 'rate_limited', now_ms=2000)
        self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['collected_at_ms'], 1000)

    def test_missing_safe_unavailable_exact_read_boundary_public_switch_and_mutations(self):
        response = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['status'], 'unavailable')
        self.assertNotIn(str(self.path), str(response.data))
        self.assertTrue(is_public_read_request('/api/anomaly-hotspots/', 'HEAD'))
        self.assertFalse(is_public_read_request('/api/anomaly-hotspots/private/', 'GET'))
        self.assertFalse(is_public_read_request('/api/anomaly-hotspots/', 'POST'))
        with override_settings(PUBLIC_READ_ACCESS_ENABLED=False):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 403)
            self.client.force_authenticate(SimpleNamespace(is_authenticated=True, is_active=True, pk=1))
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 200)
        self.assertEqual(self.client.post('/api/anomaly-hotspots/', {}).status_code, 405)

    def test_throttle_and_metadata_database_failure_fail_safely(self):
        # DRF stores throttle rates on its class at import; patch that actual
        # configuration boundary rather than a cached override_settings value.
        with patch('rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES', {'anomaly_hotspots': '1/hour'}):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 200)
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 429)
