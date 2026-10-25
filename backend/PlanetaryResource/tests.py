from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory, force_authenticate

from Authentication.throttle import DailyThrottle, MinuteThrottle
from PlanetaryResource.views import PlResourcePriceList

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from PlanetaryResource.models import PlanetResource, PreSearchPlanetary
from PlanetaryResource.planetDBmap import RESOURCE_FIELD_MAP
from StarFieldSearch.models import Region, Constellation, Solarsystem


class PlanetaryThrottleTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    def test_email_throttle_skips_list_payloads(self):
        request = self.factory.post(
            '/api/planetresourceprice',
            [{'resource_name': '光泽合金', 'resource_price': 1500}],
            format='json',
        )

        self.assertIsNone(DailyThrottle().get_cache_key(request, None))
        self.assertIsNone(MinuteThrottle().get_cache_key(request, None))


class PlanetaryPriceSaveTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()
        self.user = SimpleNamespace(id=1, username='atlas123', is_authenticated=True)

    @patch('PlanetaryResource.views.UserPrePrice.objects.update_or_create')
    def test_price_save_accepts_wrapped_price_list(self, update_or_create_mock):
        payload = {
            'prePriceElement': [
                {
                    'resource_name': '光泽合金',
                    'resource_type': '船菜',
                    'resource_price': 1500,
                }
            ]
        }
        request = self.factory.post('/api/planetresourceprice', payload, format='json')
        force_authenticate(request, user=self.user)

        response = PlResourcePriceList.as_view()(request)

        self.assertEqual(response.status_code, 200)
        update_or_create_mock.assert_called_once()
        kwargs = update_or_create_mock.call_args.kwargs
        self.assertEqual(kwargs['user_id'], 1)
        self.assertEqual(kwargs['defaults']['user_name'], 'atlas123')
        self.assertEqual(kwargs['defaults']['pre_price_element'], payload['prePriceElement'])
        self.assertIsNotNone(kwargs['defaults']['last_update'])


