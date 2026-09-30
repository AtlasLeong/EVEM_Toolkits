from unittest import TestCase


class ShipCatalogTests(TestCase):
    def test_client_catalog_maps_exact_hulls_not_ship_classes(self):
        from Killboard.catalog import ship_name

        self.assertEqual(ship_name(10500000601), '元帅级')
        self.assertEqual(ship_name('10500000408'), '万王宝座级海军型')
        self.assertEqual(ship_name(10500000308), '灾难级海军型')
        self.assertEqual(ship_name(10500011201), '阿撒兹勒级')

    def test_missing_invalid_and_non_ship_ids_do_not_invent_names(self):
        from Killboard.catalog import ship_name

        for value in (None, '', True, 0, -1, 123, 41000000000, 'not-an-id', 10500000601.5):
            with self.subTest(value=value):
                self.assertEqual(ship_name(value), '')

    def test_catalog_is_loaded_once_not_per_participant(self):
        from Killboard.catalog import ship_name
        from GameData.registry import clear_cache, _load_version

        clear_cache()
        for _ in range(103):
            self.assertEqual(ship_name(10500000601), '元帅级')
        self.assertEqual(_load_version.cache_info().misses, 1)
