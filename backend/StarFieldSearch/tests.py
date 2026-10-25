from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from .models import Region, Constellation, Solarsystem


class BoundedDirectoryQueryTests(TestCase):
    @classmethod
    def setUpClass(cls):
        cls.fixture_models = (Region, Constellation, Solarsystem)
        with connection.schema_editor() as editor:
            for model in cls.fixture_models:
                editor.create_model(model)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            for model in reversed(cls.fixture_models):
                editor.delete_model(model)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        Region.objects.create(r_id='1', r_title='Region')
        Constellation.objects.create(co_id='2', co_region_id='1', co_title='Constellation')
        Solarsystem.objects.create(ss_id='3', ss_region_id='1', ss_constellation_id='2', ss_title='System')

    def test_invalid_csv_is_rejected_before_sql(self):
        for path, key in (('/api/constellations', 'regionID'), ('/api/solarsystem', 'constellationID')):
            for suffix in ('', f'?{key}=', f'?{key}=1,,2', f'?{key}=true', f'?{key}=0',
                           f'?{key}=-1', f'?{key}=1.0', f'?{key}=9223372036854775808',
                           f'?{key}=１', f'?{key}=1&{key}=2', f'?{key}=' + ','.join(['1'] * 101),
                           f'?{key}=' + '1' * 2001):
                with self.subTest(path=path, suffix=suffix[:80]):
                    with self.assertNumQueries(0):
                        response = self.client.get(path + suffix)
                    self.assertEqual(response.status_code, 400)

    def test_csv_ids_deduplicate_keep_plain_array_and_sql_limit(self):
        for path, key, identity, expected in (('/api/constellations', 'regionID', '1', 'co_id'),
                                              ('/api/solarsystem', 'constellationID', '2', 'ss_id')):
            with CaptureQueriesContext(connection) as queries:
                response = self.client.get(path, {key: ','.join([identity] * 100)})
            self.assertEqual(response.status_code, 200)
            self.assertIsInstance(response.data, list)
            self.assertEqual(len(response.data), 1)
            self.assertIn(expected, response.data[0])
            self.assertEqual(len(queries), 1)
            self.assertIn('LIMIT 10001', queries[0]['sql'])

    def test_child_directory_overflow_is_not_a_silent_partial_array(self):
        Constellation.objects.bulk_create([Constellation(co_id=str(index + 10), co_region_id='1') for index in range(10000)])
        response = self.client.get('/api/constellations', {'regionID': '1'})
        self.assertEqual(response.status_code, 400)
        self.assertIn('缩小', str(response.data))

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=False)
    def test_existing_public_permission_switch_is_preserved(self):
        self.assertEqual(self.client.get('/api/constellations', {'regionID': '1'}).status_code, 401)

    def test_invalid_jwt_is_not_ignored(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer invalid')
        self.assertEqual(self.client.get('/api/solarsystem', {'constellationID': '2'}).status_code, 401)
