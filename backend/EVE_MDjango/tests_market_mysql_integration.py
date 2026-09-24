"""Real MySQL 8 checks against the disposable, single-schema Market CI service.

Run only after ``migrate`` with EVE_MDjango.market_mysql_ci_settings. These
tests deliberately use unittest rather than Django's test runner, which would
create a second database. No game session or network transport is used.
"""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal
import os
from threading import Event
import unittest
from unittest.mock import patch


if os.environ.get('DJANGO_SETTINGS_MODULE') != 'EVE_MDjango.market_mysql_ci_settings':
    raise RuntimeError('Market MySQL integration tests require the isolated CI settings.')

import django

django.setup()

from django.db import IntegrityError, connection, connections, transaction  # noqa: E402

from EVE_MDjango.market_mysql_ci_cleanup import clear_price_snapshots, require_ci_schema  # noqa: E402
from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot  # noqa: E402
from Market.worker import _claim_run, collect_due  # noqa: E402


NOW_MS = 1_700_000_000_000


class FakeSession:
    def __init__(self):
        self.closed = False
        self.queries = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        self.closed = True

    def quote(self, item_id, region_id):
        self.queries.append((item_id, region_id))
        return type('Quote', (), {
            'best_buy': Decimal('12.34'),
            'best_sell': Decimal('15.67'),
            'buy_count': 2,
            'sell_count': 3,
        })()


class MarketMysqlIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if connection.vendor != 'mysql' or connection.settings_dict['NAME'] != 'market_ci':
            raise RuntimeError('Refusing to write outside the isolated Market MySQL CI schema.')
        with connection.cursor() as cursor:
            cursor.execute('SELECT DATABASE(), VERSION()')
            schema_name, version = cursor.fetchone()
        if schema_name != 'market_ci' or not version.startswith('8.0.'):
            raise RuntimeError('Market integration tests require the disposable MySQL 8.0 schema.')

    def setUp(self):
        self._clear_market_rows()

    def tearDown(self):
        self._clear_market_rows()

    @staticmethod
    def _clear_market_rows():
        require_ci_schema(connection)
        LatestPrice.objects.all().delete()
        clear_price_snapshots(connection)
        CollectionRun.objects.all().delete()
        MarketItem.objects.all().delete()
        MarketConfig.objects.all().delete()

    def test_mysql_enforces_config_and_positive_price_checks(self):
        table = connection.ops.quote_name(MarketConfig._meta.db_table)
        with connection.cursor() as cursor:
            with self.assertRaises(IntegrityError):
                cursor.execute(
                    f'INSERT INTO {table} '
                    '(id, min_interval_seconds, max_interval_seconds, enabled, session_status, updated_at_ms) '
                    'VALUES (2, 2100, 3060, 1, %s, %s)',
                    ['unconfigured', NOW_MS],
                )
            with self.assertRaises(IntegrityError):
                cursor.execute(
                    f'INSERT INTO {table} '
                    '(id, min_interval_seconds, max_interval_seconds, enabled, session_status, updated_at_ms) '
                    'VALUES (1, 2099, 3060, 1, %s, %s)',
                    ['unconfigured', NOW_MS],
                )

        item = MarketItem.objects.create(id=900000001, name='Synthetic CI item', enabled=False)
        run = CollectionRun.objects.create(trigger='manual', status='succeeded')
        with self.assertRaises(IntegrityError):
            PriceSnapshot.objects.create(
                item=item, run=run, best_buy=Decimal('-0.01'),
                best_sell=None, observed_at_ms=NOW_MS,
            )

    def test_worker_writes_snapshot_latest_pointer_and_schedule_without_game_network(self):
        MarketConfig.objects.create(next_due_at_ms=0)
        item = MarketItem.objects.create(id=900000002, name='Synthetic worker item', scope='global')
        session = FakeSession()

        run = collect_due(
            clock_ms=lambda: NOW_MS,
            bundle_loader=lambda: object(),
            session_factory=lambda bundle: session,
            randint=lambda lower, upper: lower,
            sleep=lambda _: None,
        )

        self.assertEqual(run.status, 'succeeded')
        self.assertEqual((run.success_count, run.failure_count), (1, 0))
        self.assertEqual(session.queries, [(item.id, 8)])
        self.assertTrue(session.closed)
        snapshot = PriceSnapshot.objects.get(run=run, item=item)
        self.assertEqual((snapshot.best_buy, snapshot.best_sell), (Decimal('12.34'), Decimal('15.67')))
        self.assertEqual((snapshot.buy_order_count, snapshot.sell_order_count), (2, 3))
        self.assertEqual(LatestPrice.objects.get(item=item).snapshot_id, snapshot.id)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.session_status, 'ready')
        self.assertEqual(config.next_due_at_ms, NOW_MS + 2_100_000)

    def test_second_mysql_connection_cannot_claim_a_new_active_lease(self):
        MarketConfig.objects.create(next_due_at_ms=0)
        initial_read = Event()
        continue_claim = Event()
        original_get_or_create = MarketConfig.objects.get_or_create

        def pause_after_initial_read(*args, **kwargs):
            result = original_get_or_create(*args, **kwargs)
            initial_read.set()
            if not continue_claim.wait(10):
                raise TimeoutError('Second connection did not resume.')
            return result

        def contender():
            connections.close_all()
            try:
                return _claim_run(NOW_MS)
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with patch.object(MarketConfig.objects, 'get_or_create', side_effect=pause_after_initial_read):
                with transaction.atomic():
                    MarketConfig.objects.select_for_update().get(pk=1)
                    future = pool.submit(contender)
                    try:
                        self.assertTrue(initial_read.wait(10), 'Second connection never read the config.')
                        CollectionRun.objects.create(
                            trigger='manual', status='running',
                            lease_owner='first-connection', lease_expires_at_ms=NOW_MS + 60_000,
                        )
                    finally:
                        continue_claim.set()
                second_claim = future.result(timeout=10)

        self.assertIsNone(second_claim)
        self.assertEqual(CollectionRun.objects.filter(status='running').count(), 1)
