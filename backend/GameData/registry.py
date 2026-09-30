"""Model-independent, cached lookup of exact versioned client records."""
from __future__ import annotations

from functools import lru_cache
import hashlib
import json
import logging
from pathlib import Path
import re
import time


DATA_ROOT = Path(__file__).with_name('data')
REVISION = re.compile(r'^[0-9a-f]{64}$')
IMAGE_PATH = re.compile(r'^/images/game-items/[0-9a-f]{64}\.png$')
logger = logging.getLogger(__name__)
_pointer, _signature, _checked_at = {}, None, 0.0


@lru_cache(maxsize=1)
def _display_snapshot():
    """Load the small, verified client-display enrichment snapshot.

    The large immutable catalog remains the authority for item/artwork rows;
    this companion snapshot stores exact localized strings and static-space
    names that are not present in older catalog revisions.  It intentionally
    contains provenance, rather than machine-local paths, so the same records
    can be shared by Killboard, market and future modules.
    """
    try:
        payload = json.loads((DATA_ROOT / 'display.json').read_text(encoding='utf-8'))
        if payload.get('schema_version') != 1 or not isinstance(payload.get('provenance'), dict):
            raise ValueError('Invalid display snapshot')
        for field in ('items', 'locations', 'camouflage', 'npc'):
            if not isinstance(payload.get(field, {}), dict):
                raise ValueError('Invalid display snapshot field')
        return payload
    except (OSError, ValueError, TypeError, json.JSONDecodeError) as error:
        logger.warning('Client display enrichment unavailable; exact display lookups omitted.')
        return {}


class CatalogUnavailable(RuntimeError):
    """An imported catalog cannot currently be verified or loaded."""


def item_key(value):
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 19:
        value = int(value)
    return str(value) if type(value) is int and 0 < value <= 2**63 - 1 else ''


def current_pointer():
    global _pointer, _signature, _checked_at
    now = time.monotonic()
    if now - _checked_at < 5:
        return _pointer
    _checked_at = now
    try:
        path = DATA_ROOT / 'current.json'
        stat = path.stat()
        signature = (str(path), stat.st_mtime_ns, stat.st_size)
        if signature != _signature:
            value = json.loads(path.read_text(encoding='utf-8'))
            if value.get('schema_version') != 1 or not REVISION.fullmatch(value.get('revision', '')):
                raise ValueError('Invalid catalog pointer')
            _pointer, _signature = value, signature
    except (OSError, ValueError, TypeError):
        logger.warning('Shared game catalog unavailable; exact lookups omitted.')
        _pointer, _signature = {}, None
    return _pointer


@lru_cache(maxsize=2)
def _load_version(revision, expected_hash=''):
    if not isinstance(revision, str) or not REVISION.fullmatch(revision):
        raise CatalogUnavailable('Invalid catalog revision')
    try:
        raw = (DATA_ROOT / 'versions' / f'{revision}.json').read_bytes()
        if expected_hash and hashlib.sha256(raw).hexdigest() != expected_hash:
            raise ValueError('Catalog checksum mismatch')
        payload = json.loads(raw)
        if payload.get('schema_version') != 1 or payload.get('revision') != revision or not isinstance(payload.get('items'), dict):
            raise ValueError('Invalid catalog shape')
        return payload
    except (OSError, ValueError, TypeError) as error:
        logger.warning('Shared game catalog revision unavailable; exact lookups omitted.')
        # Exceptions are not memoized by lru_cache: repaired files recover immediately.
        raise CatalogUnavailable('Shared game catalog temporarily unavailable') from error


def catalog_snapshot(version=None):
    """Pin one verified, immutable revision for the whole lookup/request."""
    pointer = current_pointer()
    if not pointer:
        raise CatalogUnavailable('Shared game catalog temporarily unavailable')
    version = version or pointer.get('revision')
    # Only imported revisions may be read. The regex also prevents traversal.
    if version not in pointer.get('versions', []):
        raise KeyError(version)
    expected = pointer.get('version_hashes', {}).get(version)
    if not expected and version == pointer.get('revision'):
        expected = pointer.get('catalog_sha256')
    if not isinstance(expected, str) or not REVISION.fullmatch(expected):
        raise CatalogUnavailable('Catalog checksum is unavailable')
    return version, _load_version(version, expected)


