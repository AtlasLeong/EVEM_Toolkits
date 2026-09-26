from decimal import Decimal
from datetime import datetime, timezone
import time

from django.test import TestCase
from django.db import connection
from django.test.utils import CaptureQueriesContext

from Market.models import CollectionRun, MarketItem, PriceSnapshot


class MarketCategoryApiTests(TestCase):
    def test_logical_categories_are_stable_and_filterable(self):
        MarketItem.objects.create(id=101, name='伊甸币', market_bucket='currency')
        MarketItem.objects.create(id=102, name='光泽合金', market_bucket='planetary')
        MarketItem.objects.create(id=103, name='三钛合金', market_bucket='minerals')
        MarketItem.objects.create(id=104, name='未分类', market_bucket='other')
        MarketItem.objects.create(id=105, name='隐藏行星资源', market_bucket='planetary', enabled=False)

        response = self.client.get('/api/market/categories/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [
            {'id': 'currency', 'label': '货币 · 伊甸币', 'count': 1},
            {'id': 'planetary', 'label': '行星资源', 'count': 1},
            {'id': 'minerals', 'label': '矿物', 'count': 1},
            {'id': 'other', 'label': '其他', 'count': 1},
        ])
        for bucket, expected in [('currency', '101'), ('planetary', '102'), ('minerals', '103')]:
            with self.subTest(bucket=bucket):
                result = self.client.get('/api/market/items/', {'category_id': bucket}).json()
                self.assertEqual([row['item_id'] for row in result['results']], [expected])

    def test_categories_count_only_enabled_items_and_fold_missing_ids(self):
        MarketItem.objects.create(id=1, name='Ship A', category_id=1000)
        MarketItem.objects.create(id=2, name='Ship B', category_id=1000)
        MarketItem.objects.create(id=3, name='Unknown', category_id=9999)
        MarketItem.objects.create(id=4, name='No category')
        MarketItem.objects.create(id=5, name='Zero category', category_id=0)
        MarketItem.objects.create(id=6, name='Hidden', category_id=1010, enabled=False)

        response = self.client.get('/api/market/categories/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [
            {'id': 1000, 'label': '舰船', 'count': 2},
            {'id': 'other', 'label': '其他', 'count': 3},
        ])

    def test_category_filter_combines_with_search_and_validates_input(self):
        MarketItem.objects.create(id=1, name='巡洋舰', category_id=1000)
        MarketItem.objects.create(id=2, name='战列舰', category_id=1000)
        MarketItem.objects.create(id=3, name='巡洋舰炮', category_id=1010)
        MarketItem.objects.create(id=4, name='巡洋舰蓝图')
        MarketItem.objects.create(id=5, name='巡洋舰未知', category_id=0)
        MarketItem.objects.create(id=7, name='巡洋舰未知编号', category_id=9999)
        MarketItem.objects.create(id=6, name='巡洋舰隐藏', category_id=1000, enabled=False)

        response = self.client.get('/api/market/items/', {'category_id': '1000', 'q': '巡洋舰'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['item_id'] for row in response.json()['results']], ['1'])
        self.assertEqual(response.json()['results'][0]['category_id'], 1000)
        other = self.client.get('/api/market/items/', {'category_id': 'other', 'q': '巡洋舰'})
        self.assertEqual(other.status_code, 200)
        self.assertEqual({row['item_id'] for row in other.json()['results']}, {'4', '5', '7'})
        self.assertEqual(self.client.get('/api/market/items/', {'category_id': '-1'}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/items/', {'category_id': 'abc'}).status_code, 400)


class MarketSeriesApiTests(TestCase):
    def setUp(self):
        self.item = MarketItem.objects.create(id=77, name='Price series')
        self.now_ms = int(time.time() * 1000)

    def add_snapshot(self, offset_ms, *, buy=None, sell=None):
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        return PriceSnapshot.objects.create(
            item=self.item, run=run, best_buy=Decimal(buy) if buy is not None else None,
            best_sell=Decimal(sell) if sell is not None else None,
            observed_at_ms=self.now_ms + offset_ms,
        )

    def test_series_is_chronological_and_changes_skip_null_quotes(self):
        self.add_snapshot(-3 * 60 * 60 * 1000, buy='10.00', sell='20.00')
        self.add_snapshot(-2 * 60 * 60 * 1000, sell='22.00')
        self.add_snapshot(-1 * 60 * 60 * 1000, buy='12.00')

        response = self.client.get('/api/market/items/77/series/', {'days': 1})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['count'], 3)
        self.assertEqual([point['best_buy'] for point in body['points']], ['10.00', None, '12.00'])
        self.assertEqual([point['best_sell'] for point in body['points']], ['20.00', '22.00', None])
        self.assertEqual(body['change'], {
            'best_buy': {'absolute': '2.00', 'percent': '20.00'},
            'best_sell': {'absolute': '2.00', 'percent': '10.00'},
        })
        self.assertEqual(body['points'][0]['observed_at'], datetime.fromtimestamp(
            (self.now_ms - 3 * 60 * 60 * 1000) / 1000, timezone.utc,
        ).isoformat().replace('+00:00', 'Z'))

    def test_series_exposes_current_range_and_one_month_extrema(self):
        self.add_snapshot(-29 * 24 * 60 * 60 * 1000, buy='8.00', sell='40.00')
        self.add_snapshot(-6 * 60 * 60 * 1000, buy='12.00', sell='30.00')
        self.add_snapshot(-1 * 60 * 60 * 1000, buy='10.00', sell='25.00')

        body = self.client.get('/api/market/items/77/series/', {'days': 1}).json()

        self.assertEqual(body['stats']['buy']['current'], {
            'value': '10.00', 'observed_at': body['points'][-1]['observed_at'],
        })
        self.assertEqual(body['stats']['buy']['range'], {
            'high': {'value': '12.00', 'observed_at': body['points'][0]['observed_at']},
            'low': {'value': '10.00', 'observed_at': body['points'][1]['observed_at']},
        })
        self.assertEqual(body['stats']['sell']['range']['high']['value'], '30.00')
        self.assertEqual(body['stats']['sell']['range']['low']['value'], '25.00')
        self.assertEqual(body['stats']['buy']['month']['low']['value'], '8.00')
        self.assertEqual(body['stats']['sell']['month']['high']['value'], '40.00')

    def test_series_stats_keep_null_sides_and_single_observation(self):
        self.add_snapshot(-1 * 60 * 60 * 1000)
        body = self.client.get('/api/market/items/77/series/').json()
        self.assertEqual(body['stats'], {
            'buy': {'current': None, 'range': {'high': None, 'low': None}, 'month': {'high': None, 'low': None}},
            'sell': {'current': None, 'range': {'high': None, 'low': None}, 'month': {'high': None, 'low': None}},
        })

    def test_series_stats_for_one_observation_use_that_observation_for_all_extrema(self):
        snapshot = self.add_snapshot(-1 * 60 * 60 * 1000, buy='12.34', sell='56.78')
        body = self.client.get('/api/market/items/77/series/').json()
        observed_at = datetime.fromtimestamp(snapshot.observed_at_ms / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')
        expected = {'value': '12.34', 'observed_at': observed_at}
        self.assertEqual(body['stats']['buy'], {'current': expected, 'range': {'high': expected, 'low': expected}, 'month': {'high': expected, 'low': expected}})
        self.assertEqual(body['stats']['sell']['current'], {'value': '56.78', 'observed_at': observed_at})

    def test_series_current_does_not_reuse_old_quote_when_latest_side_is_null(self):
        self.add_snapshot(-3 * 60 * 60 * 1000, buy='10.00', sell='20.00')
        self.add_snapshot(-2 * 60 * 60 * 1000, buy='12.00', sell='22.00')
        self.add_snapshot(-1 * 60 * 60 * 1000, sell='24.00')

        body = self.client.get('/api/market/items/77/series/').json()

        self.assertIsNone(body['stats']['buy']['current'])
        self.assertEqual(body['stats']['sell']['current']['value'], '24.00')
        self.assertEqual(body['stats']['buy']['range']['high']['value'], '12.00')
        self.assertEqual(body['stats']['buy']['range']['low']['value'], '10.00')
        self.assertEqual(body['stats']['buy']['month']['high']['value'], '12.00')
        self.assertEqual(body['change']['best_buy'], {'absolute': '2.00', 'percent': '20.00'})

    def test_series_current_is_null_for_both_sides_after_an_empty_snapshot(self):
        self.add_snapshot(-2 * 60 * 60 * 1000, buy='12.00', sell='22.00')
        self.add_snapshot(-1 * 60 * 60 * 1000)

        body = self.client.get('/api/market/items/77/series/').json()

        self.assertIsNone(body['stats']['buy']['current'])
        self.assertIsNone(body['stats']['sell']['current'])
        self.assertEqual(body['stats']['sell']['range']['low']['value'], '22.00')
        self.assertEqual(body['stats']['sell']['month']['high']['value'], '22.00')
        self.assertEqual(body['change']['best_sell'], {'absolute': '0.00', 'percent': '0.00'})

    def test_series_limits_actual_points_and_keeps_first_and_last(self):
        for index in range(260):
            self.add_snapshot(-260 * 60 * 1000 + index * 60 * 1000, buy=str(index + 1))

        with CaptureQueriesContext(connection) as queries:
            body = self.client.get('/api/market/items/77/series/', {'days': 1}).json()

        self.assertEqual(body['count'], 260)
        self.assertEqual(len(body['points']), 240)
        self.assertEqual(body['points'][0]['best_buy'], '1.00')
        self.assertEqual(body['points'][-1]['best_buy'], '260.00')
        self.assertEqual(len({point['observed_at'] for point in body['points']}), 240)
        self.assertLessEqual(len(queries), 7)

    def test_series_sampling_preserves_each_side_extrema(self):
        for index in range(260):
            buy = '9999.00' if index == 97 else str(index + 10)
            sell = '1.00' if index == 163 else str(index + 100)
            self.add_snapshot(-260 * 60 * 1000 + index * 60 * 1000, buy=buy, sell=sell)

        body = self.client.get('/api/market/items/77/series/', {'days': 1}).json()
        self.assertLessEqual(len(body['points']), 240)
        self.assertIn('9999.00', [point['best_buy'] for point in body['points']])
        self.assertIn('1.00', [point['best_sell'] for point in body['points']])

    def test_series_sampling_stays_bounded_when_every_row_is_an_extreme(self):
        for index in range(500):
            self.add_snapshot(-500 * 60 * 1000 + index * 60 * 1000, buy=str(index + 1))

        body = self.client.get('/api/market/items/77/series/', {'days': 1}).json()
        self.assertEqual(len(body['points']), 240)
        self.assertEqual(body['points'][0]['best_buy'], '1.00')
        self.assertEqual(body['points'][-1]['best_buy'], '500.00')

    def test_series_handles_no_data_and_rejects_invalid_window_or_hidden_item(self):
        self.assertEqual(self.client.get('/api/market/items/77/series/').json(), {
            'count': 0, 'points': [],
            'change': {'best_buy': {'absolute': None, 'percent': None},
                       'best_sell': {'absolute': None, 'percent': None}},
            'stats': {
                'buy': {'current': None, 'range': {'high': None, 'low': None}, 'month': {'high': None, 'low': None}},
                'sell': {'current': None, 'range': {'high': None, 'low': None}, 'month': {'high': None, 'low': None}},
            },
        })
        self.assertEqual(self.client.get('/api/market/items/77/series/', {'days': 2}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/items/78/series/').status_code, 404)
        self.item.enabled = False
        self.item.save(update_fields=['enabled'])
        self.assertEqual(self.client.get('/api/market/items/77/series/').status_code, 404)
