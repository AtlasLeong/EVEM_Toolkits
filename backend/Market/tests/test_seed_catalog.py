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

    def test_seed_classifies_the_four_operator_buckets_and_can_enable_them(self):
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

    def test_seed_classifies_intermediate_products_and_can_enable_them(self):
        intermediate_rows = [
            {'item_id': 41005000100, 'item_name': '六元复合物', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000200, 'item_name': '富勒化合物', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000300, 'item_name': '酚合成物', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000400, 'item_name': '多晶碳化硅纤维', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000500, 'item_name': '强化碳纤维', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000700, 'item_name': '铁磁胶体', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000800, 'item_name': '碳化钛', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005000900, 'item_name': '碳化晶体', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41005001000, 'item_name': '纳米晶体管', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41006000001, 'item_name': 'PPD富勒烯纤维', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41006000002, 'item_name': '富勒二茂铁', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41006000003, 'item_name': '富勒烯层间石墨', 'category_id': 1200,
             'subcategory_id': 1200012, 'market_group_name_3rd': '中间产物-复数'},
            {'item_id': 41006000004, 'item_name': '中间产物蓝图', 'category_id': 1700,
             'subcategory_id': 1200012, 'market_group_name_3rd': '蓝图'},
        ]
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, intermediate_rows)
            call_command(
                'market_seed_catalog', catalog=str(catalog),
                enable_buckets='intermediate', stdout=StringIO(),
            )

        self.assertEqual(
            set(MarketItem.objects.values_list('market_bucket', flat=True)),
            {'intermediate', 'other'},
        )
        self.assertEqual(MarketItem.objects.filter(enabled=True).count(), 12)
        self.assertEqual(
            MarketItem.objects.get(pk=41006000004).market_bucket,
            'other',
        )

    def test_seed_classifies_all_tradeable_components_and_requested_structures(self):
        rows = [
            {'item_id': 41300000000, 'item_name': '无人机突触线', 'category_id': 1200,
             'subcategory_id': 1200050, 'market_group_name_3rd': '无人机组件-复数'},
            {'item_id': 27000000000, 'item_name': '建筑建造组件', 'category_id': 1100,
             'subcategory_id': 1100000, 'market_group_name_3rd': '建筑基础组件-复数'},
            {'item_id': 27011000000, 'item_name': '旗舰船只维护舱', 'category_id': 1200,
             'subcategory_id': 1200050, 'market_group_name_3rd': '旗舰组件-复数'},
            {'item_id': 27012000000, 'item_name': '高级舰船组件', 'category_id': 1200,
             'subcategory_id': 1200050, 'market_group_name_3rd': '高级舰船组件-复数'},
            {'item_id': 27013000000, 'item_name': '个人堡垒组件', 'category_id': 1100,
             'subcategory_id': 1100000, 'market_group_name_3rd': '个人堡垒组件-复数'},
            {'item_id': 27014000000, 'item_name': '铁壁升级组件', 'category_id': 1100,
             'subcategory_id': 1100010, 'market_group_name_3rd': '铁壁升级组件-复数'},
            {'item_id': 77011000000, 'item_name': '旗舰船只维护舱蓝图', 'category_id': 1700,
             'subcategory_id': 1700050, 'market_group_name_3rd': '旗舰组件蓝图-复数'},
            {'item_id': 77012000000, 'item_name': '蓝图伪装组件', 'category_id': 1700,
             'subcategory_id': 1200050, 'market_group_name_3rd': '旗舰组件-复数'},
            {'item_id': 44000000004, 'item_name': '艾玛4级受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '艾玛受损结构-复数'},
            {'item_id': 44000000011, 'item_name': '艾玛无畏舰受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '艾玛受损结构-复数'},
            {'item_id': 44000000012, 'item_name': '艾玛航母受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '艾玛受损结构-复数'},
            {'item_id': 44000000015, 'item_name': '艾玛泰坦受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '艾玛受损结构-复数'},
            {'item_id': 44010000004, 'item_name': '加达里4级受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '加达里受损结构-复数'},
            {'item_id': 44010000011, 'item_name': '加达里无畏舰受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '加达里受损结构-复数'},
            {'item_id': 44010000012, 'item_name': '加达里航母受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '加达里受损结构-复数'},
            {'item_id': 44010000015, 'item_name': '加达里泰坦受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '加达里受损结构-复数'},
            {'item_id': 44020000004, 'item_name': '盖伦特4级受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '盖伦特受损结构-复数'},
            {'item_id': 44020000011, 'item_name': '盖伦特无畏舰受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '盖伦特受损结构-复数'},
            {'item_id': 44020000012, 'item_name': '盖伦特航母受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '盖伦特受损结构-复数'},
            {'item_id': 44020000015, 'item_name': '盖伦特泰坦受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '盖伦特受损结构-复数'},
            {'item_id': 44030000004, 'item_name': '米玛塔尔4级受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '米玛塔尔受损结构-复数'},
            {'item_id': 44030000011, 'item_name': '米玛塔尔无畏舰受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '米玛塔尔受损结构-复数'},
            {'item_id': 44030000012, 'item_name': '米玛塔尔航母受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '米玛塔尔受损结构-复数'},
            {'item_id': 44030000015, 'item_name': '米玛塔尔泰坦受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '米玛塔尔受损结构-复数'},
            {'item_id': 44000000005, 'item_name': '艾玛5级受损结构', 'category_id': 1200,
             'subcategory_id': 1200040, 'market_group_name_3rd': '艾玛受损结构-复数'},
        ]
        with TemporaryDirectory() as temporary:
            catalog = self._catalog(temporary, rows)
            call_command(
                'market_seed_catalog', catalog=str(catalog),
                enable_buckets='components,structures', stdout=StringIO(),
            )

        buckets = dict(MarketItem.objects.values_list('id', 'market_bucket'))
        self.assertEqual(buckets, {
            41300000000: 'components',
            27000000000: 'components',
            27011000000: 'components',
            27012000000: 'components',
            27013000000: 'components',
            27014000000: 'components',
            77011000000: 'other',
            77012000000: 'other',
            44000000004: 'structures',
            44000000011: 'structures',
            44000000012: 'structures',
            44000000015: 'structures',
            44010000004: 'structures',
            44010000011: 'structures',
            44010000012: 'structures',
            44010000015: 'structures',
            44020000004: 'structures',
            44020000011: 'structures',
            44020000012: 'structures',
            44020000015: 'structures',
            44030000004: 'structures',
            44030000011: 'structures',
            44030000012: 'structures',
            44030000015: 'structures',
            44000000005: 'other',
        })
        self.assertEqual(MarketItem.objects.filter(enabled=True).count(), 22)

    def test_bundled_catalog_contains_all_requested_component_and_structure_rows(self):
        call_command(
            'market_seed_catalog', enable_buckets='components,structures', stdout=StringIO(),
        )

        self.assertEqual(MarketItem.objects.filter(market_bucket='components').count(), 58)
        self.assertEqual(MarketItem.objects.filter(market_bucket='structures').count(), 16)
        self.assertEqual(
            MarketItem.objects.filter(category_id=1700, market_bucket__in=['components', 'structures']).count(),
            0,
        )
        catalog_path = Path(__file__).resolve().parents[1] / 'data' / 'market_catalog.json'
        with catalog_path.open(encoding='utf-8') as source:
            rows = json.load(source)
        expected_components = {
            row['item_id'] for row in rows
            if '组件' in row['market_group_name_3rd'] and row['category_id'] != 1700
        }
        expected_structures = {
            44000000004, 44000000011, 44000000012, 44000000015,
            44010000004, 44010000011, 44010000012, 44010000015,
            44020000004, 44020000011, 44020000012, 44020000015,
            44030000004, 44030000011, 44030000012, 44030000015,
        }
        self.assertEqual(
            set(MarketItem.objects.filter(market_bucket='components').values_list('id', flat=True)),
            expected_components,
        )
        self.assertEqual(
            set(MarketItem.objects.filter(market_bucket='structures').values_list('id', flat=True)),
            expected_structures,
        )
        self.assertEqual(
            set(MarketItem.objects.filter(enabled=True).values_list('id', flat=True)),
            expected_components | expected_structures,
        )

    def test_incremental_enable_preserves_old_toggles_and_manual_buckets(self):
        MarketItem.objects.create(id=28007000000, name='伊甸币', market_bucket='currency', enabled=False)
        MarketItem.objects.create(id=41000000000, name='三钛合金', market_bucket='minerals', enabled=True)
        MarketItem.objects.create(id=27011000000, name='人工分类组件', market_bucket='minerals', enabled=False)

        call_command('market_seed_catalog', enable_buckets='components,structures', stdout=StringIO())

        self.assertFalse(MarketItem.objects.get(pk=28007000000).enabled)
        self.assertTrue(MarketItem.objects.get(pk=41000000000).enabled)
        manual = MarketItem.objects.get(pk=27011000000)
        self.assertEqual(manual.market_bucket, 'minerals')
        self.assertEqual(manual.name, '人工分类组件')
        self.assertFalse(manual.enabled)
