from django.test import SimpleTestCase
from rest_framework.test import APIClient
import hashlib
import json
from pathlib import Path
import tempfile
from unittest.mock import patch


class SharedRegistryTests(SimpleTestCase):
    def test_verified_client_location_is_available_without_business_database(self):
        registry = self.subject()
        location = registry.location_record(33007327)
        self.assertEqual(location['system_name'], 'NI-D1003327')
        self.assertEqual(location['constellation_id'], 22000099)
        self.assertEqual(location['constellation_name'], 'EI-S1238')
        self.assertEqual(location['region_id'], 12000009)
        self.assertEqual(location['region_name'], 'EI-S11907')

    def test_location_does_not_substitute_regional_security_for_missing_system_security(self):
        registry = self.subject()
        payload = {'locations': {'33007327': {'system_name': 'NI-D1003327',
            'constellation_id': 22000099, 'constellation_name': 'EI-S1238',
            'region_id': 12000009, 'region_name': 'EI-S11907', 'region_security': 0.7}}}
        self.assertIsNone(registry.location_record(33007327, catalog=payload)['security_status'])
        for value in (True, None, '../33007327', 33007328):
            self.assertIsNone(registry.location_record(value, catalog=payload))

    def test_item_name_uses_exact_localized_client_text_and_retains_raw_template(self):
        registry = self.subject()
        row = registry.item_record(11302300025)
        self.assertEqual(row['name'], '皮特丙型 自适应全能力场')
        self.assertIn('{module_affix:', row['raw_name'])
        self.assertEqual(row['name_localization']['locale'], 'zhcn')
        self.assertRegex(row['name_localization']['table_sha256'], r'^[0-9a-f]{64}$')
        self.assertNotIn('C:', str(row['name_localization']))

    def test_npc_identity_requires_the_exact_client_npc_record(self):
        registry = self.subject()
        valid = {'items': {'56000171040': {
            'name': '科尔', 'image_status': 'no-icon-reference',
            'client_category_id': 56,
        }}, 'assets': {}}
        self.assertEqual(registry.npc_identity(56000171040, catalog=valid)['name'], '科尔')
        self.assertIsNone(registry.npc_identity(56000171040, catalog={'items': {}, 'assets': {}}))
        self.assertIsNone(registry.npc_identity(11004320024, catalog={'items': {
            '11004320024': {'name': '普通武器', 'image_status': 'verified', 'client_category_id': 11},
        }, 'assets': {}}))

    def subject(self):
        import importlib.util
        self.assertIsNotNone(importlib.util.find_spec('GameData.registry'), 'The common catalog must be independent of Killboard')
        from GameData import registry
        return registry

    def test_catalog_provides_exact_name_image_and_source_chain(self):
        catalog = self.subject()
        row = catalog.item_record('10706000201')
        self.assertEqual(row['name'], '瓦沙克级')
        metadata = catalog.image_metadata('10706000201')
        self.assertRegex(metadata['path'], r'^/images/game-items/[0-9a-f]{64}\.png$')
        self.assertEqual(metadata['imageRole'], 'item-icon')
        source = catalog.item_provenance('10706000201')
        self.assertTrue(source['asset']['logical_path'].startswith('gui_v1/'))
        self.assertEqual(len(source['asset']['png_sha256']), 64)
        self.assertEqual(len(source['source']['client_thx_sha256']), 64)
        self.assertTrue(source['table']['logical_path'].startswith('staticdata/items/'))

    def test_invalid_ids_and_missing_images_do_not_get_substitutes(self):
        catalog = self.subject()
        for key in (True, None, '', '../1', '１２３', -1, 0, 1.1, 2**63):
            self.assertIsNone(catalog.item_record(key))
            self.assertEqual(catalog.image_url(key), '')
        self.assertEqual(catalog.image_url(99999999999), '')

    def test_existing_module_adapters_share_exact_common_records(self):
        catalog = self.subject()
        from Killboard.image_catalog import image_url
        from Killboard.catalog import ship_name
        self.assertEqual(image_url(10500000601), catalog.image_url(10500000601))
        self.assertEqual(ship_name(10500000601), '元帅级')

    def test_public_lookup_is_bounded_and_does_not_expose_local_source_paths(self):
        self.subject()
        client = APIClient()
        response = client.get('/api/game-data/items/', {'ids': '10706000201,10607001409'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 2)
        self.assertEqual(response.data['results'][0]['name'], '瓦沙克级')
        self.assertNotIn('source_package', str(response.data))
        self.assertNotIn('C:', str(response.data))
        self.assertEqual(client.get('/api/game-data/items/', {'ids': ','.join(str(i) for i in range(1, 102))}).status_code, 400)
        self.assertEqual(client.get('/api/game-data/items/', {'page_size': 101}).status_code, 400)
        self.assertEqual(client.get('/api/game-data/items/', {'version': '../1'}).status_code, 400)

    def test_explicit_revision_is_cacheable_and_bad_revision_is_not_found(self):
        catalog = self.subject()
        client = APIClient()
        version = catalog.catalog_status()['revision']
        response = client.get('/api/game-data/items/10706000201/', {'version': version})
        self.assertEqual(response.status_code, 200)
        self.assertIn('immutable', response['Cache-Control'])
        cached = client.get('/api/game-data/items/10706000201/', {'version': version}, HTTP_IF_NONE_MATCH=response['ETag'])
        self.assertEqual(cached.status_code, 304)
        self.assertEqual(client.get('/api/game-data/items/10706000201/', {'version': 'a' * 64}).status_code, 404)

    def test_unavailable_version_is_not_negative_cached_or_cached_as_empty_success(self):
        catalog = self.subject()
        self.addCleanup(catalog.clear_cache)
        version = 'b' * 64
        blob = json.dumps({'schema_version': 1, 'revision': version, 'items': {'1': {'name': 'Recovered'}}, 'assets': {}}).encode()
        with tempfile.TemporaryDirectory() as folder, patch.object(catalog, 'DATA_ROOT', Path(folder)):
            root = Path(folder)
            (root / 'versions').mkdir()
            (root / 'current.json').write_text(json.dumps({'schema_version': 1, 'revision': version, 'versions': [version],
                'catalog_sha256': hashlib.sha256(blob).hexdigest(), 'version_hashes': {version: hashlib.sha256(blob).hexdigest()}}))
            catalog.clear_cache()
            client = APIClient()
            response = client.get('/api/game-data/items/', {'version': version})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response['Cache-Control'], 'no-store')
            (root / 'versions' / f'{version}.json').write_bytes(blob)
            self.assertEqual(client.get('/api/game-data/items/1/', {'version': version}).data['name'], 'Recovered')
        catalog.clear_cache()

    def test_historical_catalog_checksum_failure_is_not_served(self):
        catalog = self.subject()
        self.addCleanup(catalog.clear_cache)
        active, old = 'c' * 64, 'd' * 64
        with tempfile.TemporaryDirectory() as folder, patch.object(catalog, 'DATA_ROOT', Path(folder)):
            root = Path(folder)
            (root / 'versions').mkdir()
            corrupt = json.dumps({'schema_version': 1, 'revision': old, 'items': {}})
            (root / 'versions' / f'{old}.json').write_text(corrupt)
            (root / 'current.json').write_text(json.dumps({'schema_version': 1, 'revision': active, 'versions': [active, old],
                'catalog_sha256': 'e' * 64, 'version_hashes': {old: 'f' * 64}}))
            catalog.clear_cache()
            response = APIClient().get('/api/game-data/items/', {'version': old})
            self.assertEqual(response.status_code, 503)
        catalog.clear_cache()

    def test_non_market_client_hulls_are_available_in_ship_lookup(self):
        self.subject()
        from Killboard.catalog import ship_name
        self.assertEqual(ship_name(10100000103), '矮脚鸡级')
        response = APIClient().get('/api/game-data/items/', {'kind': 'ships', 'q': '矮脚鸡级'})
        self.assertTrue(any(row['item_id'] == '10100000103' for row in response.data['results']))

    def test_request_pins_catalog_revision_for_results_and_etag(self):
        catalog = self.subject()
        version = '1' * 64
        payload = {'items': {'1': {'name': 'Pinned', 'current': True}}, 'assets': {}}
        with patch.object(catalog, 'catalog_snapshot', return_value=(version, payload)) as snapshot, \
                patch.object(catalog, 'catalog_status', side_effect=AssertionError('Do not re-read current revision')):
            response = APIClient().get('/api/game-data/items/')
        self.assertEqual(response.status_code, 200)
        snapshot.assert_called_once_with(None)
        self.assertEqual(response.data['revision'], version)
        self.assertEqual(response.data['results'][0]['name'], 'Pinned')
        expected = hashlib.sha256(f'{version}:/api/game-data/items/'.encode()).hexdigest()
        self.assertEqual(response['ETag'], f'"{expected}"')
        self.assertNotIn('immutable', response['Cache-Control'])

    def test_public_search_has_its_own_bounded_request_rate(self):
        from GameData import views
        self.assertTrue(hasattr(views, 'CatalogThrottle'))
        with patch.object(views.CatalogThrottle, 'rate', '1/minute'):
            client = APIClient(REMOTE_ADDR='203.0.113.201')
            self.assertEqual(client.get('/api/game-data/items/', {'q': '元帅'}).status_code, 200)
            response = client.get('/api/game-data/items/', {'q': '元帅'})
            self.assertEqual(response.status_code, 429)
            self.assertIn('Retry-After', response)

    def test_initial_catalog_versions_keep_client_ship_classification(self):
        catalog = self.subject()
        legacy = {'items': {'10706000201': {'name': '瓦沙克级', 'current': True}}, 'assets': {}}
        count, rows = catalog.find_items(kind='ships', catalog=legacy)
        self.assertEqual(count, 1)
        self.assertEqual(rows[0]['entity_kind'], 'ships')
        self.assertEqual(rows[0]['client_category_id'], 10)
