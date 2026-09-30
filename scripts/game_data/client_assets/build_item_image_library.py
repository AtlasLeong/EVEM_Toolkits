"""Join exact current item tables, verified native paths, and MD5-checked textures.

Maintained offline tool. Reads named local client copies; never game code or accounts.
Original implementation: output/client-ship-assets/mapping-deep/build_item_image_library.py.
Failures are explicit; no visual guessing, name matching, or substitute icons.
"""
from __future__ import annotations

from collections import Counter
import hashlib
import json
from pathlib import Path
import argparse

from .path_key_lookup import THFBPathLookup
from . import safe_fsd
from .verified_assets import ResourceStore, decode_texture
from .decoder import load_decoder, DECODER_SHA256, UPSTREAM_COMMIT, UPSTREAM_URL

REPOSITORY_ROOT = Path(__file__).resolve().parents[3]


def bundled_override(thx_file, *, routing_root=None):
    snapshot = hashlib.sha256(Path(thx_file).read_bytes()).hexdigest()
    folder = Path(routing_root) if routing_root else Path(__file__).parent / 'routing'
    path = folder / (snapshot + '.json')
    return path if path.is_file() else None


def load_overrides(evidence_file, thx_file):
    snapshot = hashlib.sha256(Path(thx_file).read_bytes()).hexdigest()
    if evidence_file is None:
        return {'schemaVersion': 1, 'currentThxSha256': snapshot, 'overrides': {},
                'scope': 'standard exact item routes only; no alternate evidence supplied'}
    report = json.loads(Path(evidence_file).read_text(encoding='utf-8'))
    if report.get('currentThxSha256') != snapshot:
        raise ValueError('icon routing evidence belongs to a different resource snapshot')
    if report.get('schemaVersion') != 1 or not isinstance(report.get('overrides'), dict):
        raise ValueError('unsupported routing evidence format')
    for standard, rule in report['overrides'].items():
        if (not isinstance(rule, dict) or not isinstance(rule.get('logicalPath'), str)
                or not isinstance(rule.get('itemIds'), list) or not rule.get('evidence')
                or not rule.get('role') or rule.get('originalLogicalPath') != standard):
            raise ValueError('routing override lacks exact ID/path/static evidence')
    return report


