"""Independent, portable verification of exact IDs, routes, tables and PNGs.

No workstation paths or mandatory seven-ship/manufacturing assumptions.
By default this command is read-only; --write-report creates verification.json.
"""
import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path

from PIL import Image

from . import safe_fsd
from .build_item_image_library import REPOSITORY_ROOT
from .path_key_lookup import THFBPathLookup
from .verified_assets import ResourceStore, decode_texture

# Independently declared export contract. Never derive the fields to re-read
# from an exported record: an omitted field must not disable its verification.
SUPPORTED_ITEM_FIELDS = frozenset({'zh_name', 'icon_id', 'big_icon_path', 'portrait_path',
    'graphic_id', 'prefab_id', 'market_group_id', 'published', 'skin_id'})


def require(condition, message):
    if not condition:
        raise ValueError(message)


def export_path(export_root, relative):
    root = Path(export_root).resolve()
    path = (root / relative).resolve()
    require(path.is_relative_to(root), 'referenced file is outside export root')
    return path


def scope_ids(scope_file):
    if scope_file is None:
        return set()
    data = json.loads(Path(scope_file).read_text(encoding='utf-8'))
    return {str(row['productId']) for row in data.get('recipes', [])} | {
        str(row['itemId']) for row in data.get('items', [])}


def verify_targets(targets, by_id, expected_ids=None):
    keys = [str(row['itemId']) for row in targets]
    require(len(keys) == len(set(keys)), 'duplicate target IDs')
    if expected_ids is not None:
        require(set(keys) == {str(key) for key in expected_ids}, 'target ID set mismatch')
    for row in targets:
        require(row['status'] == 'verified' and by_id.get(str(row['itemId'])) == row,
                'target row does not match verified item')
    return len(targets)


def verify_png_metadata(path, asset, metadata_cache):
    path = Path(path)
    key = str(path)
    if key not in metadata_cache:
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        with Image.open(path) as image:
            image.load()
            metadata_cache[key] = (digest, image.size, image.mode)
    digest, size, mode = metadata_cache[key]
    require(digest == asset['pngSha256'], 'PNG SHA-256 mismatch')
    require(size == (asset['width'], asset['height']) and mode == 'RGBA', 'PNG dimensions/mode mismatch')


