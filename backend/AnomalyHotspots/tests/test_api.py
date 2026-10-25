from pathlib import Path
import json
import tempfile
import os
import threading
from unittest import skipUnless
from types import SimpleNamespace
from unittest.mock import patch

from django.db import connection, DatabaseError
from django.test import TransactionTestCase, override_settings
from django.core.cache import cache
from rest_framework.test import APIClient
from StarFieldSearch.models import Region, Constellation, Solarsystem
from AnomalyHotspots.snapshot import MAX_SNAPSHOT_BYTES, read_snapshot, write_success, write_failure
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
        # TransactionTestCase does not flush managed=False fixture tables.
        for model in (Solarsystem, Constellation, Region): model.objects.all().delete()
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
        # An actual v1 fixture remains unclassified, including the small value 5.
        self.path.write_text(json.dumps({'version': 1, 'collected_at_ms': 1000,
            'last_attempt_at_ms': 1000, 'status': 'ok', 'statistics_window': None,
            'systems': [{'solar_system_id': 30000001, 'destroy_num': 20},
                        {'solar_system_id': 99999999, 'destroy_num': 5}]}))
        if os.name == 'posix': self.path.chmod(0o640)
        original = self.path.read_bytes()
        with patch('Market.collector_protocol.socket.create_connection') as opened:
            response = self.client.get('/api/anomaly-hotspots/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data['systems'], [
                {'solar_system_id': 30000001, 'destroy_num': 20, 'system_name': '星系甲',
                 'region_id': 10000001, 'region_name': '德里克'},
                {'solar_system_id': 99999999, 'destroy_num': 5, 'system_name': None,
                 'region_id': None, 'region_name': None}])
            self.assertEqual(response['Cache-Control'], 'no-store')
            self.assertEqual(response.data['version'], 2)
            self.assertEqual(response.data['metric'], {'kind': 'legacy_unclassified', 'range_version': None})
            self.assertIsNone(response.data['statistics_window'])
            opened.assert_not_called()
        self.assertEqual(self.path.read_bytes(), original)
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

    def test_throttle_enforces_the_configured_scope(self):
        # DRF stores throttle rates on its class at import; patch that actual
        # configuration boundary rather than a cached override_settings value.
        with patch('rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES', {'anomaly_hotspots': '1/hour'}):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 200)
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 429)

    def test_metadata_database_failure_preserves_nonempty_counts_time_and_hides_error(self):
        self.path.write_text(json.dumps({'version': 1, 'collected_at_ms': 1000,
            'last_attempt_at_ms': 1000, 'status': 'ok', 'statistics_window': None,
            'systems': [{'solar_system_id': 30001211, 'destroy_num': 155}]}))
        if os.name == 'posix': self.path.chmod(0o640)
        with patch('StarFieldSearch.models.Solarsystem.objects.filter', side_effect=DatabaseError('PRIVATE_DATABASE_PASSWORD_MARKER')):
            response = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['collected_at_ms'], 1000)
        self.assertEqual(response.data['last_attempt_at_ms'], 1000)
        self.assertEqual(response.data['status'], 'ok')
        self.assertEqual(response.data['systems'], [{'solar_system_id': 30001211, 'destroy_num': 155,
                                                    'system_name': None, 'region_id': None, 'region_name': None}])
        self.assertNotIn('PRIVATE_DATABASE_PASSWORD_MARKER', response.content.decode())

    def test_current_stored_snapshot_has_explicit_activity_contract(self):
        write_success(self.path, [{'solar_system_id': 30001211, 'destroy_num': 5}], now_ms=1000)
        response = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['version'], 2)
        self.assertEqual(response.data['metric'], {'kind': 'activity_level', 'range_version': 1})
        self.assertEqual(response.data['systems'][0]['destroy_num'], 5)
        self.assertIsNone(response.data['statistics_window'])
        self.assertEqual(response['Cache-Control'], 'no-store')

    def test_unchanged_snapshot_reuses_geography_without_sql(self):
        Region.objects.create(r_id='10000001', r_title='德里克')
        Solarsystem.objects.create(ss_id='30000001', ss_title='星系甲', ss_region_id='10000001')
        write_success(self.path, [{'solar_system_id': 30000001, 'destroy_num': 3}], now_ms=1000)
        with self.assertNumQueries(2):
            first = self.client.get('/api/anomaly-hotspots/')
        with self.assertNumQueries(0):
            second = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(first.status_code, 200)
        self.assertEqual(second.data, first.data)
        self.assertEqual(second['Cache-Control'], 'no-store')

    def _known_snapshot(self):
        Region.objects.create(r_id='10000001', r_title='德里克')
        Solarsystem.objects.create(ss_id='30000001', ss_title='星系甲', ss_region_id='10000001')
        write_success(self.path, [{'solar_system_id': 30000001, 'destroy_num': 3}], now_ms=1000)

    def test_snapshot_content_status_attempt_and_metric_changes_are_immediate(self):
        self._known_snapshot()
        first = self.client.get('/api/anomaly-hotspots/').data
        write_success(self.path, [{'solar_system_id': 30000001, 'destroy_num': 4}], now_ms=1000)
        changed = self.client.get('/api/anomaly-hotspots/').data
        self.assertEqual(changed['collected_at_ms'], first['collected_at_ms'])
        self.assertEqual(changed['systems'][0]['destroy_num'], 4)
        write_failure(self.path, 'rate_limited', now_ms=2000)
        failed = self.client.get('/api/anomaly-hotspots/').data
        self.assertEqual(failed['status'], 'rate_limited')
        self.assertEqual(failed['last_attempt_at_ms'], 2000)
        write_failure(self.path, 'rate_limited', now_ms=3000)
        self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['last_attempt_at_ms'], 3000)
        value = read_snapshot(self.path)
        value['metric'] = {'kind': 'legacy_unclassified', 'range_version': None}
        self.path.write_text(json.dumps(value))
        self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['metric'], value['metric'])

    def test_different_path_refreshes_even_identical_snapshot_and_only_one_entry_is_kept(self):
        self._known_snapshot()
        alternate = self.path.parent / 'alternate.json'
        alternate.write_bytes(self.path.read_bytes())
        if os.name == 'posix': alternate.chmod(0o640)
        self.client.get('/api/anomaly-hotspots/')
        Solarsystem.objects.filter(ss_id='30000001').update(ss_title='新名称')
        with override_settings(ANOMALY_SNAPSHOT_FILE=str(alternate)), self.assertNumQueries(2):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['systems'][0]['system_name'], '新名称')
        with self.assertNumQueries(2):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['systems'][0]['system_name'], '新名称')

    def test_geography_refreshes_at_sixty_seconds_not_before(self):
        self._known_snapshot()
        with patch('time.monotonic', return_value=100):
            original = self.client.get('/api/anomaly-hotspots/').data
        Solarsystem.objects.filter(ss_id='30000001').update(ss_title='新名称')
        Region.objects.filter(r_id='10000001').update(r_title='新星域')
        with patch('time.monotonic', return_value=159.999), self.assertNumQueries(0):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').data, original)
        with patch('time.monotonic', return_value=160), self.assertNumQueries(2):
            refreshed = self.client.get('/api/anomaly-hotspots/').data
        self.assertEqual(refreshed['systems'][0]['system_name'], '新名称')
        self.assertEqual(refreshed['systems'][0]['region_name'], '新星域')

    def test_monotonic_regression_refreshes_instead_of_extending_cache(self):
        self._known_snapshot()
        with patch('time.monotonic', return_value=100):
            self.client.get('/api/anomaly-hotspots/')
        Solarsystem.objects.filter(ss_id='30000001').update(ss_title='新名称')
        with patch('time.monotonic', return_value=99), self.assertNumQueries(2):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['systems'][0]['system_name'], '新名称')

    def test_metadata_failure_is_not_cached_and_private_wrapper_remains_compatible(self):
        from AnomalyHotspots.views import system_metadata
        self._known_snapshot()
        with patch('StarFieldSearch.models.Solarsystem.objects.filter', side_effect=DatabaseError('PRIVATE')):
            response = self.client.get('/api/anomaly-hotspots/')
            self.assertEqual(system_metadata([{'solar_system_id': 30000001}]), {})
        self.assertIsNone(response.data['systems'][0]['system_name'])
        with self.assertNumQueries(2):
            recovered = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(recovered.data['systems'][0]['system_name'], '星系甲')
        self.assertNotIn('PRIVATE', response.content.decode())

    def test_mutating_response_never_changes_cached_snapshot_or_projection(self):
        self._known_snapshot()
        first = self.client.get('/api/anomaly-hotspots/')
        first.data['metric']['kind'] = 'corrupted'
        first.data['systems'][0]['destroy_num'] = 500
        first.data['systems'][0]['system_name'] = 'corrupted'
        with self.assertNumQueries(0):
            second = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(second.data['metric']['kind'], 'activity_level')
        self.assertEqual(second.data['systems'][0]['destroy_num'], 3)
        self.assertEqual(second.data['systems'][0]['system_name'], '星系甲')

    def test_warm_projection_never_masks_missing_corrupt_or_oversized_snapshot(self):
        self._known_snapshot()
        original = self.path.read_bytes()
        for encoded in (None, b'{bad', b'{"version":2,"version":2}', b'x' * (MAX_SNAPSHOT_BYTES + 1)):
            with self.subTest(problem='missing' if encoded is None else len(encoded)):
                self.path.write_bytes(original)
                if os.name == 'posix': self.path.chmod(0o640)
                self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['status'], 'ok')
                if encoded is None: self.path.unlink()
                else: self.path.write_bytes(encoded)
                with self.assertNumQueries(0):
                    result = self.client.get('/api/anomaly-hotspots/')
                self.assertEqual(result.data['status'], 'unavailable')
                self.assertEqual(result.data['systems'], [])
                self.assertNotIn(str(self.path), result.content.decode())

    @skipUnless(os.name == 'posix', 'POSIX file safety contract')
    def test_warm_projection_never_masks_permission_or_link_changes(self):
        self._known_snapshot()
        self.client.get('/api/anomaly-hotspots/')
        self.path.chmod(0o644)
        self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['status'], 'unavailable')
        self.path.chmod(0o640)
        self.client.get('/api/anomaly-hotspots/')
        target = self.path.parent / 'original.json'
        self.path.rename(target)
        self.path.symlink_to(target)
        self.assertEqual(self.client.get('/api/anomaly-hotspots/').data['status'], 'unavailable')

    def test_warm_projection_still_runs_public_access_and_throttle_guards(self):
        self._known_snapshot()
        self.client.get('/api/anomaly-hotspots/')
        with override_settings(PUBLIC_READ_ACCESS_ENABLED=False):
            with patch('AnomalyHotspots.views.read_snapshot', side_effect=AssertionError('denied before read')):
                self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 403)
        cache.clear()
        with patch('rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES', {'anomaly_hotspots': '1/hour'}):
            self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 200)
            with patch('AnomalyHotspots.views.read_snapshot', side_effect=AssertionError('throttled before read')):
                self.assertEqual(self.client.get('/api/anomaly-hotspots/').status_code, 429)

    def test_concurrent_cold_publications_do_not_mix_snapshots_or_hold_lock_during_io(self):
        from AnomalyHotspots import views
        self._known_snapshot()
        alternate = self.path.parent / 'alternate.json'
        write_success(alternate, [{'solar_system_id': 30000002, 'destroy_num': 5}], now_ms=2000)
        entered, resume = threading.Event(), threading.Event()
        results, errors = {}, []
        original_read = views.read_snapshot

        def assert_unlocked():
            acquired = views._projection_lock.acquire(blocking=False)
            self.assertTrue(acquired, 'cache lock must not surround file or DB I/O')
            if acquired: views._projection_lock.release()

        def read(path):
            assert_unlocked()
            return original_read(path)

        def metadata(rows):
            assert_unlocked()
            identifier = rows[0]['solar_system_id']
            if identifier == 30000001:
                entered.set()
                self.assertTrue(resume.wait(5), 'second cold read did not release first')
            return {identifier: {'system_name': str(identifier), 'region_id': None, 'region_name': None}}

        def first_read():
            try: results['first'] = views.public_projection(self.path)
            except BaseException as error: errors.append(error)

        with patch.object(views, 'read_snapshot', side_effect=read), patch.object(
                views, '_load_system_metadata', side_effect=metadata):
            worker = threading.Thread(target=first_read, daemon=True)
            worker.start()
            try:
                self.assertTrue(entered.wait(5), 'first cold read did not reach metadata')
                results['second'] = views.public_projection(alternate)
            finally:
                resume.set()
                worker.join(5)
            self.assertFalse(worker.is_alive())
            self.assertEqual(errors, [])
            # A late old entry may require another lookup, but cannot match B.
            results['second_again'] = views.public_projection(alternate)
        self.assertEqual(results['first']['systems'][0]['solar_system_id'], 30000001)
        self.assertEqual(results['first']['systems'][0]['system_name'], '30000001')
        self.assertEqual(results['second']['systems'][0]['solar_system_id'], 30000002)
        self.assertEqual(results['second']['systems'][0]['system_name'], '30000002')
        self.assertEqual(results['second_again'], results['second'])
