"""Existing releases must keep writing during the additive migration window."""

from django.db import IntegrityError, connection, transaction
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase

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
