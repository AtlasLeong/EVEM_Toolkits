"""Bounded legacy chart reads against disposable unmanaged SQLite tables."""

import json
from datetime import date, timedelta

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from .models import BazaarRank


class BazaarChartBoundaryTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with connection.schema_editor() as editor:
            editor.create_model(BazaarRank)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            editor.delete_model(BazaarRank)

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        # Malformed requests must be a controlled 400, not an exception/500.
        self.client.raise_request_exception = False

    def tearDown(self):
        cache.clear()

    @staticmethod
    def series(name='Test bazaar', server='China', rank=5):
        return {'bazaarName': name, 'server': server, 'rank': rank}

    @staticmethod
    def history(name='Test bazaar', server='China', rank=5, count=2):
        BazaarRank.objects.bulk_create([
            BazaarRank(bazaar_name=name, server=server, rank=rank,
                       date=date(2025, 1, 1) + timedelta(days=index), score=100 + index)
            for index in range(count)
        ])

    def post(self, data, **extra):
        return self.client.post('/api/bazaarchart', json.dumps(data).encode('ascii'),
                                content_type='application/json', **extra)

    def test_normal_five_series_keep_order_nested_arrays_and_day_labels(self):
        requests = [self.series(rank=rank) for rank in (20, 5, 50, 1, 2)]
        for request in requests:
            self.history(rank=request['rank'])
        with self.assertNumQueries(1):
            response = self.post(requests)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 5)
        for rank, values in zip((20, 5, 50, 1, 2), response.json()):
            self.assertEqual(values, [
                {f'Test bazaar国服第{rank}名': 100, 'date': '第1日'},
                {f'Test bazaar国服第{rank}名': 101, 'date': '第2日'},
            ])

    def test_eight_series_succeed_with_one_bounded_stably_ordered_query(self):
        for rank in range(1, 9):
            self.history(rank=rank, count=1)
        with CaptureQueriesContext(connection) as queries:
            response = self.post([self.series(rank=rank) for rank in range(1, 9)])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 8)
        self.assertEqual(len(queries), 1)
        sql = queries[0]['sql'].upper()
        self.assertIn('LIMIT 2929', sql)
        self.assertIn('"DATE" ASC, "BAZAAR_RANK"."ID" ASC', sql)

    def test_server_case_and_numeric_rank_aliases_deduplicate_stably(self):
        self.history(server='China', rank=5, count=1)
        self.history(name='Other', server='world', rank=20, count=1)
        response = self.post([
            self.series(server='china', rank='5'),
            self.series(name='Other', server='World', rank=20),
            self.series(server='CHINA', rank=5),
        ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [
            [{'Test bazaar国服第5名': 100, 'date': '第1日'}],
            [{'Other国际服第20名': 100, 'date': '第1日'}],
        ])

    def test_same_date_uses_primary_key_order_and_lowercase_china_label(self):
        first = BazaarRank.objects.create(bazaar_name='Test bazaar', server='china', rank=5,
                                         date=date(2025, 1, 1), score=9)
        second = BazaarRank.objects.create(bazaar_name='Test bazaar', server='China', rank=5,
                                          date=date(2025, 1, 1), score=8)
        self.assertLess(first.pk, second.pk)
        response = self.post([self.series(server='china')])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [[
            {'Test bazaar国服第5名': 9, 'date': '第1日'},
            {'Test bazaar国服第5名': 8, 'date': '第2日'},
        ]])

    def test_empty_request_is_empty_without_sql(self):
        with self.assertNumQueries(0):
            response = self.post([])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_raw_ninth_series_is_rejected_before_deduplication_and_sql(self):
        with self.assertNumQueries(0):
            response = self.post([self.series()] * 9)
        self.assertEqual(response.status_code, 400)

    def test_invalid_shapes_and_values_are_400_before_data_sql(self):
        invalid = [
            {}, 'text', None, [None], [[]], ['item'], [True], [1],
            [{}], [{'bazaarName': 'Name', 'server': 'China'}],
            [dict(self.series(), extra='unexpected')],
            [self.series(name=None)], [self.series(name=7)],
            [self.series(name=' ')], [self.series(name='x' * 256)],
            [self.series(name='\ud800')],
            [self.series(server=None)], [self.series(server=[])],
            [self.series(server='Global')], [self.series(server='')],
            *[[self.series(rank=rank)] for rank in (None, True, False, 1.0, 0, 51, -1,
                                                    '1.0', '+1', '１', [], {}, '')],
        ]
        for payload in invalid:
            with self.subTest(payload=repr(payload)):
                cache.clear()
                with self.assertNumQueries(0):
                    response = self.post(payload)
                self.assertEqual(response.status_code, 400)
                self.assertNotIn('Traceback', response.content.decode())

    def test_name_length_boundary_and_rank_extremes_remain_supported(self):
        name = 'x' * 255
        for rank in (1, 50):
            self.history(name=name, rank=rank, count=1)
        response = self.post([self.series(name=name, rank='1'), self.series(name=name, rank=50)])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()), 2)
        self.assertTrue(all(len(series) == 1 for series in response.json()))

    def test_366_points_are_complete_but_367_is_an_error_not_partial_history(self):
        self.history(count=366)
        with CaptureQueriesContext(connection) as queries:
            response = self.post([self.series()])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()[0]), 366)
        self.assertIn('LIMIT 367', queries[0]['sql'].upper())
        BazaarRank.objects.create(bazaar_name='Test bazaar', server='China', rank=5,
                                  date=date(2026, 1, 2), score=999)
        with CaptureQueriesContext(connection) as queries:
            response = self.post([self.series()])
        self.assertEqual(response.status_code, 400)
        self.assertIsInstance(response.json().get('error'), str)
        self.assertIn('LIMIT 367', queries[0]['sql'].upper())

    def test_one_oversized_series_cannot_hide_inside_another_series_budget(self):
        self.history(count=367)
        self.history(name='Other', count=1)
        response = self.post([self.series(), self.series(name='Other')])
        self.assertEqual(response.status_code, 400)
        self.assertIsInstance(response.json(), dict)

    def test_total_materialization_is_capped_with_a_sentinel_row(self):
        self.history(count=1000)
        with CaptureQueriesContext(connection) as queries:
            response = self.post([self.series(), self.series(name='Other')])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(len(queries), 1)
        self.assertIn('LIMIT 733', queries[0]['sql'].upper())

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=False)
    def test_closed_read_mode_still_requires_authentication(self):
        self.assertEqual(self.post([]).status_code, 401)
        user = get_user_model().objects.create_user(username='bazaar-reader', email='bazaar@example.com')
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + str(AccessToken.for_user(user)))
        self.assertEqual(self.post([]).status_code, 200)

    def test_invalid_jwt_cannot_be_ignored_on_public_chart(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer not-a-jwt')
        self.assertEqual(self.post([]).status_code, 401)

    def test_chart_has_independent_transport_read_budget_and_retry_after(self):
        for _ in range(60):
            self.assertEqual(self.post([], REMOTE_ADDR='192.0.2.10').status_code, 200)
        response = self.post([], REMOTE_ADDR='192.0.2.10', HTTP_X_FORWARDED_FOR='203.0.113.99')
        self.assertEqual(response.status_code, 429)
        self.assertGreater(int(response['Retry-After']), 0)
        self.assertEqual(self.post([], REMOTE_ADDR='192.0.2.11').status_code, 200)