def verify_library(client_root, export_root, *, manufacturing_scope=None,
                   target_ids=None, apk_root=None, decoder_file=None, write_report=False):
    root, out = Path(client_root).resolve(), Path(export_root).resolve()
    source_hashes = {}
    def read(name):
        # Bind the exact bytes consumed, including whitespace/line endings.
        # Hashing a later reread would incorrectly validate a different input.
        raw = export_path(out, name).read_bytes()
        source_hashes[name] = hashlib.sha256(raw).hexdigest()
        return json.loads(raw.decode('utf-8'))
    summary, items, assets, tables = (read('summary.json'), read('item-image-mapping.json')['items'],
                                    read('assets.json')['assets'], read('tables.json'))
    thx = root / 'inroot.thx'
    require(summary['currentThxSha256'] == hashlib.sha256(thx.read_bytes()).hexdigest(),
            'export THX snapshot mismatch')
    override_report = read('icon-path-overrides.json')
    require(override_report.get('currentThxSha256') == summary['currentThxSha256'],
            'icon routing evidence belongs to a different resource snapshot')
    require(override_report.get('schemaVersion') == 1 and isinstance(override_report.get('overrides'), dict),
            'unsupported routing evidence format')
    overrides = override_report['overrides']
    for standard, rule in overrides.items():
        require(isinstance(rule, dict) and isinstance(rule.get('logicalPath'), str)
                and isinstance(rule.get('itemIds'), list) and rule.get('evidence')
                and rule.get('role') and rule.get('originalLogicalPath') == standard,
                'routing override lacks exact ID/path/static evidence')
    current = THFBPathLookup(thx)
    require(len(items) == len({str(row['itemId']) for row in items}), 'duplicate item IDs')
    require(len(tables) == summary['expectedItemTables'] == summary['verifiedItemTables'] == 101,
            'incomplete current item tables')
    require(not summary.get('tableErrors'), 'export contains table errors')
    by_id = {str(row['itemId']): row for row in items}
    by_path = {row['logicalPath']: row for row in assets}
    require(len(by_path) == len(assets), 'duplicate asset logical paths')
    checked_items = set()
    for table in tables:
        row = current.lookup(table['path'])
        require(row.get('digest') == table['digest'], 'table route digest mismatch')
        path = export_path(out, 'tables/' + table['digest'] + '.sd')
        data = path.read_bytes()
        require(hashlib.md5(data).hexdigest() == table['digest'], 'table MD5 mismatch')
        require(hashlib.sha256(data).hexdigest() == table['sha256'], 'table SHA-256 mismatch')
        raw, schema, _, start, footer, footer_size = safe_fsd._load(path)
        kind, width = safe_fsd._footer_layout(schema)
        require(width is not None and schema.get('valueTypes', {}).get('type') == 'object',
                'unsupported item table schema')
        count = 0
        shard = int(Path(table['path']).stem)
        for key, offset, size in safe_fsd._iter_fixed_footer(raw, footer, footer_size, kind, width):
            key = str(key)
            require(int(key) % 101 == shard, 'item/table shard mismatch')
            require(key in by_id and key not in checked_items, 'missing or duplicate exact table key')
            item = by_id[key]
            require(item['tablePath'] == table['path'] and item['tableMd5'] == table['digest'],
                    'item table provenance mismatch')
            blob = safe_fsd._checked_slice(raw, start + 4 + offset, size, 'item record')
            actual = safe_fsd._decode_object(blob, schema['valueTypes'], SUPPORTED_ITEM_FIELDS)
            require(actual == item['fields'], 'item fields differ from exact current table')
            require(item['name'] == (actual.get('zh_name') or actual.get('name')), 'item name mismatch')
            checked_items.add(key)
            count += 1
        require(count == table['records'], 'table record count mismatch')
    require(len(checked_items) == len(items) == summary['itemCount'], 'item count mismatch')
    checked_png, source_pixels, metadata_cache = set(), 0, {}
    store = ResourceStore(root, apk_root=apk_root, decoder_file=decoder_file) if decoder_file else None
    for asset in assets:
        if asset['status'] != 'verified':
            continue
        route = current.lookup(asset['logicalPath'])
        require(route.get('digest') == asset['digest'] and route.get('field1') == asset['field1'],
                'texture route digest mismatch')
        path = export_path(out, asset['image'])
        verify_png_metadata(path, asset, metadata_cache)
        if str(path) not in checked_png:
            with Image.open(path) as image:
                image.load()
                if store is not None:
                    source, _ = store.read(asset['digest'], asset['field1'])
                    require(hashlib.sha256(source).hexdigest() == asset['textureSha256'],
                            'source texture SHA-256 mismatch')
                    original = decode_texture(source)
                    require(image.size == original.size and image.tobytes() == original.tobytes(),
                            'PNG pixels differ from original texture')
                    source_pixels += 1
            checked_png.add(str(path))
    for item in items:
        icon = item['fields'].get('icon_id')
        require(item.get('iconId') == (str(icon) if icon is not None else None), 'icon ID mismatch')
        if item['status'] != 'verified':
            continue
        asset = by_path.get(item['logicalIconPath'], {})
        require(asset.get('status') == 'verified' and item['image'] == asset.get('image')
                and item['textureMd5'] == asset.get('digest'), 'item/asset link mismatch')
        standard = f'gui_v1/icon/item/{icon}.ktx'
        if item.get('imageRole', 'item-icon') == 'item-icon':
            require(item['logicalIconPath'] == standard, 'non-exact standard icon route')
        else:
            rule = overrides.get(standard, {})
            require(current.lookup(standard)['status'] == 'not-in-table', 'alternate overlaps standard route')
            require(item['itemId'] in rule.get('itemIds', []) and item['logicalIconPath'] == rule.get('logicalPath')
                    and item['imageRole'] == rule.get('role'), 'alternate route evidence mismatch')
            require(item.get('compositeWarning') == rule.get('evidence', {}).get('compositeWarning'),
                    'alternate composite warning mismatch')
    require(dict(Counter(row['status'] for row in items)) == summary['itemStatuses'], 'item status counts mismatch')
    require(dict(Counter(row['status'] for row in assets)) == summary['assetStatuses'], 'asset status counts mismatch')
    require(len(checked_png) == summary['distinctVerifiedTextures'], 'verified texture count mismatch')
    has_targets = (out / 'target-ships.json').is_file()
    targets = read('target-ships.json') if has_targets else []
    target_count = verify_targets(targets, by_id, target_ids)
    ids = scope_ids(manufacturing_scope)
    counts = Counter(by_id.get(key, {}).get('status', 'not-in-current-items') for key in ids)
    for name, digest in source_hashes.items():
        require(hashlib.sha256(export_path(out, name).read_bytes()).hexdigest() == digest,
                f'input changed during verification: {name}')
    require((out / 'target-ships.json').is_file() == has_targets,
            'input changed during verification: target-ships.json')
    report = {'itemRecordsChecked': len(items), 'itemTablesChecked': len(tables),
              'uniquePNGsReopenedAndHashChecked': len(checked_png), 'sourceTexturePixelsChecked': source_pixels,
              'manufacturingScopeCount': len(ids), 'manufacturingStatuses': dict(counts),
              'targetShipsVerified': target_count, 'errors': [],
              'verifierSourceSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'sourceFilesSha256': source_hashes,
              'currentThxSha256': summary['currentThxSha256'],
              'verifiedImageRoles': dict(Counter(row.get('imageRole', 'item-icon') for row in items
                                                if row['status'] == 'verified'))}
    if write_report:
        (out / 'verification.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-root', '--source-root', type=Path,
                        default=REPOSITORY_ROOT / 'output/client-ship-assets')
    parser.add_argument('--export-root', type=Path, required=True)
    parser.add_argument('--manufacturing-scope', type=Path)
    parser.add_argument('--target-id', action='append', default=None)
    parser.add_argument('--apk-root', type=Path)
    parser.add_argument('--decoder-file', type=Path, help='Also independently re-decode every original texture')
    parser.add_argument('--write-report', action='store_true')
    args = parser.parse_args()
    print(json.dumps(verify_library(args.client_root, args.export_root, manufacturing_scope=args.manufacturing_scope,
          target_ids=args.target_id, apk_root=args.apk_root, decoder_file=args.decoder_file,
          write_report=args.write_report), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
