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
    row = payload.get('items', {}).get(item_key(type_id))
    return dict(row) if isinstance(row, dict) else None


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
    return {'source': dict(payload.get('sources', {}).get(row.get('source_revision'), {})),
            'table': dict(payload.get('tables', {}).get(row.get('table_key'), {})),
            'asset': dict(payload.get('assets', {}).get(row.get('asset_key'), {}))}


def _client_category(key, row):
    # Initial immutable catalogs predate these stored fields. Apply the same
    # verified client arithmetic, never the unrelated market taxonomy.
    return row.get('client_category_id', int(key) // 1000000000)


def _entity_kind(key, row):
    return row.get('entity_kind') or ('ships' if _client_category(key, row) == 10 else 'items')


def item_payload(type_id, version=None, *, catalog=None):
    payload = _catalog(version) if catalog is None else catalog
    row = item_record(type_id, catalog=payload)
    if row is None:
        return None
    key = item_key(type_id)
    metadata = image_metadata(type_id, catalog=payload) or {}
    return {'item_id': item_key(type_id), 'name': row.get('name', ''), 'category_id': row.get('category_id'),
            'subcategory_id': row.get('subcategory_id'), 'category': row.get('category_label', ''),
            'entity_kind': _entity_kind(key, row), 'client_category_id': _client_category(key, row),
            'client_group_id': row.get('client_group_id', int(key) // 1000000),
            'image_url': metadata.get('path', ''), 'image_role': row.get('image_role', ''),
            'image_warning': row.get('image_warning'), 'image_status': row.get('image_status'),
            'current': row.get('current', False), 'source_revision': row.get('source_revision')}


def find_items(*, ids=None, query='', kind='', page=1, page_size=50, version=None, catalog=None):
    payload = _catalog(version) if catalog is None else catalog
    items = payload.get('items', {})
    if ids is not None:
        keys = [key for key in dict.fromkeys(map(item_key, ids)) if key in items]
    else:
        query = query.casefold()
        keys = [key for key, row in items.items() if row.get('current') and
                (kind != 'ships' or _entity_kind(key, row) == 'ships') and
                (not query or query in str(row.get('name', '')).casefold() or query == key)]
        keys.sort(key=int)
    start = (page - 1) * page_size
    return len(keys), [item_payload(key, catalog=payload) for key in keys[start:start + page_size]]


def catalog_status():
    pointer = current_pointer()
    return {key: pointer.get(key) for key in ('revision', 'updated_at', 'item_count', 'current_item_count',
                                             'image_item_count', 'unique_image_count', 'versions', 'changes')}


def clear_cache():
    global _pointer, _signature, _checked_at
    _pointer, _signature, _checked_at = {}, None, 0.0
    _load_version.cache_clear()
