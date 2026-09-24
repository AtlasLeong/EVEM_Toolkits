import importlib.util

from django.apps import apps
from django.core.exceptions import ValidationError
from django.db import IntegrityError, models, transaction
from django.test import SimpleTestCase, TestCase

from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot


class MarketSchemaTests(SimpleTestCase):
    def test_market_models_have_admin_registration_module(self):
        self.assertIsNotNone(importlib.util.find_spec('Market.admin'))

    def test_market_item_is_registered(self):
        self.assertIn('MarketItem', {model.__name__ for model in apps.get_app_config('Market').get_models()})

    def test_market_item_has_safe_failure_code_slot(self):
        fields = {field.name for field in MarketItem._meta.fields}
        self.assertIn('last_error_code', fields)
        self.assertIn('last_failure_at_ms', fields)
        self.assertIn('last_attempt_at_ms', fields)

    def test_durable_collection_models_are_registered(self):
        registered = {model.__name__: model for model in apps.get_app_config('Market').get_models()}

        self.assertTrue({
            'MarketConfig', 'MarketConfigAudit', 'CollectionRun',
            'PriceSnapshot', 'LatestPrice',
        }.issubset(registered))
        self.assertIsInstance(registered['MarketConfig']._meta.get_field('next_due_at_ms'), models.BigIntegerField)
        self.assertIsInstance(registered['PriceSnapshot']._meta.get_field('observed_at_ms'), models.BigIntegerField)
        self.assertIsInstance(registered['PriceSnapshot']._meta.get_field('best_sell'), models.DecimalField)
        self.assertIsInstance(registered['CollectionRun']._meta.get_field('lease_expires_at_ms'), models.BigIntegerField)


class MarketModelBehaviorTests(TestCase):
    def test_interval_bounds_are_enforced_even_for_queryset_update(self):
        config = MarketConfig.objects.create()

        with self.assertRaises(IntegrityError), transaction.atomic():
            MarketConfig.objects.filter(pk=config.pk).update(min_interval_seconds=2000)

        config.refresh_from_db()
        self.assertEqual(config.min_interval_seconds, 2100)

    def test_snapshot_rows_cannot_be_saved_over_or_deleted(self):
        item = MarketItem.objects.create(id=88, name='Immutable')
        run = CollectionRun.objects.create(trigger='scheduled')
        snapshot = PriceSnapshot.objects.create(item=item, run=run, observed_at_ms=12345)

        snapshot.observed_at_ms = 54321
        with self.assertRaises(ValidationError):
            snapshot.save()
        with self.assertRaises(ValidationError):
            snapshot.delete()

        with self.assertRaises(ValidationError):
            PriceSnapshot.objects.filter(pk=snapshot.pk).update(observed_at_ms=54321)
        with self.assertRaises(ValidationError):
            PriceSnapshot.objects.filter(pk=snapshot.pk).delete()

    def test_one_snapshot_per_run_and_item(self):
        item = MarketItem.objects.create(id=89, name='Idempotent')
        run = CollectionRun.objects.create(trigger='scheduled')
        PriceSnapshot.objects.create(item=item, run=run, observed_at_ms=12345)

        with self.assertRaises(IntegrityError), transaction.atomic():
            PriceSnapshot.objects.create(item=item, run=run, observed_at_ms=12346)

    def test_latest_pointer_cannot_use_another_items_snapshot(self):
        source = MarketItem.objects.create(id=90, name='Source')
        other = MarketItem.objects.create(id=91, name='Other')
        run = CollectionRun.objects.create(trigger='scheduled')
        snapshot = PriceSnapshot.objects.create(item=source, run=run, observed_at_ms=12345)

        with self.assertRaises(ValidationError):
            LatestPrice.objects.create(item=other, snapshot=snapshot)