def _catalog(version=None):
    try:
        return catalog_snapshot(version)[1]
    except (CatalogUnavailable, KeyError):
        # Business modules can still render their own data without static artwork.
        return {}


def item_record(type_id, version=None, *, catalog=None):
    payload = _catalog(version) if catalog is None else catalog
    key = item_key(type_id)
    row = payload.get('items', {}).get(key)
    if not isinstance(row, dict):
        return None
    row = dict(row)
    # Enrichment is deliberately only applied to the live shared catalog. A
    # caller passing an explicit snapshot is asking for that exact revision.
    if catalog is None and version is None:
        display = _display_snapshot().get('items', {}).get(key, {})
        if isinstance(display, dict):
            row.update(display)
    return row


def item_name(type_id, version=None):
    row = item_record(type_id, version)
    return row.get('name', '') if row else ''


def image_metadata(type_id, version=None, *, catalog=None):
    payload = _catalog(version) if catalog is None else catalog
    row = payload.get('items', {}).get(item_key(type_id), {})
    asset = payload.get('assets', {}).get(row.get('asset_key'), {})
    path = asset.get('path', '')
    if not isinstance(path, str) or not IMAGE_PATH.fullmatch(path):
        return None
    return {'path': path, 'imageRole': row.get('image_role', ''), 'compositeWarning': row.get('image_warning'),
            'iconId': row.get('icon_id'), 'sourceVersion': row.get('source_revision'), 'pngSha256': asset.get('png_sha256')}


def image_url(type_id, version=None):
    metadata = image_metadata(type_id, version)
    return metadata['path'] if metadata else ''


def item_provenance(type_id, version=None):
    """Internal diagnostics; paths are intentionally absent from public payloads."""
    payload = _catalog(version)
    row = payload.get('items', {}).get(item_key(type_id), {})
    if not row:
        return {}
    display = _display_snapshot().get('items', {}).get(item_key(type_id), {}) if version is None else {}
    return {'source': dict(payload.get('sources', {}).get(row.get('source_revision'), {})),
            'table': dict(payload.get('tables', {}).get(row.get('table_key'), {})),
            'asset': dict(payload.get('assets', {}).get(row.get('asset_key'), {})),
            'display': {'provenance': dict(_display_snapshot().get('provenance', {})),
                        'localization': dict(display.get('name_localization', {}))}
            if display else {}}


