import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from Market.models import MarketItem


class MarketCatalogSeedTests(TestCase):
    def _catalog(self, root, rows):
        path = Path(root) / 'catalog.json'
        path.write_text(json.dumps(rows, ensure_ascii=False), encoding='utf-8')
        return path

    def test_import_is_disabled_by_default_and_idempotent(self):
        existing = MarketItem.objects.create(
            id=22, name='Existing', category='Custom', scope='global', enabled=True,
        )
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [
                {'item_id': 11, 'item_name': '测试舰船', 'category_id': 1000,
                 'subcategory_id': 1000039, 'market_group_name_3rd': '舰船'},
                {'item_id': 22, 'item_name': 'Old catalog title', 'category_id': 1010,
                 'subcategory_id': 1010001, 'market_group_name_3rd': '舰船'},
            ])
            call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())
            call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())

        seeded = MarketItem.objects.get(pk=11)
        existing.refresh_from_db()
        self.assertEqual(seeded.name, '测试舰船')
        self.assertEqual(seeded.category, '舰船')
        self.assertEqual(seeded.category_id, 1000)
        self.assertEqual(seeded.subcategory_id, 1000039)
        self.assertFalse(seeded.enabled)
        self.assertEqual(existing.name, 'Existing')
        self.assertEqual(existing.category, 'Custom')
        self.assertEqual(existing.category_id, 1010)
        self.assertEqual(existing.subcategory_id, 1010001)
        self.assertTrue(existing.enabled)
        self.assertEqual(MarketItem.objects.count(), 2)

    def test_reseeding_fills_missing_ids_without_overwriting_existing_classification(self):
        MarketItem.objects.create(
            id=22, name='User item', category='My group', category_id=3000,
            subcategory_id=3000001, enabled=True,
        )
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [{
                'item_id': 22, 'item_name': 'Catalog item', 'category_id': 1000,
                'subcategory_id': 1000039, 'market_group_name_3rd': '舰船',
            }])
            call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())

        item = MarketItem.objects.get(pk=22)
        self.assertEqual((item.name, item.category, item.category_id, item.subcategory_id, item.enabled),
                         ('User item', 'My group', 3000, 3000001, True))

    def test_invalid_catalog_aborts_before_any_items_are_written(self):
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [
                {'item_id': 11, 'item_name': 'Valid', 'market_group_name_3rd': 'Ships'},
                {'item_id': 0, 'item_name': 'Bad', 'market_group_name_3rd': 'Ships'},
            ])
            with self.assertRaises(CommandError):
                call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())

        self.assertFalse(MarketItem.objects.exists())

    def test_invalid_catalog_category_ids_abort_before_any_items_are_written(self):
        invalid_values = [True, -1, '1000']
        for invalid_value in invalid_values:
            with self.subTest(category_id=invalid_value), TemporaryDirectory() as temporary:
                catalog = self._catalog(temporary, [
                    {'item_id': 11, 'item_name': 'Bad category', 'category_id': invalid_value,
                     'market_group_name_3rd': 'Ships'},
                ])
                with self.assertRaises(CommandError):
                    call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())
            self.assertFalse(MarketItem.objects.exists())

    def test_bundled_catalog_can_be_selected_without_live_game_access(self):
        call_command('market_seed_catalog', stdout=StringIO())

        self.assertGreaterEqual(MarketItem.objects.count(), 5000)
        self.assertTrue(MarketItem.objects.filter(pk=28007000000, name='伊甸币', enabled=False).exists())

    def test_seed_classifies_the_three_operator_buckets_and_can_enable_them(self):
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [
                {'item_id': 28007000000, 'item_name': '伊甸币', 'market_group_name_3rd': '货币'},
                {'item_id': 42001000000, 'item_name': '光泽合金', 'category_id': 1200,
                 'subcategory_id': 1200020, 'market_group_name_3rd': '行星资源-复数'},
                {'item_id': 41000000000, 'item_name': '三钛合金', 'category_id': 1200,
                 'subcategory_id': 1200000, 'market_group_name_3rd': '矿物-复数'},
            ])
            call_command(
                'market_seed_catalog', catalog=str(catalog),
                enable_buckets='currency,planetary,minerals', stdout=StringIO(),
            )

        buckets = dict(MarketItem.objects.values_list('id', 'market_bucket'))
        self.assertEqual(buckets, {
            28007000000: 'currency', 42001000000: 'planetary', 41000000000: 'minerals',
        })
        self.assertTrue(MarketItem.objects.filter(enabled=True).count() == 3)