@override_settings(STATIC_URL='/static/')
class BoundedPlanetaryQueryTests(TestCase):
    """Real legacy tables exist only inside the isolated SQLite test database."""

    @classmethod
    def setUpClass(cls):
        cls.fixture_models = (Region, Constellation, Solarsystem, PlanetResource, PreSearchPlanetary)
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
        Region.objects.create(r_id='1', r_title='Region', r_safetylvl='0.1')
        Constellation.objects.create(co_id='2', co_region_id='1', co_title='Constellation', co_safetylvl='0.2')
        Solarsystem.objects.create(ss_id='3', ss_region_id='1', ss_constellation_id='2', ss_title='System', ss_safetylvl='0.3')

    def tearDown(self):
        cache.clear()

    def post(self, data, **extra):
        return self.client.post('/api/searchplanetresource', data, format='json', **extra)

    def planet(self, name='planet', **fields):
        return PlanetResource(p_region_id='1', p_constellation_id='2', p_solarsystem_id='3',
                              p_title=name, p_gz='丰富', p_gz_cnt='10', **fields)

    def pre(self, name='pre', resource='光泽合金', amount=10):
        return PreSearchPlanetary(region_id='1', constellation_id='2', solar_system_id='3',
            region_ps_name='Region', constellation_ps_name='Constellation', solar_system_ps_name='System',
            planet_id=name, resource_level=3, resource_yield=amount, resource_name=resource)

    def test_unknown_resource_is_rejected_before_database_work(self):
        with self.assertNumQueries(0):
            response = self.post({'planetaryResources': [{'value': 'not-a-server-resource', 'icon': 'https://untrusted.invalid/'}]})
        self.assertEqual(response.status_code, 400)

    def test_raw_location_limit_is_checked_before_duplicate_collapse(self):
        with self.assertNumQueries(0):
            response = self.post({'systemValue': ['3'] * 101})
        self.assertEqual(response.status_code, 400)

    def test_raw_resource_limit_is_checked_before_duplicate_collapse(self):
        with self.assertNumQueries(0):
            response = self.post({'planetaryResources': [{'value': '光泽合金'}] * 35})
        self.assertEqual(response.status_code, 400)

    def test_payload_and_array_types_are_validated_before_database_work(self):
        for data in ([], 'bad', {'regionValue': '1'}, {'systemValue': {}},
                     {'constellationValue': None}, {'planetaryResources': '光泽合金'},
                     {'planetaryResources': [None]}, {'planetaryResources': [{'value': 1}]}):
            with self.subTest(data=data):
                cache.clear()
                with self.assertNumQueries(0):
                    response = self.post(data)
                self.assertEqual(response.status_code, 400)

    def test_invalid_ids_are_rejected_before_database_work(self):
        for value in (True, False, 1.0, 0, -1, '', '0', '-1', '１', '1.0', '1e2', ' 3 ', [], {},
                      '9223372036854775808', '9' * 200):
            with self.subTest(value=value):
                cache.clear()
                with self.assertNumQueries(0):
                    response = self.post({'systemValue': [value]})
                self.assertEqual(response.status_code, 400)

    def test_valid_ids_resource_display_fields_and_duplicates_preserve_first_match(self):
        item = self.planet(p_gc='丰富', p_gc_cnt='20')
        item.save()
        payload = {'systemValue': [3, '3'], 'planetaryResources': [
            {'value': '光彩合金', 'label': 'ignored', 'group': '船菜', 'icon': 'https://untrusted.invalid/'},
            {'value': '光彩合金'}, {'value': '光泽合金'}]}
        with CaptureQueriesContext(connection) as queries:
            response = self.post(payload)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 1)
        self.assertEqual(response.data[0]['resource_name'], '光彩合金')
        self.assertEqual(response.data[0]['resource_yield'], '20')
        self.assertEqual(response.data[0]['icon'], 'http://testserver/static/planet-nobg/GlossyColor-Alloys.png')
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 5001', queries[0]['sql'])

    def test_top_three_is_numeric_and_keeps_original_serialized_yields(self):
        for index, amount in enumerate(['9', '8', '7', '100', '10']):
            item = self.planet(str(index))
            item.p_gz_cnt = amount
            item.save()
        response = self.post({'constellationValue': ['2']})
        self.assertEqual(response.status_code, 200)
        rows = [row for row in response.data if row['resource_name'] == '光泽合金']
        self.assertEqual([row['resource_yield'] for row in rows], ['100', '10', '9'])

    def test_numeric_ranking_skips_bad_values_not_valid_zero(self):
        for index, amount in enumerate(['NaN', 'Infinity', '-1', 'bad', '', None, '0', '2.5', '2.5', '1e309']):
            item = self.planet(str(index))
            item.p_gz_cnt = amount
            item.save()
        response = self.post({'systemValue': ['3']})
        self.assertEqual(response.status_code, 200)
        rows = [row for row in response.data if row['resource_name'] == '光泽合金']
        self.assertEqual([row['resource_yield'] for row in rows], ['2.5', '2.5', '0'])
        self.assertEqual([row['planet_id'] for row in rows], ['7', '8', '6'])

    def test_more_specific_location_does_not_expand_to_upper_region_precomputed_rows(self):
        self.pre('too-broad').save()
        self.planet('specific').save()
        response = self.post({'regionValue': ['1'], 'systemValue': ['3']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['planet_id'] for row in response.data], ['specific'])

    def test_exact_candidate_cap_succeeds_and_cap_plus_one_rejects_without_partial_ranking(self):
        PlanetResource.objects.bulk_create([self.planet(str(index)) for index in range(5000)])
        with CaptureQueriesContext(connection) as queries:
            response = self.post({'constellationValue': ['2']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 3)
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 5001', queries[0]['sql'])
        self.planet('overflow').save()
        response = self.post({'systemValue': ['3'], 'planetaryResources': [{'value': '光泽合金'}]})
        self.assertEqual(response.status_code, 400)
        self.assertIn('缩小', str(response.data))

    def test_global_precomputed_total_cap_and_cap_plus_one_are_not_silent_partial_results(self):
        PreSearchPlanetary.objects.bulk_create([self.pre(str(index), '光泽合金') for index in range(5000)]
            + [self.pre('s' + str(index), '光彩合金') for index in range(5000)])
        data = {'planetaryResources': [{'value': '光泽合金'}, {'value': '光彩合金'}]}
        with CaptureQueriesContext(connection) as queries:
            response = self.post(data)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data), 10000)
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 10001', queries[0]['sql'])
        self.pre('overflow', '光彩合金').save()
        response = self.post(data)
        self.assertEqual(response.status_code, 400)
        self.assertIn('缩小', str(response.data))

    def test_region_precomputed_read_is_bounded_and_uses_server_icon(self):
        self.pre().save()
        with CaptureQueriesContext(connection) as queries:
            response = self.post({'regionValue': ['1']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]['icon'], 'http://testserver/static/planet-nobg/Glossy-Alloys.png')
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 10001', queries[0]['sql'])

    def test_empty_selection_does_no_sql_and_array_input_caps_are_inclusive(self):
        with self.assertNumQueries(0):
            response = self.post({})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, [])
        response = self.post({'systemValue': ['3'] * 100,
                              'planetaryResources': [{'value': name} for name in RESOURCE_FIELD_MAP]})
        self.assertEqual(response.status_code, 200)

    def test_global_precomputed_maxima_and_ties_keep_array_contract(self):
        PreSearchPlanetary.objects.bulk_create([self.pre('low', amount=9), self.pre('a', amount=10), self.pre('b', amount=10)])
        response = self.post({'planetaryResources': [{'value': '光泽合金'}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['planet_id'] for row in response.data], ['a', 'b'])
        self.assertEqual([row['resource_yield'] for row in response.data], [10.0, 10.0])

    def test_global_numeric_maxima_ignore_invalid_values_and_preserve_resource_order(self):
        PreSearchPlanetary.objects.bulk_create([
            self.pre('first', '光泽合金', 10), self.pre('bad', '光泽合金', float('inf')),
            self.pre('second', '光彩合金', 12), self.pre('negative', '光彩合金', -1),
            self.pre('tie', '光泽合金', 10), self.pre('null', '光彩合金', None),
        ])
        with CaptureQueriesContext(connection) as queries:
            response = self.post({'planetaryResources': [{'value': '光彩合金'}, {'value': '光泽合金'}]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['planet_id'] for row in response.data], ['second', 'first', 'tie'])
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 10001', queries[0]['sql'])

    def test_real_read_budget_cannot_be_reset_by_supplied_email_or_forwarded_header(self):
        for _ in range(30):
            self.assertEqual(self.post({}).status_code, 200)
        with self.assertNumQueries(0):
            response = self.post({'email': 'change@example.com'}, HTTP_X_FORWARDED_FOR='203.0.113.8')
        self.assertEqual(response.status_code, 429)
        self.assertIn('Retry-After', response)

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=False)
    def test_closed_public_switch_requires_authentication(self):
        self.assertEqual(self.post({}).status_code, 401)

    def test_invalid_jwt_is_not_ignored_on_public_query(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer invalid')
        self.assertEqual(self.post({}).status_code, 401)
