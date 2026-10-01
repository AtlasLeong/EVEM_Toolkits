"""Portable, synthetic regression fixtures; no client account/package required."""
import hashlib
import json
from pathlib import Path
import struct
import tempfile
import unittest
from unittest.mock import patch

from scripts.game_data.client_assets import build_item_image_library as build
from scripts.game_data.client_assets import verify_library as verify
from scripts.game_data.client_assets.decoder import load_decoder, DECODER_SHA256
from scripts.game_data.client_assets.verified_assets import ResourceStore, unwrap_layers
from scripts.game_data.client_assets.safe_fsd import UnsafeFsdError, parse_schema_pickle


def minimal_export(folder):
    """Real FSD fixture; only the unrelated binary THFB routing is substituted."""
    import pickle
    schema = {'keyTypes': {'type': 'long'}, 'valueTypes': {'type': 'object',
        'attributes': {'zh_name': {'type': 'string'}, 'published': {'type': 'int'}},
        'attributesWithVariableOffsets': ['zh_name', 'published'], 'optionalValueLookups': {'published': 1}}}
    encoded = pickle.dumps(schema, protocol=2)
    text = b'fixture'
    blob = struct.pack('<QII', 1, 0, 4 + len(text)) + struct.pack('<I', len(text)) + text + struct.pack('<i', 1)
    def fsd(records):
        footer = struct.pack('<I', len(records))
        payload = b''
        for key, value in records:
            footer += struct.pack('<qII', key, len(payload), len(value))
            payload += value
        return struct.pack('<I', len(encoded)) + encoded + struct.pack('<I', len(records)) + payload + footer + struct.pack('<I', len(footer))
    root = Path(folder)
    client, out = root / 'client', root / 'export'
    client.mkdir()
    out.mkdir()
    (out / 'tables').mkdir()
    (client / 'inroot.thx').write_bytes(b'thfb fixture routing is supplied below')
    thx_sha = hashlib.sha256((client / 'inroot.thx').read_bytes()).hexdigest()
    tables, lookup_rows = [], {}
    for shard in range(101):
        raw = fsd([(101, blob)] if shard == 0 else [])
        md5 = hashlib.md5(raw).hexdigest()
        table_path = f'staticdata/items/{shard}.sd'
        table = {'path': table_path, 'digest': md5,
                 'sha256': hashlib.sha256(raw).hexdigest(), 'records': int(shard == 0)}
        tables.append(table)
        lookup_rows[table_path] = {'digest': md5}
        (out / 'tables' / (md5 + '.sd')).write_bytes(raw)
    item = {'itemId': '101', 'name': 'fixture', 'fields': {'zh_name': 'fixture', 'published': 1},
            'tablePath': tables[0]['path'], 'tableMd5': tables[0]['digest'],
            'iconId': None, 'status': 'no-icon-reference'}
    files = {'summary.json': {'currentThxSha256': thx_sha, 'expectedItemTables': 101,
            'verifiedItemTables': 101, 'itemCount': 1, 'tableErrors': [],
            'itemStatuses': {'no-icon-reference': 1}, 'assetStatuses': {},
            'distinctVerifiedTextures': 0},
             'item-image-mapping.json': {'items': [item]}, 'assets.json': {'assets': []},
             'tables.json': tables, 'icon-path-overrides.json': {
                 'schemaVersion': 1, 'currentThxSha256': thx_sha, 'overrides': {}},
             'target-ships.json': []}
    for name, value in files.items():
        # CRLF/whitespace are deliberate: hashes must cover exact file bytes.
        (out / name).write_bytes((json.dumps(value) + '\r\n').encode('utf-8'))
    return client, out, lookup_rows, item, files


