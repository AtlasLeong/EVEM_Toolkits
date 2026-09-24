from decimal import Decimal
from datetime import datetime, timezone
import time

from django.test import TestCase
from django.db import connection
from django.test.utils import CaptureQueriesContext

from Market.models import CollectionRun, MarketItem, PriceSnapshot


class MarketCategoryApiTests(TestCase):
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

    def test_series_handles_no_data_and_rejects_invalid_window_or_hidden_item(self):
        self.assertEqual(self.client.get('/api/market/items/77/series/').json(), {
            'count': 0, 'points': [],
            'change': {'best_buy': {'absolute': None, 'percent': None},
                       'best_sell': {'absolute': None, 'percent': None}},
        })
        self.assertEqual(self.client.get('/api/market/items/77/series/', {'days': 2}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/items/78/series/').status_code, 404)
        self.item.enabled = False
        self.item.save(update_fields=['enabled'])
        self.assertEqual(self.client.get('/api/market/items/77/series/').status_code, 404)
