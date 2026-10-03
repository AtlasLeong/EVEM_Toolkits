"""Existing releases must keep writing during the additive migration window."""

from django.db import IntegrityError, connection, transaction
from django.db.migrations.executor import MigrationExecutor
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase, TransactionTestCase

from Market.models import CollectionRun, MarketConfig


class PacedBatchMigrationCompatibilityTests(TestCase):
    def test_database_rejects_capacity_outside_supported_choices(self):
        config = MarketConfig.objects.create(max_items_per_run=80)
        with self.assertRaises(IntegrityError), transaction.atomic():
            MarketConfig.objects.filter(pk=config.pk).update(max_items_per_run=60)
        config.refresh_from_db()
        self.assertEqual(config.max_items_per_run, 80)

    def test_previous_release_can_insert_runs_and_update_existing_config(self):
        config = MarketConfig.objects.create(max_items_per_run=80)
        previous_apps = MigrationLoader(connection).project_state([
            ('Market', '0008_marketconfig_cooldown_until_ms_and_more'),
        ]).apps
        PreviousConfig = previous_apps.get_model('Market', 'MarketConfig')
        PreviousRun = previous_apps.get_model('Market', 'CollectionRun')

        previous_config = PreviousConfig.objects.get(pk=config.pk)
        previous_config.session_status = 'ready'
        previous_config.save(update_fields=['session_status'])
        old_run = PreviousRun.objects.create(trigger='scheduled', status='succeeded', success_count=40)

        config.refresh_from_db()
        run = CollectionRun.objects.get(pk=old_run.pk)
        self.assertEqual((config.session_status, config.max_items_per_run), ('ready', 80))
        self.assertIsNone(run.expected_count)
        self.assertIsNone(run.item_limit)
        self.assertIsNone(run.batch_fallback_reason)

    def test_previous_paced_release_keeps_historical_forty_item_plan(self):
        previous_apps = MigrationLoader(connection).project_state([
            ('Market', '0009_paced_batches'),
        ]).apps
        PreviousRun = previous_apps.get_model('Market', 'CollectionRun')
        old_run = PreviousRun.objects.create(
            trigger='scheduled', status='succeeded', success_count=40, expected_count=40,
        )

        run = CollectionRun.objects.get(pk=old_run.pk)
        self.assertEqual((run.item_limit, run.expected_count, run.success_count), (40, 40, 40))
        new_run = CollectionRun.objects.create(trigger='manual')
        self.assertIsNone(new_run.item_limit)
        self.assertIsNone(new_run.expected_count)


class UnplannedBatchMigrationTests(TransactionTestCase):
    migrate_from = ('Market', '0009_paced_batches')
    migrate_to = ('Market', '0010_unplanned_item_limit_null')

    def setUp(self):
        super().setUp()
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        self.previous_apps = executor.loader.project_state([self.migrate_from]).apps
        self.addCleanup(self.restore_current_schema)

    def restore_current_schema(self):
        MigrationExecutor(connection).migrate([self.migrate_to])

    def test_existing_unstarted_unplanned_queue_is_cleared_without_changing_other_runs(self):
        PreviousRun = self.previous_apps.get_model('Market', 'CollectionRun')
        cases = [
            ({'status': 'queued'}, None),
            ({'status': 'queued', 'item_limit': 80}, None),
            ({'status': 'queued', 'item_limit': None}, None),
            ({'status': 'queued', 'started_at_ms': 1000}, 40),
            ({'status': 'queued', 'started_at_ms': 1000, 'item_limit': 80}, 80),
            ({'status': 'queued', 'expected_count': 40}, 40),
            ({'status': 'queued', 'expected_count': 80, 'item_limit': 80}, 80),
            ({'status': 'running', 'started_at_ms': 1000}, 40),
            ({'status': 'running', 'started_at_ms': 1000, 'item_limit': 80}, 80),
            ({'status': 'running', 'expected_count': 40}, 40),
            ({'status': 'running', 'expected_count': 80, 'item_limit': 80}, 80),
            ({'status': 'succeeded', 'finished_at_ms': 2000, 'success_count': 40}, 40),
            ({'status': 'succeeded', 'finished_at_ms': 2000, 'item_limit': 80,
              'expected_count': 80, 'success_count': 80}, 80),
            ({'status': 'failed', 'finished_at_ms': 2000, 'item_limit': 80,
              'failure_count': 1, 'error_code': 'item_error'}, 80),
            ({'status': 'partial', 'finished_at_ms': 2000, 'expected_count': 40,
              'success_count': 3, 'failure_count': 1}, 40),
        ]
        expected_limits = {}
        for fields, expected_limit in cases:
            run = PreviousRun.objects.create(trigger='manual', created_at_ms=500, **fields)
            expected_limits[run.pk] = expected_limit
        self.assertEqual(PreviousRun.objects.order_by('id').first().item_limit, 40)
        expected_rows = list(PreviousRun.objects.order_by('id').values())
        for row in expected_rows:
            row['item_limit'] = expected_limits[row['id']]

        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_to])
        current_apps = executor.loader.project_state([self.migrate_to]).apps
        CurrentRun = current_apps.get_model('Market', 'CollectionRun')

        self.assertEqual(list(CurrentRun.objects.order_by('id').values()), expected_rows)
        new_run = CurrentRun.objects.create(trigger='manual')
        self.assertIsNone(new_run.item_limit)
        self.assertIsNone(new_run.expected_count)
        rows_before_reverse = list(CurrentRun.objects.order_by('id').values())

        # Reversing the code default must not manufacture a capacity plan.
        executor = MigrationExecutor(connection)
        executor.migrate([self.migrate_from])
        reversed_apps = executor.loader.project_state([self.migrate_from]).apps
        ReversedRun = reversed_apps.get_model('Market', 'CollectionRun')
        self.assertEqual(list(ReversedRun.objects.order_by('id').values()), rows_before_reverse)
