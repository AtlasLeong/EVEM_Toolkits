"""An additive recovery migration must not prevent writes from release 0010."""

from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase

from Market.models import CollectionRun, MarketConfig, MarketItem


class MarketBatchRecoveryMigrationCompatibilityTests(TestCase):
    def previous_apps(self):
        return MigrationLoader(connection).project_state([
            ('Market', '0010_unplanned_item_limit_null'),
        ]).apps

    def test_previous_release_can_insert_config_item_and_run_with_null_recovery_fields(self):
        apps = self.previous_apps()
        PreviousConfig = apps.get_model('Market', 'MarketConfig')
        PreviousItem = apps.get_model('Market', 'MarketItem')
        PreviousRun = apps.get_model('Market', 'CollectionRun')

        PreviousConfig.objects.create(
            next_due_at_ms=1000, session_status='ready', updated_at_ms=1000,
        )
        PreviousItem.objects.create(
            id=900001, name='Previous release item', enabled=False, scope='global',
        )
        previous_run = PreviousRun.objects.create(
            trigger='scheduled', status='succeeded', success_count=40,
            item_limit=40, expected_count=40, started_at_ms=1000, finished_at_ms=2000,
        )

        config = MarketConfig.objects.get(pk=1)
        self.assertEqual((config.max_items_per_run, config.session_status), (80, 'ready'))
        self.assertIsNone(config.batch_recovery_success_count)
        self.assertIsNone(config.batch_recovery_probe_attempted)
        self.assertIsNone(config.batch_recovery_success_at_ms)
        item = MarketItem.objects.get(pk=900001)
        self.assertEqual((item.name, item.enabled), ('Previous release item', False))
        run = CollectionRun.objects.get(pk=previous_run.pk)
        self.assertIsNone(run.batch_recovery_probe)
        self.assertEqual(
            (run.status, run.item_limit, run.expected_count, run.success_count),
            ('succeeded', 40, 40, 40),
        )

    def test_previous_release_updates_remain_possible_and_leave_detectably_stale_credit(self):
        config = MarketConfig.objects.create(
            next_due_at_ms=1000, updated_at_ms=1000, session_status='ready',
            batch_recovery_success_count=3, batch_recovery_probe_attempted=False,
            batch_recovery_success_at_ms=1000,
        )
        run = CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='previous-worker',
            lease_expires_at_ms=999999, batch_recovery_probe=False,
        )
        apps = self.previous_apps()
        PreviousConfig = apps.get_model('Market', 'MarketConfig')
        PreviousRun = apps.get_model('Market', 'CollectionRun')

        previous_config = PreviousConfig.objects.get(pk=config.pk)
        previous_config.updated_at_ms = 2000
        previous_config.next_due_at_ms = 2102000
        previous_config.save(update_fields=['updated_at_ms', 'next_due_at_ms'])
        previous_run = PreviousRun.objects.get(pk=run.pk)
        previous_run.status = 'succeeded'
        previous_run.finished_at_ms = 2000
        previous_run.item_limit = 40
        previous_run.expected_count = 40
        previous_run.success_count = 40
        previous_run.lease_owner = ''
        previous_run.lease_expires_at_ms = None
        previous_run.save(update_fields=[
            'status', 'finished_at_ms', 'item_limit', 'expected_count', 'success_count',
            'lease_owner', 'lease_expires_at_ms',
        ])

        config.refresh_from_db()
        run.refresh_from_db()
        self.assertEqual((config.updated_at_ms, config.next_due_at_ms), (2000, 2102000))
        self.assertEqual(config.batch_recovery_success_count, 3)
        self.assertEqual(config.batch_recovery_success_at_ms, 1000)
        self.assertNotEqual(config.batch_recovery_success_at_ms, config.updated_at_ms)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual((run.status, run.success_count), ('succeeded', 40))
        self.assertFalse(run.batch_recovery_probe)