def _client_category(key, row):
    # Initial immutable catalogs predate these stored fields. Apply the same
    # verified client arithmetic, never the unrelated market taxonomy.
    return row.get('client_category_id', int(key) // 1000000000)


def _entity_kind(key, row):
    return row.get('entity_kind') or ('ships' if _client_category(key, row) == 10 else 'items')


def item_payload(type_id, version=None, *, catalog=None, display=None):
    payload = _catalog(version) if catalog is None else catalog
    row = item_record(type_id, catalog=payload)
    if row is None:
        return None
    if display is None:
        display = catalog is None
    if display and catalog is not None:
        enrichment = _display_snapshot().get('items', {}).get(item_key(type_id), {})
        if isinstance(enrichment, dict):
            row.update(enrichment)
    key = item_key(type_id)
    metadata = image_metadata(type_id, catalog=payload) or {}
    return {'item_id': item_key(type_id), 'name': row.get('name', ''), 'raw_name': row.get('raw_name', row.get('name', '')),
            'name_localization': row.get('name_localization'), 'category_id': row.get('category_id'),
            'subcategory_id': row.get('subcategory_id'), 'category': row.get('category_label', ''),
            'entity_kind': _entity_kind(key, row), 'client_category_id': _client_category(key, row),
            'client_group_id': row.get('client_group_id', int(key) // 1000000),
            'image_url': metadata.get('path', ''), 'image_role': row.get('image_role', ''),
            'image_warning': row.get('image_warning'), 'image_status': row.get('image_status'),
            'current': row.get('current', False), 'source_revision': row.get('source_revision')}


def location_record(system_id, version=None, *, catalog=None):
    """Return exact system/constellation/region labels from client static data."""
    key = item_key(system_id)
    if not key:
        return None
    payload = _catalog(version) if catalog is None else catalog
    row = payload.get('locations', {}).get(key)
    if not isinstance(row, dict) and catalog is None and version is None:
        row = _display_snapshot().get('locations', {}).get(key)
    if not isinstance(row, dict):
        return None
    row = dict(row)
    row.setdefault('security_status', None)
    return row


def camouflaged_identity(faction_id, feat_score, version=None, *, catalog=None):
    """Look up an exact client-derived camouflage label; never infer a rank."""
    faction_key = item_key(faction_id)
    if not faction_key or feat_score is None:
        return None
    try:
        score_key = f'{float(feat_score):.2f}'
    except (TypeError, ValueError):
        return None
    payload = _catalog(version) if catalog is None else catalog
    table = payload.get('camouflage', {})
    if catalog is None and version is None:
        table = {**_display_snapshot().get('camouflage', {}), **(table if isinstance(table, dict) else {})}
    row = table.get(f'{faction_key}:{score_key}') if isinstance(table, dict) else None
    return dict(row) if isinstance(row, dict) else None


def npc_identity(type_id, version=None, *, catalog=None):
    """Resolve an exact client NPC identity from a KM weapon/unit type ID.

    NPC attackers do not have a character identity in KM.  The client renders
    their label from the weapon/unit type record instead.  Only the explicit
    maintained NPC overrides or catalog rows with the verified category 56,
    no-icon signature are accepted; numeric prefixes and missing identities
    are never enough on their own.
    """
    key = item_key(type_id)
    if not key:
        return None
    row = item_record(type_id, version, catalog=catalog)
    if not isinstance(row, dict):
        return None
    if row.get('image_status') != 'no-icon-reference' or row.get('client_category_id') != 56:
        return None
    if catalog is None and version is None:
        override = _display_snapshot().get('npc', {}).get(key)
        if isinstance(override, dict) and override.get('name'):
            return {**override, 'source_type_id': key, 'identity_kind': 'npc'}
    name = row.get('name') or ''
    if not name or '\ufffd' in name:
        return None
    return {'name': name, 'source_type_id': key, 'identity_kind': 'npc',
            'source': 'client static fleet-combat-unit label'}


def find_items(*, ids=None, query='', kind='', page=1, page_size=50, version=None, catalog=None, display=None):
    payload = _catalog(version) if catalog is None else catalog
    items = payload.get('items', {})
    if display is None:
        display = catalog is None
    if ids is not None:
        keys = [key for key in dict.fromkeys(map(item_key, ids)) if key in items]
    else:
        query = query.casefold()
        display_items = _display_snapshot().get('items', {}) if display else {}
        keys = [key for key, row in items.items() if row.get('current') and
                (kind != 'ships' or _entity_kind(key, row) == 'ships') and
                (not query or query in str(display_items.get(key, {}).get('name', row.get('name', ''))).casefold()
                 or query in str(row.get('name', '')).casefold() or query == key)]
        keys.sort(key=int)
    start = (page - 1) * page_size
    return len(keys), [item_payload(key, catalog=payload, display=display) for key in keys[start:start + page_size]]


def catalog_status():
    pointer = current_pointer()
    return {key: pointer.get(key) for key in ('revision', 'updated_at', 'item_count', 'current_item_count',
                                             'image_item_count', 'unique_image_count', 'versions', 'changes')}


def clear_cache():
    global _pointer, _signature, _checked_at
    _pointer, _signature, _checked_at = {}, None, 0.0
    _load_version.cache_clear()
    _display_snapshot.cache_clear()
