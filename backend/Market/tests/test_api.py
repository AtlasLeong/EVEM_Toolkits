from decimal import Decimal
from datetime import datetime, timezone
import time

from django.test import TestCase

from Market.models import CollectionRun, LatestPrice, MarketItem, PriceSnapshot


class PublicMarketRoutingTests(TestCase):
    def test_empty_catalog_has_bounded_result_envelope(self):
        response = self.client.get('/api/market/items/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'count': 0, 'results': []})


class PublicMarketItemsTests(TestCase):
    def test_search_projects_latest_quote_with_string_prices_and_utc_time(self):
        item = MarketItem.objects.create(id=123456789012, name='Tritanium', category='Mineral', scope='global')
        MarketItem.objects.create(id=9, name='Tritanium hidden', enabled=False)
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        observed_at_ms = int(time.time() * 1000)
        snapshot = PriceSnapshot.objects.create(
            item=item, run=run, best_buy=Decimal('9.25'), best_sell=Decimal('10.50'),
            observed_at_ms=observed_at_ms,
        )
        LatestPrice.objects.create(item=item, snapshot=snapshot)

        response = self.client.get('/api/market/items/', {'q': 'trit'})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'count': 1,
            'results': [{
                'item_id': '123456789012', 'name': 'Tritanium', 'category': 'Mineral',
                'scope': 'global', 'best_buy': '9.25', 'best_sell': '10.50',
                'observed_at': datetime.fromtimestamp(observed_at_ms / 1000, timezone.utc).isoformat().replace('+00:00', 'Z'),
                'status': 'fresh',
            }],
        })

    def test_quote_without_snapshot_is_uncollected_and_old_quote_is_stale(self):
        empty = MarketItem.objects.create(id=1, name='Empty')
        old = MarketItem.objects.create(id=2, name='Old')
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        snapshot = PriceSnapshot.objects.create(
            item=old, run=run, best_sell=Decimal('12.00'),
            observed_at_ms=int(time.time() * 1000) - 3 * 60 * 60 * 1000,
        )
        LatestPrice.objects.create(item=old, snapshot=snapshot)

        rows = {row['item_id']: row for row in self.client.get('/api/market/items/').json()['results']}

        self.assertEqual(rows[str(empty.pk)]['status'], 'uncollected')
        self.assertIsNone(rows[str(empty.pk)]['observed_at'])
        self.assertIsNone(rows[str(empty.pk)]['best_sell'])
        self.assertEqual(rows[str(old.pk)]['status'], 'stale')
        self.assertEqual(rows[str(old.pk)]['best_sell'], '12.00')

    def test_observation_without_orders_is_empty_but_keeps_observation_time(self):
        item = MarketItem.objects.create(id=3, name='No orders')
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        snapshot = PriceSnapshot.objects.create(item=item, run=run, observed_at_ms=int(time.time() * 1000))
        LatestPrice.objects.create(item=item, snapshot=snapshot)

        row = self.client.get('/api/market/items/').json()['results'][0]

        self.assertEqual(row['status'], 'empty')
        self.assertIsNotNone(row['observed_at'])
        self.assertIsNone(row['best_buy'])
        self.assertIsNone(row['best_sell'])

    def test_old_observation_without_orders_is_stale_not_current_empty_book(self):
        item = MarketItem.objects.create(id=4, name='Old no orders')
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        snapshot = PriceSnapshot.objects.create(
            item=item, run=run, observed_at_ms=int(time.time() * 1000) - 3 * 60 * 60 * 1000,
        )
        LatestPrice.objects.create(item=item, snapshot=snapshot)

        row = self.client.get('/api/market/items/').json()['results'][0]

        self.assertEqual(row['status'], 'stale')
        self.assertIsNone(row['best_buy'])
        self.assertIsNone(row['best_sell'])

    def test_item_list_pagination_is_bounded_and_bad_queries_are_rejected(self):
        MarketItem.objects.bulk_create([MarketItem(id=index, name=f'Item {index:03d}') for index in range(1, 121)])

        page = self.client.get('/api/market/items/', {'page': 1, 'page_size': 999}).json()
        self.assertEqual(page['count'], 120)
        self.assertEqual(len(page['results']), 100)
        self.assertEqual(len(self.client.get('/api/market/items/', {'page': 2, 'page_size': 999}).json()['results']), 20)
        self.assertEqual(self.client.get('/api/market/items/', {'page': 0}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/items/', {'q': 'x' * 101}).status_code, 400)

    def test_large_numeric_search_is_safe_and_has_no_match(self):
        response = self.client.get('/api/market/items/', {'q': '9' * 100})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 0)

    def test_history_rejects_invalid_windows_and_returns_utc_decimal_observations(self):
        item = MarketItem.objects.create(id=77, name='History')
        now_ms = int(time.time() * 1000)
        old_ms = now_ms - 2 * 24 * 60 * 60 * 1000
        for observed_at_ms, price in [(old_ms, '8.00'), (now_ms, '9.50')]:
            run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
            PriceSnapshot.objects.create(
                item=item, run=run, best_buy=Decimal(price), observed_at_ms=observed_at_ms,
            )

        response = self.client.get('/api/market/items/77/history/', {'days': 1})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {
            'count': 1,
            'results': [{
                'observed_at': datetime.fromtimestamp(now_ms / 1000, timezone.utc).isoformat().replace('+00:00', 'Z'),
                'best_buy': '9.50', 'best_sell': None,
            }],
        })
        self.assertEqual(self.client.get('/api/market/items/77/history/', {'days': 2}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/items/78/history/').status_code, 404)
        self.assertEqual(self.client.get('/api/market/items/999999999999999999999999/history/').status_code, 404)
