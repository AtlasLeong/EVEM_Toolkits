"""Publish verified client data for every site module, preserving revisions.

Run the client extractor and independent verifier before this importer. Raw
client packages and machine-local paths are never copied into the web root.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import struct
import tempfile


ROOT = Path(__file__).resolve().parents[1]
EXPORT = ROOT / 'output/client-ship-assets/maintained-export-20260930'
DATA = ROOT / 'backend/GameData/data'
IMAGES = ROOT / 'front-codex/public/images/game-items'
MARKET = ROOT / 'backend/Market/data/market_catalog.json'
INPUTS = ('summary.json', 'verification.json', 'item-image-mapping.json', 'assets.json', 'tables.json')
IMPORTER_FORMAT = 3
MD5 = re.compile(r'^[0-9a-f]{32}$')
SHA256 = re.compile(r'^[0-9a-f]{64}$')


def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')) + '\n').encode('utf-8')


def checksum(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix='.catalog-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(content)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, 0o644)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)


def source_path(value):
    """Keep reproducible repo paths; retain external client package paths as evidence."""
    value = str(value or '').replace('\\', '/')
    prefix = ROOT.as_posix() + '/'
    return value[len(prefix):] if value.startswith(prefix) else value


def load_current(data_root):
    path = data_root / 'current.json'
    if not path.exists():
        return None, {}
    pointer = read_json(path)
    revision = pointer.get('revision', '')
    if not isinstance(revision, str) or not SHA256.fullmatch(revision):
        raise ValueError('Invalid current catalog revision')
    version = data_root / 'versions' / f'{revision}.json'
    if checksum(version) != pointer.get('catalog_sha256'):
        raise ValueError('Current catalog checksum mismatch')
    versions = pointer.get('versions', [])
    if not isinstance(versions, list) or revision not in versions:
        raise ValueError('Invalid catalog version history')
    hashes = dict(pointer.get('version_hashes', {}))
    # A legacy pointer can authenticate its current version only. Do not bless
    # unverified historical bytes as a new trusted checksum during migration.
    hashes.setdefault(revision, pointer['catalog_sha256'])
    for old_revision in versions:
        expected = hashes.get(old_revision, '')
        if not isinstance(old_revision, str) or not SHA256.fullmatch(old_revision):
            raise ValueError('Invalid historical catalog revision')
        if not isinstance(expected, str) or not SHA256.fullmatch(expected):
            raise ValueError('Historical catalog checksum unavailable; restore verified history')
        if checksum(data_root / 'versions' / f'{old_revision}.json') != expected:
            raise ValueError('Historical catalog checksum mismatch')
    pointer['version_hashes'] = hashes
    return pointer, read_json(version)


def sync_game_data(source_root=EXPORT, catalog_path=MARKET, data_root=DATA, frontend_root=IMAGES):
    source_root, catalog_path, data_root, frontend_root = map(Path, (source_root, catalog_path, data_root, frontend_root))
    raw_inputs = {name: (source_root / name).read_bytes() for name in INPUTS}
    inputs = {name: json.loads(raw) for name, raw in raw_inputs.items()}
    summary, verification = inputs['summary.json'], inputs['verification.json']
    rows = inputs['item-image-mapping.json']['items']
    if (verification.get('errors') != [] or summary.get('tableErrors') != []
            or summary.get('expectedItemTables') != summary.get('verifiedItemTables')
            or summary.get('itemCount') != len(rows) or verification.get('itemRecordsChecked') != len(rows)):
        raise ValueError('Client export verification incomplete or inconsistent')
    thx_hash = summary.get('currentThxSha256', '')
    if not isinstance(thx_hash, str) or not SHA256.fullmatch(thx_hash):
        raise ValueError('Missing client snapshot SHA-256')
    input_hashes = {name: hashlib.sha256(raw).hexdigest() for name, raw in raw_inputs.items()}
    for name in ('icon-path-overrides.json', 'target-ships.json'):
        if (source_root / name).is_file():
            input_hashes[name] = checksum(source_root / name)
    bound = verification.get('sourceFilesSha256')
    maintained = summary.get('toolchain', {}).get('entrypoint') == 'python -m scripts.game_data.client_assets.build_item_image_library'
    if bound is None and maintained:
        raise ValueError('Bound verification is required for maintained client exports')
    if bound is not None:
        expected_inputs = {name: digest for name, digest in input_hashes.items() if name != 'verification.json'}
        if not isinstance(bound, dict) or bound != expected_inputs:
            raise ValueError('Verification input checksum mismatch; re-verify the unchanged export')
    market_raw = catalog_path.read_bytes()
    input_hashes['market_catalog.json'] = hashlib.sha256(market_raw).hexdigest()
    input_hashes['importer_format'] = str(IMPORTER_FORMAT)
    toolchain_root = ROOT / 'scripts/game_data/client_assets'
    toolchain_files = {source_path(path): checksum(path) for path in sorted(toolchain_root.glob('*.py'))}
    toolchain_files[source_path(Path(__file__))] = checksum(Path(__file__))
    input_hashes['toolchain_code_sha256'] = hashlib.sha256(encoded(toolchain_files)).hexdigest()
    previous_pointer, previous = load_current(data_root)
    current_source = previous.get('sources', {}).get(previous_pointer['revision'], {}) if previous_pointer else {}
    same_input = current_source.get('source_files_sha256') == input_hashes
    revision = (previous_pointer['revision'] if same_input else hashlib.sha256(encoded({
        'inputs': input_hashes, 'parent': previous_pointer['revision'] if previous_pointer else None,
    })).hexdigest())
    market = {str(row['item_id']): row for row in json.loads(market_raw)}
    assets_by_path = {row['logicalPath']: row for row in inputs['assets.json']['assets']}
    table_rows = {row['path']: row for row in inputs['tables.json']}
    items, assets, tables, files = {}, {}, {}, {}
    for row in rows:
        key = row.get('itemId', '')
        if not isinstance(key, str) or not key.isascii() or not key.isdecimal() or not 0 < int(key) <= 2**63 - 1 or key in items:
            raise ValueError('Invalid or duplicate client item ID')
        table_path = row.get('tablePath')
        table = table_rows.get(table_path)
        if table is None or row.get('tableMd5') != table.get('digest'):
            raise ValueError(f'Item {key} has no exact static table evidence')
        table_key = f"{revision}:{table_path}"
        tables[table_key] = {'logical_path': table_path, 'md5': table['digest'], 'sha256': table.get('sha256'), 'source_package': source_path(table.get('source'))}
        known = market.get(key, {})
        item = {'name': row.get('name') or '', 'category_id': known.get('category_id'),
                'client_category_id': int(key) // 1000000000, 'client_group_id': int(key) // 1000000,
                'entity_kind': 'ships' if int(key) // 1000000000 == 10 else 'items',
                'subcategory_id': known.get('subcategory_id'), 'category_label': known.get('market_group_name_3rd', ''),
                'market_group_id': row.get('fields', {}).get('market_group_id'),
                'current': True, 'source_revision': revision, 'table_path': table_path, 'table_key': table_key,
                'icon_id': row.get('iconId'), 'image_status': row.get('status'),
                'image_role': row.get('imageRole', ''), 'image_warning': row.get('compositeWarning'), 'asset_key': None}
        if row.get('status') == 'verified':
            asset = assets_by_path.get(row.get('logicalIconPath'))
            digest = row.get('textureMd5', '')
            if (asset is None or asset.get('status') != 'verified' or not MD5.fullmatch(digest)
                    or asset.get('digest') != digest or not asset.get('textureMd5Verified') or not asset.get('textureSizeVerified')
                    or row.get('image') != f'images/{digest}.png' or asset.get('image') != row.get('image')):
                raise ValueError(f'Item {key} has no verified texture evidence')
            png_hash = asset.get('pngSha256', '')
            texture_hash = asset.get('textureSha256', '')
            if not SHA256.fullmatch(png_hash) or not SHA256.fullmatch(texture_hash):
                raise ValueError(f'Item {key} has no PNG/texture SHA-256')
            source = source_root / 'images' / f'{digest}.png'
            if png_hash not in files:
                if checksum(source) != png_hash:
                    raise ValueError(f'PNG checksum mismatch for item {key}')
                with source.open('rb') as stream:
                    header = stream.read(24)
                if (len(header) != 24 or header[:8] != b'\x89PNG\r\n\x1a\n' or header[12:16] != b'IHDR'
                        or struct.unpack('>II', header[16:24]) != (asset.get('width'), asset.get('height'))):
                    raise ValueError(f'PNG dimensions/header mismatch for item {key}')
                files[png_hash] = source
            asset_key = f"{revision}:{digest}:{row['logicalIconPath']}"
            assets[asset_key] = {'path': f'/images/game-items/{png_hash}.png', 'logical_path': row['logicalIconPath'],
                                 'texture_md5': digest, 'texture_sha256': texture_hash, 'png_sha256': png_hash,
                                 'source_package': source_path(asset.get('source')), 'width': asset['width'], 'height': asset['height'],
                                 'export_path': row['image'], 'routing_evidence': row.get('routingEvidence')}
            item['asset_key'] = asset_key
        items[key] = item
    if len(files) != verification.get('uniquePNGsReopenedAndHashChecked'):
        raise ValueError('PNG verification count differs from catalog')
    # Retired IDs stay available and keep the provenance of their last source.
    retained = {key: {**value, 'current': False} for key, value in previous.get('items', {}).items() if key not in items}
    items = {**retained, **items}
    needed = {row['asset_key'] for row in retained.values() if row.get('asset_key')}
    assets.update({key: value for key, value in previous.get('assets', {}).items() if key in needed})
    needed_tables = {row['table_key'] for row in retained.values()}
    tables.update({key: value for key, value in previous.get('tables', {}).items() if key in needed_tables})
    provenance = {'client_thx_sha256': thx_hash, 'source_export': source_path(source_root),
                  'source_files_sha256': input_hashes, 'catalog_source': source_path(catalog_path),
                  'extraction_method': 'staticdata/items -> icon_id -> THX logical path -> MD5 resource -> WPK AC/DTSZ -> KTX ASTC -> RGBA PNG',
                  'extraction_script': 'scripts/game_data/client_assets/build_item_image_library.py',
                  'verification_script': 'scripts/game_data/client_assets/verify_library.py',
                  'toolchain_files_sha256': toolchain_files,
                  'toolchain': summary.get('toolchain', {}),
                  'client_resource_path': '/sdcard/Android/data/com.netease.EVE/files/neox/Documents/cloudfiles/res',
                  'classification_method': 'client evetypes/item_data: category_id = type_id // 1000000000; group_id = type_id // 1000000; ship category 10',
                  'classification_evidence': 'scripts/game_data/client_assets/README.md',
                  'image_scope': 'exact client configuration references; includes non-tradable and unpublished records'}
    sources = {**previous.get('sources', {}), revision: provenance}
    payload = {'schema_version': 1, 'revision': revision, 'sources': sources, 'items': items, 'assets': assets, 'tables': tables}
    blob = encoded(payload)
    version_file = data_root / 'versions' / f'{revision}.json'
    # Copy by PNG content hash; same-sized corruption is repaired as well.
    frontend_root.mkdir(parents=True, exist_ok=True)
    for digest, source in files.items():
        target = frontend_root / f'{digest}.png'
        if not target.exists() or checksum(target) != digest:
            atomic_write(target, source.read_bytes())
    for png_hash in {asset['png_sha256'] for asset in assets.values()}:
        target = frontend_root / f'{png_hash}.png'
        if not target.is_file() or checksum(target) != png_hash:
            raise ValueError('Retained PNG is missing or corrupt')
    if version_file.exists():
        # A publication revision includes its parent; an old export imported
        # after intervening updates creates a new immutable merged revision.
        if version_file.read_bytes() != blob:
            raise ValueError('Immutable catalog revision collision')
    else:
        atomic_write(version_file, blob)
    if previous_pointer and same_input:
        if previous_pointer['catalog_sha256'] != hashlib.sha256(blob).hexdigest():
            raise ValueError('Immutable catalog checksum changed')
        return previous_pointer
    versions = list(previous_pointer.get('versions', [])) if previous_pointer else []
    if revision not in versions:
        versions.append(revision)
    old_items = previous.get('items', {})
    version_hashes = dict(previous_pointer.get('version_hashes', {})) if previous_pointer else {}
    version_hashes[revision] = hashlib.sha256(blob).hexdigest()
    pointer = {'schema_version': 1, 'revision': revision, 'catalog_sha256': hashlib.sha256(blob).hexdigest(),
               'updated_at': datetime.now(timezone.utc).isoformat(), 'versions': versions, 'version_hashes': version_hashes,
               'item_count': len(payload['items']), 'current_item_count': sum(row['current'] for row in payload['items'].values()),
               'image_item_count': sum(bool(row.get('asset_key')) for row in payload['items'].values()),
               'unique_image_count': len({row['png_sha256'] for row in payload['assets'].values()}),
               'changes': {'added': len(set(items) - set(old_items)), 'retained': len(retained),
                           'updated': sum(key in old_items and row['name'] != old_items[key]['name'] for key, row in items.items())}}
    atomic_write(data_root / 'current.json', encoded(pointer))
    return pointer


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-root', type=Path, default=EXPORT)
    parser.add_argument('--market-catalog', type=Path, default=MARKET)
    parser.add_argument('--data-root', type=Path, default=DATA)
    parser.add_argument('--image-root', type=Path, default=IMAGES)
    args = parser.parse_args()
    print(json.dumps(sync_game_data(args.source_root, args.market_catalog, args.data_root, args.image_root), ensure_ascii=False))


if __name__ == '__main__':
    main()