class ToolchainTests(unittest.TestCase):
    def test_override_evidence_rejects_different_client_snapshot(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            thx = root / 'inroot.thx'
            thx.write_bytes(b'new snapshot')
            evidence = root / 'routing.json'
            evidence.write_text(json.dumps({'schemaVersion': 1,
                'currentThxSha256': '0' * 64, 'overrides': {}}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'different resource snapshot'):
                build.load_overrides(evidence, thx)

    def test_no_override_file_never_reuses_old_snapshot_rules(self):
        with tempfile.TemporaryDirectory() as folder:
            thx = Path(folder) / 'inroot.thx'
            thx.write_bytes(b'new snapshot')
            report = build.load_overrides(None, thx)
            self.assertEqual(report['overrides'], {})
            self.assertEqual(report['currentThxSha256'], hashlib.sha256(b'new snapshot').hexdigest())

    def test_resource_store_accepts_arbitrary_client_and_apk_roots(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            client, apk = root / 'client copy', root / 'apk copy'
            client.mkdir()
            apk.mkdir()
            for location in [client, apk]:
                data = bytearray(36)
                data[:4] = b'SKPW'
                struct.pack_into('<I', data, 12, 0)
                (location / 'inroot.idx').write_bytes(data)
            store = ResourceStore(client, apk_root=apk, decoder_file=root / 'decoder.py')
            self.assertEqual(store.locations, [client.resolve(), apk.resolve()])
            self.assertEqual(store.decoder_file, (root / 'decoder.py').resolve())

    def test_direct_package_is_supported_without_research_raw_packages_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            digest = '1' * 32
            data = bytearray(72)
            data[:4] = b'SKPW'
            struct.pack_into('<I', data, 12, 1)
            data[32:48] = bytes.fromhex(digest)
            struct.pack_into('<III', data, 52, 2, 0, 8)
            struct.pack_into('<H', data, 64, 48)
            (root / 'inroot.idx').write_bytes(data)
            package = root / 'inroot2.wpk'
            package.write_bytes(b'fixture only')
            store = ResourceStore(root)
            self.assertEqual(store.entries[digest][0][0], package)

    def test_decoder_pin_checked_before_any_import_or_execution(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'untrusted.py'
            path.write_text('raise RuntimeError("must not execute")', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                load_decoder(path)
        self.assertEqual(len(DECODER_SHA256), 64)

    def test_decoder_executes_pinned_source_not_unpinned_bytecode_cache(self):
        import os
        import py_compile
        good = b'_HAS_AES=True\nmarker="good"\n'
        bad = b'_HAS_AES=True\nmarker="evil"\n'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'decoder.py'
            path.write_bytes(bad)
            before = path.stat()
            py_compile.compile(str(path), doraise=True)
            path.write_bytes(good)
            os.utime(path, (before.st_atime, before.st_mtime))
            with patch('scripts.game_data.client_assets.decoder.DECODER_SHA256', hashlib.sha256(good).hexdigest()):
                self.assertEqual(load_decoder(path).marker, 'good')

    def test_bundled_rules_resolve_only_by_exact_snapshot_hash(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            thx = root / 'inroot.thx'
            thx.write_bytes(b'new snapshot')
            routing = root / 'routing'
            routing.mkdir()
            self.assertIsNone(build.bundled_override(thx, routing_root=routing))
            exact = routing / (hashlib.sha256(thx.read_bytes()).hexdigest() + '.json')
            exact.write_text('{}', encoding='utf-8')
            self.assertEqual(build.bundled_override(thx, routing_root=routing), exact)

    def test_independent_verifier_accepts_variable_target_count(self):
        self.assertEqual(verify.verify_targets([], {}, expected_ids=None), 0)
        row = {'itemId': '42', 'status': 'verified'}
        self.assertEqual(verify.verify_targets([row], {'42': row}, expected_ids=['42']), 1)
        with self.assertRaisesRegex(ValueError, 'target'):
            verify.verify_targets([row], {'42': row}, expected_ids=['42', '43'])

    def test_optional_scope_is_not_tied_to_another_worktree(self):
        self.assertEqual(verify.scope_ids(None), set())
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'industry scope.json'
            path.write_text(json.dumps({'recipes': [{'productId': 42}],
                'items': [{'itemId': 43}]}), encoding='utf-8')
            self.assertEqual(verify.scope_ids(path), {'42', '43'})

    def test_export_paths_cannot_escape_the_selected_export(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            with self.assertRaisesRegex(ValueError, 'outside export'):
                verify.export_path(root, '../outside.png')

    def test_duplicate_png_route_still_checks_each_asset_metadata(self):
        from PIL import Image
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'same.png'
            Image.new('RGBA', (1, 1)).save(path)
            correct = {'pngSha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                       'width': 1, 'height': 1}
            cache = {}
            verify.verify_png_metadata(path, correct, cache)
            with self.assertRaisesRegex(ValueError, 'SHA-256'):
                verify.verify_png_metadata(path, dict(correct, pngSha256='0' * 64), cache)
            with self.assertRaisesRegex(ValueError, 'dimensions'):
                verify.verify_png_metadata(path, dict(correct, width=2), cache)

    def test_verifier_rejects_export_that_omits_real_optional_field(self):
        """Only binary THFB routing is substituted; FSD decode/comparison is real."""
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            client, out, lookup_rows, item, _ = minimal_export(folder)
            item['fields'].pop('published')
            (out / 'item-image-mapping.json').write_text(json.dumps({'items': [item]}), encoding='utf-8')
            with patch.object(verify, 'THFBPathLookup', return_value=SimpleNamespace(lookup=lookup_rows.__getitem__)):
                with self.assertRaisesRegex(ValueError, 'item fields differ'):
                    verify.verify_library(client, out)
                item['fields']['published'] = 1
                (out / 'item-image-mapping.json').write_text(json.dumps({'items': [item]}), encoding='utf-8')
                self.assertEqual(verify.verify_library(client, out)['itemRecordsChecked'], 1)

    def test_verification_report_binds_exact_consumed_json_bytes(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            client, out, lookup_rows, _, files = minimal_export(folder)
            expected = {name: hashlib.sha256((out / name).read_bytes()).hexdigest() for name in files}
            with patch.object(verify, 'THFBPathLookup', return_value=SimpleNamespace(lookup=lookup_rows.__getitem__)):
                report = verify.verify_library(client, out)
            self.assertEqual(report.get('sourceFilesSha256'), expected)
            self.assertNotIn('verification.json', report['sourceFilesSha256'])
            self.assertFalse((out / 'verification.json').exists())

    def test_verifier_refuses_json_changed_during_readonly_verification(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as folder:
            client, out, lookup_rows, _, _ = minimal_export(folder)
            changed = False
            def lookup(path):
                nonlocal changed
                if not changed:
                    assets = out / 'assets.json'
                    assets.write_bytes(assets.read_bytes() + b'\n ')
                    changed = True
                return lookup_rows[path]
            with patch.object(verify, 'THFBPathLookup', return_value=SimpleNamespace(lookup=lookup)):
                with self.assertRaisesRegex(ValueError, 'input changed during verification'):
                    verify.verify_library(client, out)
            self.assertFalse((out / 'verification.json').exists())

    def test_schema_reader_never_executes_pickle_globals(self):
        with self.assertRaises(UnsafeFsdError):
            parse_schema_pickle(b'\x80\x02csubprocess\nPopen\n.')

    def test_compressed_output_is_bounded(self):
        import zlib
        with self.assertRaisesRegex(ValueError, 'limit'):
            unwrap_layers(zlib.compress(b'x' * 8192), max_bytes=1024)


if __name__ == '__main__':
    unittest.main()
