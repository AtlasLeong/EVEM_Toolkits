import base64
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[2] / 'sync_game_data.py'


class SharedCatalogImportTests(unittest.TestCase):
    def display_export(self, *, security=None):
        root = self.root / 'display'
        root.mkdir(exist_ok=True)
        payload = {'schemaVersion': 1, 'currentThxSha256': 'a' * 64,
            'names': {'123': {'name': '皮特丙型 自适应全能力场',
                'raw_name': '{module_affix:皮特C} {module:自适应全能力场}',
                'name_localization': {'locale': 'zhcn', 'message_id': 611508,
                    'logical_path': 'staticdata/gettext/zhcn/611.sd', 'table_sha256': 'a' * 64}}},
            'locations': {'33007327': {'system_name': 'NI-D1003327', 'constellation_id': 22000099,
                'constellation_name': 'EI-S1238', 'region_id': 12000009, 'region_name': 'EI-S11907',
                'security_status': security}}, 'camouflage': {},
            'tables': {'sigmadata/eve/universe/gettext.sd': {'md5': 'b' * 32, 'sha256': 'c' * 64}},
            'method': 'exact client static lookup'}
        raw = json.dumps(payload, ensure_ascii=False).encode('utf-8')
        (root / 'client-display.json').write_bytes(raw)
        report = {'schemaVersion': 1, 'errors': [],
            'sourceFilesSha256': {'client-display.json': hashlib.sha256(raw).hexdigest()},
            'nameRecordsChecked': 1, 'locationRecordsChecked': 1, 'camouflageRecordsChecked': 0}
        (root / 'display-verification.json').write_text(json.dumps(report), encoding='utf-8')
        return root

    def test_verified_display_export_adds_names_locations_and_immutable_provenance(self):
        self.export(name='{module_affix:皮特C} {module:自适应全能力场}')
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        old_bytes = (self.data / 'versions' / f"{first['revision']}.json").read_bytes()
        display = self.display_export(security=-0.5)
        second = sync(self.source, self.catalog, self.data, self.images, display_root=display)
        payload = json.loads((self.data / 'versions' / f"{second['revision']}.json").read_bytes())
        self.assertEqual(payload['items']['123']['name'], '皮特丙型 自适应全能力场')
        self.assertEqual(payload['items']['123']['raw_name'], '{module_affix:皮特C} {module:自适应全能力场}')
        self.assertEqual(payload['locations']['33007327']['security_status'], -0.5)
        source = payload['sources'][second['revision']]
        self.assertEqual(source['display_data']['method'], 'exact client static lookup')
        self.assertEqual(source['source_files_sha256']['client-display.json'],
            hashlib.sha256((display / 'client-display.json').read_bytes()).hexdigest())
        self.assertEqual((self.data / 'versions' / f"{first['revision']}.json").read_bytes(), old_bytes)
        self.assertEqual(sync(self.source, self.catalog, self.data, self.images, display_root=display), second)

    def test_display_snapshot_and_modified_verification_fail_before_pointer_changes(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        display = self.display_export()
        (display / 'client-display.json').write_bytes(b'{}')
        with self.assertRaisesRegex(ValueError, 'display.*checksum'):
            sync(self.source, self.catalog, self.data, self.images, display_root=display)
        self.assertEqual(json.loads((self.data / 'current.json').read_bytes())['revision'], first['revision'])

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'export'
        self.source.mkdir()
        (self.source / 'images').mkdir()
        self.data = self.root / 'data'
        self.images = self.root / 'public' / 'images' / 'game-items'
        self.catalog = self.root / 'market.json'
        self.catalog.write_text(json.dumps([{'item_id': 123, 'item_name': '旧名称', 'category_id': 1000, 'subcategory_id': 1}]), encoding='utf-8')

    def subject(self):
        self.assertTrue(SCRIPT.is_file(), 'A site-wide catalog importer is required')
        spec = importlib.util.spec_from_file_location('sync_game_data', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def export(self, ids=(123, 124), name='舰船一', snapshot='a'):
        png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=')
        digest = 'b' * 32
        (self.source / 'images' / f'{digest}.png').write_bytes(png)
        rows = [{'itemId': str(i), 'name': name if i == 123 else '物品二', 'fields': {'icon_id': 99},
                 'tablePath': 'staticdata/items/0.sd', 'tableMd5': 'c' * 32, 'iconId': '99',
                 'logicalIconPath': 'gui_v1/icon/item/99.ktx', 'status': 'verified',
                 'textureMd5': digest, 'image': f'images/{digest}.png', 'imageRole': 'item-icon'} for i in ids]
        values = {
            'item-image-mapping.json': {'schemaVersion': 1, 'items': rows},
            'summary.json': {'currentThxSha256': snapshot * 64, 'itemCount': len(rows), 'expectedItemTables': 1, 'verifiedItemTables': 1, 'tableErrors': []},
            'verification.json': {'errors': [], 'itemRecordsChecked': len(rows), 'uniquePNGsReopenedAndHashChecked': 1},
            'assets.json': {'assets': [{'logicalPath': 'gui_v1/icon/item/99.ktx', 'digest': digest, 'image': f'images/{digest}.png',
                                      'status': 'verified', 'pngSha256': hashlib.sha256(png).hexdigest(), 'textureSha256': 'd' * 64,
                                      'textureMd5Verified': True, 'textureSizeVerified': True, 'width': 1, 'height': 1,
                                      'source': '/client/res/inroot2.wpk'}]},
            'tables.json': [{'path': 'staticdata/items/0.sd', 'digest': 'c' * 32, 'sha256': 'e' * 64, 'source': '/client/res/inroot0.wpk'}],
        }
        for path, value in values.items():
            (self.source / path).write_text(json.dumps(value, ensure_ascii=False), encoding='utf-8')
        self.bind_verification()

    def bind_verification(self):
        path = self.source / 'verification.json'
        report = json.loads(path.read_text(encoding='utf-8'))
        names = ('summary.json', 'item-image-mapping.json', 'assets.json', 'tables.json',
                 'icon-path-overrides.json', 'target-ships.json')
        report['sourceFilesSha256'] = {name: hashlib.sha256((self.source / name).read_bytes()).hexdigest()
                                     for name in names if (self.source / name).is_file()}
        path.write_text(json.dumps(report), encoding='utf-8')

    def test_revisions_retain_removed_items_and_original_names(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        self.export(ids=(123,), name='舰船新版', snapshot='f')
        second = sync(self.source, self.catalog, self.data, self.images)
        self.assertNotEqual(first['revision'], second['revision'])
        old = json.loads((self.data / 'versions' / f"{first['revision']}.json").read_text(encoding='utf-8'))
        new = json.loads((self.data / 'versions' / f"{second['revision']}.json").read_text(encoding='utf-8'))
        self.assertEqual(old['items']['123']['name'], '舰船一')
        self.assertEqual(new['items']['123']['name'], '舰船新版')
        self.assertFalse(new['items']['124']['current'])
        self.assertEqual(new['items']['124']['source_revision'], first['revision'])
        self.assertEqual(len(second['versions']), 2)

    def test_corrupt_png_refuses_to_replace_current_catalog(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        (self.source / 'images' / f"{'b' * 32}.png").write_bytes(b'corrupt')
        with self.assertRaisesRegex(ValueError, 'PNG'):
            sync(self.source, self.catalog, self.data, self.images)
        self.assertEqual(json.loads((self.data / 'current.json').read_text())['revision'], first['revision'])

    def test_repeated_import_is_idempotent_and_keeps_exact_provenance(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        again = sync(self.source, self.catalog, self.data, self.images)
        self.assertEqual(first, again)
        payload = json.loads((self.data / 'versions' / f"{first['revision']}.json").read_text(encoding='utf-8'))
        row = payload['items']['123']
        self.assertEqual(row['name'], '舰船一')
        self.assertEqual(row['category_id'], 1000)
        self.assertEqual(row['table_path'], 'staticdata/items/0.sd')
        asset = payload['assets'][row['asset_key']]
        self.assertEqual(asset['logical_path'], 'gui_v1/icon/item/99.ktx')
        self.assertEqual(asset['source_package'], '/client/res/inroot2.wpk')
        self.assertEqual(len(asset['png_sha256']), 64)
        self.assertEqual(len(list(self.images.glob('*.png'))), 1)

    def test_incomplete_export_does_not_create_a_current_pointer(self):
        self.export()
        verification = self.source / 'verification.json'
        verification.write_text(json.dumps({'errors': ['missing table']}))
        with self.assertRaisesRegex(ValueError, 'verification'):
            self.subject().sync_game_data(self.source, self.catalog, self.data, self.images)
        self.assertFalse((self.data / 'current.json').exists())

    def test_reimporting_old_export_keeps_intervening_new_items(self):
        self.export(ids=(123,))
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        self.export(ids=(123, 124), snapshot='f')
        sync(self.source, self.catalog, self.data, self.images)
        self.export(ids=(123,))
        restored = sync(self.source, self.catalog, self.data, self.images)
        self.assertNotEqual(restored['revision'], first['revision'])
        payload = json.loads((self.data / 'versions' / f"{restored['revision']}.json").read_text(encoding='utf-8'))
        self.assertIn('124', payload['items'])
        self.assertFalse(payload['items']['124']['current'])
        self.assertEqual(len(restored['version_hashes']), 3)

    def test_new_client_hull_is_classified_without_market_entry(self):
        self.export(ids=(10100000103,))
        result = self.subject().sync_game_data(self.source, self.catalog, self.data, self.images)
        payload = json.loads((self.data / 'versions' / f"{result['revision']}.json").read_text(encoding='utf-8'))
        row = payload['items']['10100000103']
        self.assertEqual(row['entity_kind'], 'ships')
        self.assertEqual(row['client_category_id'], 10)
        self.assertIsNone(row['category_id'])

    def test_corrupt_unpublished_revision_cannot_be_trusted_on_retry(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        # Simulate interruption after writing version but before switching pointer.
        (self.data / 'current.json').unlink()
        path = self.data / 'versions' / f"{first['revision']}.json"
        payload = json.loads(path.read_text(encoding='utf-8'))
        payload['items']['123']['name'] = 'Corrupted'
        path.write_text(json.dumps(payload, ensure_ascii=False), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Immutable'):
            sync(self.source, self.catalog, self.data, self.images)
        self.assertFalse((self.data / 'current.json').exists())

    def test_corrupt_historical_revision_blocks_new_publication(self):
        self.export()
        sync = self.subject().sync_game_data
        first = sync(self.source, self.catalog, self.data, self.images)
        self.export(snapshot='f')
        second = sync(self.source, self.catalog, self.data, self.images)
        (self.data / 'versions' / f"{first['revision']}.json").write_bytes(b'corrupt')
        self.export(name='舰船更新')
        with self.assertRaisesRegex(ValueError, 'Historical catalog checksum'):
            sync(self.source, self.catalog, self.data, self.images)
        self.assertEqual(json.loads((self.data / 'current.json').read_text())['revision'], second['revision'])

    def test_maintained_toolchain_and_routing_input_are_recorded(self):
        self.export()
        summary_file = self.source / 'summary.json'
        summary = json.loads(summary_file.read_text(encoding='utf-8'))
        summary['toolchain'] = {'clientRoot': '/private/client', 'decoderFile': '/private/decoder.py',
                                'decoderSha256': 'f' * 64, 'decoderUpstreamCommit': 'reviewed-commit'}
        summary_file.write_text(json.dumps(summary), encoding='utf-8')
        evidence = self.source / 'icon-path-overrides.json'
        evidence.write_text(json.dumps({'currentThxSha256': 'a' * 64, 'overrides': {}}), encoding='utf-8')
        self.bind_verification()
        result = self.subject().sync_game_data(self.source, self.catalog, self.data, self.images)
        payload = json.loads((self.data / 'versions' / f"{result['revision']}.json").read_text(encoding='utf-8'))
        source = payload['sources'][result['revision']]
        self.assertEqual(source['toolchain']['decoderSha256'], 'f' * 64)
        self.assertEqual(source['toolchain']['clientRoot'], '/private/client')
        self.assertEqual(source['source_files_sha256']['icon-path-overrides.json'], hashlib.sha256(evidence.read_bytes()).hexdigest())
        self.assertIn('scripts/game_data/client_assets/decoder.py', source['toolchain_files_sha256'])

    def test_checksum_supports_python310_without_file_digest(self):
        module = self.subject()
        path = self.root / 'content.bin'
        path.write_bytes(b'content')
        with patch.object(hashlib, 'file_digest', None, create=True):
            self.assertEqual(module.checksum(path), hashlib.sha256(b'content').hexdigest())

    def test_stale_success_report_cannot_publish_modified_export(self):
        self.export()
        path = self.source / 'item-image-mapping.json'
        payload = json.loads(path.read_text(encoding='utf-8'))
        payload['items'][0]['name'] = 'Changed after verification'
        path.write_text(json.dumps(payload), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Verification input checksum'):
            self.subject().sync_game_data(self.source, self.catalog, self.data, self.images)
        self.assertFalse((self.data / 'current.json').exists())

    def test_maintained_exports_require_bound_verification(self):
        self.export()
        summary_path = self.source / 'summary.json'
        summary = json.loads(summary_path.read_text(encoding='utf-8'))
        summary['toolchain'] = {'entrypoint': 'python -m scripts.game_data.client_assets.build_item_image_library'}
        summary_path.write_text(json.dumps(summary), encoding='utf-8')
        verification_path = self.source / 'verification.json'
        report = json.loads(verification_path.read_text(encoding='utf-8'))
        del report['sourceFilesSha256']
        verification_path.write_text(json.dumps(report), encoding='utf-8')
        with self.assertRaisesRegex(ValueError, 'Bound verification'):
            self.subject().sync_game_data(self.source, self.catalog, self.data, self.images)


if __name__ == '__main__':
    unittest.main()
