"""Bounded exact-ID reads of stored quotes; no collector or live service calls."""

from decimal import Decimal
from unittest.mock import patch

from django.test import TestCase
from rest_framework.throttling import ScopedRateThrottle

from Market.models import CollectionRun, LatestPrice, MarketItem, PriceSnapshot
from Market.serializers import STALE_AFTER_MS, item_payload
from Market.scope import market_scope_payload


class PublicMarketQuoteTests(TestCase):
    path = '/api/market/quotes/'

    def test_48_exact_ids_use_one_query_and_keep_request_order(self):
        MarketItem.objects.bulk_create([
            MarketItem(id=index, name=f'Item {100 - index}') for index in range(1, 49)
        ])
        # Numeric q-search would also match this name, but batch reads must not.
        MarketItem.objects.create(id=501, name='Item 1,2,3')
        MarketItem.objects.create(id=502, name='Disabled', enabled=False)
        submitted = [48, 1, *range(2, 48), 502, 999]
        with self.assertNumQueries(1):
            response = self.client.get(self.path, {'ids': ','.join(map(str, submitted))})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 48)
        self.assertEqual([row['item_id'] for row in response.json()['results']], [str(value) for value in submitted[:48]])
        self.assertEqual(response.json()['market_scope'], market_scope_payload())

    def test_50_ids_and_signed_64_bit_maximum_are_valid_and_duplicates_are_deduplicated(self):
        maximum = 2**63 - 1
        MarketItem.objects.create(id=maximum, name='Maximum ID')
        response = self.client.get(self.path, {'ids': ','.join([str(maximum)] * 50)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['count'], 1)
        self.assertEqual(response.json()['results'][0]['item_id'], str(maximum))

    def test_invalid_parameters_are_rejected_before_any_database_query(self):
        invalid = [
            '', '?ids=', '?ids=0', '?ids=-1', '?ids=+1', '?ids=1.0',
            '?ids=1e2', '?ids=01', '?ids=1,,2', '?ids=1,', '?ids=1,%202',
            '?ids=%EF%BC%91', '?ids=9223372036854775808',
            '?ids=1&ids=2', '?ids=1&ids=', '?ids=1&q=1', '?item_id=1',
            '?ids=' + ','.join(['1'] * 51), '?ids=' + '9' * 1000,
        ]
        for query in invalid:
            with self.subTest(query=query[:90]), self.assertNumQueries(0):
                response = self.client.get(self.path + query)
                self.assertEqual(response.status_code, 400, response.content)

    def test_empty_unknown_or_disabled_only_batch_has_no_fabricated_quote(self):
        MarketItem.objects.create(id=1, name='Disabled', enabled=False)
        response = self.client.get(self.path, {'ids': '1,2'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'count': 0, 'results': [], 'market_scope': market_scope_payload()})

    def test_batch_reuses_decimal_time_image_top_five_and_status_projection_with_one_clock(self):
        now_ms = 1_800_000_000_000
        run = CollectionRun.objects.create(trigger='scheduled', status='succeeded')
        for value in range(1, 5):
            item = MarketItem.objects.create(id=value, name=f'Item {value}')
            if value != 4:
                snapshot = PriceSnapshot.objects.create(
                    item=item, run=run, best_buy=Decimal('9.25') if value != 3 else None,
                    best_sell=Decimal('123456789.12') if value != 3 else None,
                    buy_prices=['9.25', '8.50'] if value != 3 else [],
                    sell_prices=['9007199254740993.12', '9007199254740994.00'] if value != 3 else [],
                    observed_at_ms=now_ms - (STALE_AFTER_MS + 1 if value == 2 else STALE_AFTER_MS),
                )
                LatestPrice.objects.create(item=item, snapshot=snapshot)
        image = {'path': '/images/game-items/' + 'a' * 64 + '.png', 'imageRole': 'icon', 'compositeWarning': None, 'sourceVersion': 'revision'}
        with patch('Market.serializers.image_metadata', return_value=image), \
             patch('Market.views.epoch_ms', return_value=now_ms) as clock, \
             patch('Market.views.item_payload', wraps=item_payload) as project:
            with self.assertNumQueries(1):
                response = self.client.get(self.path, {'ids': '1,2,3,4'})
        self.assertEqual(response.status_code, 200)
        rows = response.json()['results']
        self.assertEqual([row['status'] for row in rows], ['fresh', 'stale', 'empty', 'uncollected'])
        self.assertEqual(rows[0]['best_sell'], '123456789.12')
        self.assertEqual(rows[0]['buy_prices'], ['9.25', '8.50'])
        self.assertEqual(rows[0]['sell_prices'], ['9007199254740993.12', '9007199254740994.00'])
        self.assertTrue(rows[0]['observed_at'].endswith('Z'))
        self.assertEqual(rows[0]['image_url'], image['path'])
        self.assertEqual(rows[0]['image_role'], 'icon')
        self.assertIsNone(rows[2]['best_sell'])
        self.assertIsNone(rows[3]['observed_at'])
        clock.assert_called_once_with()
        self.assertEqual([call.kwargs for call in project.call_args_list], [{'now_ms': now_ms}] * 4)

    def test_batch_keeps_existing_market_public_throttle(self):
        from django.urls import resolve
        view_class = resolve(self.path).func.view_class
        self.assertEqual(view_class.throttle_scope, 'market_public')
        self.assertEqual(view_class.throttle_classes, [ScopedRateThrottle])
