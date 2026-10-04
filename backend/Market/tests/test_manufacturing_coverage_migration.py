"""The manufacturing coverage migration changes only the approved enable flags."""

import importlib
from decimal import Decimal

from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.loader import MigrationLoader
from django.test import TransactionTestCase


# Independent fixed approval contract, including five uncraftable starter ships.
APPROVED_LEAF_IDS = (
    10100000107, 10100000206, 10100000307, 10100000406, 10100000407,
    42001000034, 42001000035,
    50012100000, 50012100001, 50012100002,
    51021000100, 51021000200, 51021000300, 51021000400,
    51022000100, 51022000200, 51022000300, 51022000400,
)


class ManufacturingCoverageMigrationTests(TransactionTestCase):
    migrate_from = ('Market', '0011_market_batch_recovery')
    migrate_to = ('Market', '0012_enable_manufacturing_leaves')

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        self.latest_targets = executor.loader.graph.leaf_nodes()
        self.addCleanup(self.restore_current_schema)
        executor.migrate([self.migrate_from])
        self.previous_apps = executor.loader.project_state([self.migrate_from]).apps

    def restore_current_schema(self):
        MigrationExecutor(connection).migrate(self.latest_targets)

    def migrate(self, target):
        executor = MigrationExecutor(connection)
        executor.migrate([target])
        return executor.loader.project_state([target]).apps

    def rows(self, apps):
        return {
            name: list(
                apps.get_model('Market', name).objects.using(connection.alias)
                .order_by('pk').values()
            )
            for name in ('MarketItem', 'MarketConfig', 'CollectionRun',
                         'PriceSnapshot', 'LatestPrice')
        }

    def create_history(self, apps, item_id, run, observed_at_ms, buy, sell):
        Snapshot = apps.get_model('Market', 'PriceSnapshot')
        return Snapshot.objects.using(connection.alias).create(
            item_id=item_id, run_id=run.pk, observed_at_ms=observed_at_ms,
            best_buy=Decimal(buy), best_sell=Decimal(sell),
            buy_order_count=2, sell_order_count=3,
            buy_prices=[buy, '8.00'], sell_prices=[sell, '14.00'],
        )

    def test_forward_is_idempotent_and_reverse_preserves_all_original_data(self):
        Item = self.previous_apps.get_model('Market', 'MarketItem')
        Config = self.previous_apps.get_model('Market', 'MarketConfig')
        Run = self.previous_apps.get_model('Market', 'CollectionRun')
        Latest = self.previous_apps.get_model('Market', 'LatestPrice')
        pre_enabled_ids = set(APPROVED_LEAF_IDS[:2])
        changed_ids = set(APPROVED_LEAF_IDS) - pre_enabled_ids
        for index, item_id in enumerate(APPROVED_LEAF_IDS):
            Item.objects.using(connection.alias).create(
                id=item_id, name=f'custom name {item_id}', category='retained category',
                category_id=100 + index, subcategory_id=200 + index,
                market_bucket='material', scope='retained scope',
                enabled=item_id in pre_enabled_ids,
                manufacturing_coverage_seeded=False if index == 1 else None,
                last_attempt_at_ms=1000 + index, last_failure_at_ms=500 + index,
                last_error_code='retained_error',
            )
        Item.objects.using(connection.alias).create(
            id=9100, name='unrelated disabled', enabled=False,
            last_attempt_at_ms=7, last_failure_at_ms=6, last_error_code='unrelated_error',
        )
        Item.objects.using(connection.alias).create(id=9101, name='unrelated enabled')
        Item.objects.using(connection.alias).create(
            id=9102, name='unrelated marked', enabled=False,
            manufacturing_coverage_seeded=True,
        )
        Config.objects.using(connection.alias).create(
            id=1, enabled=True, session_status='ready', max_items_per_run=80,
            next_due_at_ms=123456, updated_at_ms=4567,
        )
        earlier = Run.objects.using(connection.alias).create(
            trigger='scheduled', status='succeeded', created_at_ms=100,
            started_at_ms=101, finished_at_ms=200, success_count=2,
            item_limit=40, expected_count=2,
        )
        later = Run.objects.using(connection.alias).create(
            trigger='manual', status='partial', created_at_ms=300,
            started_at_ms=301, finished_at_ms=400, success_count=2,
            failure_count=1, error_code='retained_run_error',
            item_limit=40, expected_count=3,
        )
        for item_id in (APPROVED_LEAF_IDS[0], APPROVED_LEAF_IDS[2]):
            self.create_history(self.previous_apps, item_id, earlier, 120, '9.00', '12.00')
            latest_snapshot = self.create_history(
                self.previous_apps, item_id, later, 350, '10.00', '13.00',
            )
            Latest.objects.using(connection.alias).create(
                item_id=item_id, snapshot_id=latest_snapshot.pk, updated_at_ms=351,
            )
        before = self.rows(self.previous_apps)
        expected = {name: [dict(row) for row in rows] for name, rows in before.items()}
        for row in expected['MarketItem']:
            if row['id'] in changed_ids:
                row.update(enabled=True, manufacturing_coverage_seeded=True)

        current_apps = self.migrate(self.migrate_to)
        self.assertEqual(self.rows(current_apps), expected)
        # Execute RunPython again rather than merely checking Django skips an applied migration.
        migration = importlib.import_module('Market.migrations.0012_enable_manufacturing_leaves')
        with connection.schema_editor() as schema_editor:
            migration.enable_manufacturing_leaves(current_apps, schema_editor)
        self.assertEqual(self.rows(current_apps), expected)

        reversed_apps = self.migrate(self.migrate_from)
        self.assertEqual(self.rows(reversed_apps), before)
        # Reapply and reverse a second time to ensure the marker is reusable.
        current_apps = self.migrate(self.migrate_to)
        self.assertEqual(self.rows(current_apps), expected)
        reversed_apps = self.migrate(self.migrate_from)
        self.assertEqual(self.rows(reversed_apps), before)

    def test_missing_approved_items_are_not_created(self):
        Item = self.previous_apps.get_model('Market', 'MarketItem')
        item_id = APPROVED_LEAF_IDS[0]
        Item.objects.using(connection.alias).create(id=item_id, name='existing leaf', enabled=False)
        Item.objects.using(connection.alias).create(id=9200, name='outside scope', enabled=False)
        before = self.rows(self.previous_apps)

        current_apps = self.migrate(self.migrate_to)
        CurrentItem = current_apps.get_model('Market', 'MarketItem')
        self.assertEqual(
            set(CurrentItem.objects.using(connection.alias).values_list('pk', flat=True)),
            {item_id, 9200},
        )
        leaf = CurrentItem.objects.using(connection.alias).get(pk=item_id)
        outside = CurrentItem.objects.using(connection.alias).get(pk=9200)
        self.assertTrue(leaf.enabled)
        self.assertIs(leaf.manufacturing_coverage_seeded, True)
        self.assertFalse(outside.enabled)
        self.assertIsNone(outside.manufacturing_coverage_seeded)
        reversed_apps = self.migrate(self.migrate_from)
        self.assertEqual(self.rows(reversed_apps), before)

    def test_previous_release_can_insert_items_without_the_new_nullable_marker(self):
        previous_apps = MigrationLoader(connection).project_state([
            ('Market', '0010_unplanned_item_limit_null'),
        ]).apps
        PreviousItem = previous_apps.get_model('Market', 'MarketItem')
        PreviousItem.objects.using(connection.alias).create(
            id=9300, name='previous release item', enabled=False,
            last_attempt_at_ms=99, last_error_code='previous_error',
        )

        current_apps = self.migrate(self.migrate_to)
        item = current_apps.get_model('Market', 'MarketItem').objects.using(
            connection.alias,
        ).get(pk=9300)
        self.assertIsNone(item.manufacturing_coverage_seeded)
        self.assertEqual(
            (item.name, item.enabled, item.last_attempt_at_ms, item.last_error_code),
            ('previous release item', False, 99, 'previous_error'),
        )