def extract(client_root, export_root, *, apk_root=None, decoder_file=None,
            routing_overrides=None, target_ids=None):
    root, out = Path(client_root).resolve(), Path(export_root).resolve()
    if out.exists() and any(out.iterdir()):
        raise ValueError('export root must be empty; use a new snapshot directory')
    thx_file = root / 'inroot.thx'
    override_report = load_overrides(routing_overrides, thx_file)
    decoder_file = Path(decoder_file).resolve() if decoder_file else root / 'tool-probe-20260929/decryption.py'
    # Fail before any export write when dependency bytes do not match the pin.
    decoder = load_decoder(decoder_file)
    lookup = THFBPathLookup(thx_file)
    store = ResourceStore(root, apk_root=apk_root, decoder_file=decoder_file)
    store.decoder = decoder
    overrides = override_report['overrides']
    (out / 'images').mkdir(parents=True, exist_ok=True)
    (out / 'tables').mkdir(exist_ok=True)
    tables, items, table_errors = [], [], []
    wanted = {'zh_name', 'icon_id', 'big_icon_path', 'portrait_path',
              'graphic_id', 'prefab_id', 'market_group_id', 'published', 'skin_id'}
    for shard in range(101):
        path = f'staticdata/items/{shard}.sd'
        row = lookup.lookup(path)
        if row['status'] == 'not-in-table':
            table_errors.append({'path': path, 'error': 'not-in-current-table'})
            continue
        try:
            raw, source = store.read(row['digest'], row['field1'])
            dest = out / 'tables' / (row['digest'] + '.sd')
            dest.write_bytes(raw)
            data, schema, _, start, footer, footer_size = safe_fsd._load(dest)
            key_type, width = safe_fsd._footer_layout(schema)
            if width is None or schema.get('valueTypes',{}).get('type') != 'object':
                raise ValueError('unsupported item table schema')
            spec = schema['valueTypes']
            if not {'icon_id', 'zh_name'} <= spec['attributes'].keys():
                raise ValueError('not an item table')
            records = []
            for key, offset, size in safe_fsd._iter_fixed_footer(data, footer, footer_size, key_type, width):
                if key % 101 != shard:
                    raise ValueError('item key/shard mismatch')
                blob = safe_fsd._checked_slice(data, start+4+offset, size, 'item record')
                fields = safe_fsd._decode_object(blob, spec, wanted)
                records.append({'itemId': str(key), 'name': fields.get('zh_name') or fields.get('name'),
                                'fields': fields, 'tablePath': path, 'tableMd5': row['digest']})
            items.extend(records)
            tables.append({'path': path, 'digest': row['digest'], 'sha256': hashlib.sha256(raw).hexdigest(),
                           'records': len(records), 'source': source, 'tableKey': row['tableKey']})
        except Exception as exc:
            table_errors.append({'path':path, 'digest':row['digest'], 'error':str(exc)})
        if shard % 10 == 0:
            print(f'tables {shard+1}/101, items={len(items)}, errors={len(table_errors)}', flush=True)
    if len({r['itemId'] for r in items}) != len(items):
        raise ValueError('duplicate item IDs across exact current shards')
    assets = {}
    for number, item in enumerate(items, 1):
        icon = item['fields'].get('icon_id')
        item['iconId'] = str(icon) if icon is not None else None
        if not isinstance(icon, int) or icon <= 0:
            item['status'] = 'no-icon-reference'
            continue
        # The platform converts requested .png item icons to .ktx resources.
        path = f'gui_v1/icon/item/{icon}.ktx'
        item['imageRole'] = 'item-icon'
        alternative = overrides.get(path)
        if alternative and item['itemId'] in alternative['itemIds']:
            if lookup.lookup(path)['status'] != 'not-in-table':
                raise ValueError('explicit alternate route unexpectedly overlaps a standard icon')
            item['standardIconPath'] = path
            item['imageRole'] = alternative['role']
            item['routingEvidence'] = 'icon-path-overrides.json#' + path
            warning = alternative.get('evidence',{}).get('compositeWarning')
            if warning:
                item['compositeWarning'] = warning
            path = alternative['logicalPath']
        item['logicalIconPath'] = path
        if path not in assets:
            row = lookup.lookup(path)
            asset = dict(row)
            if row['status'] != 'not-in-table':
                try:
                    raw, source = store.read(row['digest'], row['field1'])
                    image = decode_texture(raw)
                    dest = out / 'images' / (row['digest']+'.png')
                    image.save(dest)
                    # Reopen and compare pixels: conversion is verified, not merely saved.
                    from PIL import Image
                    with Image.open(dest) as check:
                        check.load()
                        if check.mode != 'RGBA' or check.size != image.size or check.tobytes() != image.tobytes():
                            raise ValueError('PNG roundtrip mismatch')
                    asset.update(status='verified', image='images/'+dest.name,
                                 width=image.width, height=image.height,
                                 textureMd5Verified=True, textureSizeVerified=True,
                                 textureSha256=hashlib.sha256(raw).hexdigest(),
                                 pngSha256=hashlib.sha256(dest.read_bytes()).hexdigest(),
                                 source=source, alphaRange=image.getchannel('A').getextrema())
                except FileNotFoundError as exc:
                    asset.update(status='not-in-local-packages', error=str(exc))
                except Exception as exc:
                    asset.update(status='decode-or-integrity-failed', error=str(exc))
            assets[path] = asset
        asset = assets[path]
        item['status'] = asset['status']
        item['textureMd5'] = asset.get('digest')
        item['image'] = asset.get('image')
        if number % 2000 == 0:
            print(f'items {number}/{len(items)}, assets={len(assets)}, verified={sum(x["status"]=="verified" for x in assets.values())}', flush=True)
    items.sort(key=lambda r:int(r['itemId']))
    target_ids = [str(key) for key in (target_ids or [])]
    target = [r for key in target_ids for r in items if r['itemId']==key]
    summary = {'source':'current local client THX + exact staticdata/items shards',
               'currentThxSha256':hashlib.sha256(thx_file.read_bytes()).hexdigest(),
               'expectedItemTables':101, 'verifiedItemTables':len(tables),
               'tableErrors':table_errors, 'itemCount':len(items),
               'itemStatuses':dict(Counter(r['status'] for r in items)),
               'distinctIconPaths':len(assets), 'assetStatuses':dict(Counter(r['status'] for r in assets.values())),
               'distinctVerifiedTextures':len({r['digest'] for r in assets.values() if r['status']=='verified'}),
               'verifiedImageRoles':dict(Counter(r['imageRole'] for r in items if r['status']=='verified')),
               'targetShips':[{k:r.get(k) for k in ['itemId','name','iconId','status','image','textureMd5']} for r in target],
               'note':'Exact client references only. No guessed pictures. This is a local extraction, not a website deployment or copyright licence.'}
    summary['toolchain'] = {'entrypoint': 'python -m scripts.game_data.client_assets.build_item_image_library',
                            'clientRoot': str(root), 'apkRoot': str(apk_root) if apk_root else None,
                            'resourceRoots': [str(location) for location in store.locations],
                            'resourceIndexSha256': {str(location / 'inroot.idx'): hashlib.sha256((location / 'inroot.idx').read_bytes()).hexdigest() for location in store.locations},
                            'decoderFile': str(decoder_file), 'decoderSha256': DECODER_SHA256,
                            'decoderUpstreamCommit': UPSTREAM_COMMIT, 'decoderUpstreamUrl': UPSTREAM_URL,
                            'routingOverridesSource': str(routing_overrides) if routing_overrides else None,
                            'routingOverridesSha256': hashlib.sha256(Path(routing_overrides).read_bytes()).hexdigest() if routing_overrides else None,
                            'toolSourceFilesSha256': {path.name: hashlib.sha256(path.read_bytes()).hexdigest() for path in Path(__file__).parent.glob('*.py')},
                            'conversionChain': 'item ID -> FSD icon_id -> THFB path key -> IDX/WPK -> AC stage1 -> ENON/DTSZ/zlib -> KTX ASTC -> RGBA PNG'}
    for name, value in [('summary.json',summary), ('item-image-mapping.json',{'schemaVersion':1,'items':items}),
                        ('assets.json',{'schemaVersion':1,'assets':list(assets.values())}), ('tables.json',tables),
                        ('target-ships.json',target), ('icon-path-overrides.json',override_report)]:
        (out/name).write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(summary,ensure_ascii=False,indent=2),flush=True)
    if table_errors:
        raise ValueError('one or more current item tables failed; export is not publishable')
    return summary

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--client-root', '--source-root', type=Path,
                        default=REPOSITORY_ROOT / 'output/client-ship-assets')
    parser.add_argument('--export-root', type=Path)
    parser.add_argument('--apk-root', type=Path, help='Optional APK assets/res directory')
    parser.add_argument('--decoder-file', type=Path, help='External pinned decryption.py')
    parser.add_argument('--routing-overrides', type=Path, help='THX-SHA-bound exact alternate-route evidence')
    parser.add_argument('--no-overrides', action='store_true', help='Standard routes only; no guessed fallback')
    parser.add_argument('--target-id', action='append', default=[])
    args = parser.parse_args()
    if args.no_overrides and args.routing_overrides:
        parser.error('--no-overrides and --routing-overrides are mutually exclusive')
    overrides = args.routing_overrides
    if not args.no_overrides and overrides is None:
        overrides = bundled_override(args.client_root / 'inroot.thx')
    extract(args.client_root, args.export_root or args.client_root / 'verified-item-images-maintained',
            apk_root=args.apk_root, decoder_file=args.decoder_file,
            routing_overrides=overrides, target_ids=args.target_id)


if __name__ == '__main__':
    main()
