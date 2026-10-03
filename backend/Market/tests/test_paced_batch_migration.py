"""Existing releases must keep writing during the additive migration window."""

from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase

from Market.models import CollectionRun, MarketConfig


class PacedBatchMigrationCompatibilityTests(TestCase):
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
