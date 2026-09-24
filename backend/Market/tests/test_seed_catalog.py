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
        existing = MarketItem.objects.create(id=22, name='Existing', scope='global', enabled=True)
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [
                {'item_id': 11, 'item_name': '测试舰船', 'market_group_name_3rd': '舰船'},
                {'item_id': 22, 'item_name': 'Old catalog title', 'market_group_name_3rd': '舰船'},
            ])
            call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())
            call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())

        seeded = MarketItem.objects.get(pk=11)
        existing.refresh_from_db()
        self.assertEqual(seeded.name, '测试舰船')
        self.assertEqual(seeded.category, '舰船')
        self.assertFalse(seeded.enabled)
        self.assertEqual(existing.name, 'Existing')
        self.assertTrue(existing.enabled)
        self.assertEqual(MarketItem.objects.count(), 2)

    def test_invalid_catalog_aborts_before_any_items_are_written(self):
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, [
                {'item_id': 11, 'item_name': 'Valid', 'market_group_name_3rd': 'Ships'},
                {'item_id': 0, 'item_name': 'Bad', 'market_group_name_3rd': 'Ships'},
            ])
            with self.assertRaises(CommandError):
                call_command('market_seed_catalog', catalog=str(catalog), stdout=StringIO())

        self.assertFalse(MarketItem.objects.exists())

    def test_bundled_catalog_can_be_selected_without_live_game_access(self):
        call_command('market_seed_catalog', stdout=StringIO())

        self.assertGreaterEqual(MarketItem.objects.count(), 5000)
        self.assertTrue(MarketItem.objects.filter(pk=28007000000, name='伊甸币', enabled=False).exists())
