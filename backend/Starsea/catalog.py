"""Read-only catalogs used to create canonical, versioned submission snapshots.

SWEET 218811 is a historical third-party EVE Echoes data snapshot, not a claim
that every listed hull is currently playable in the Chinese service. The raw
database is configured outside the application and is never served as media.
"""

import hashlib
import math
import sqlite3
import unicodedata
from contextlib import closing
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple

from django.conf import settings
from django.db import DatabaseError
from django.db.models import Q
from rest_framework.exceptions import APIException, ValidationError

from TacticalBoard.models import BoardConstellations, BoardRegions, BoardSystems


PINNED_SHA256 = 'c47d33925de2d61c44880dfc2fd45e41ada168c596961deb696ecefc8818dd6a'
PINNED_USER_VERSION = 218811
SOURCE_VERSION = 'SWEET 218811'
NOTICE = ('舰船名称来自 SWEET 218811 本地历史快照的市场舰船条目，'
          '不代表当前国服完整或已实装舰船清单；未收录型号可使用未知或自填。')
PAGE_SIZE = 20
MAX_PAGE = 10000
MAX_QUERY_LENGTH = 80
REGION_LIMIT = 500
CHILD_LIMIT = 100


class CatalogUnavailable(APIException):
    status_code = 503
    default_detail = '目录暂不可用，请稍后重试；舰船型号仍可使用未知或自填。'
    default_code = 'catalog_unavailable'


class _Ship(NamedTuple):
    id: int
    name: str
    ship_class: str
    aliases: tuple


def _query(value, field):
    if not isinstance(value, str) or len(value) > MAX_QUERY_LENGTH:
        raise ValidationError({field: '请输入不超过 80 个字符的文本。'})
    if any(unicodedata.category(character) in ('Cc', 'Cs') for character in value):
        raise ValidationError({field: '查询不能包含控制字符或无效 Unicode。'})
    return value.strip()


def _positive_int(value, field, *, query_string=False, maximum=2**63 - 1):
    if query_string and isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 19:
        value = int(value)
    if type(value) is not int or not 1 <= value <= maximum:
        raise ValidationError({field: '请输入有效的正整数。'})
    return value


def _file_signature(path):
    stat = path.stat()
    return (stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)


def _source_text(*values):
    return next((value.strip() for value in values if isinstance(value, str) and value.strip()), '')


@lru_cache(maxsize=4)
def _load_catalog(path_text, signature, expected_sha256):
    """Cache immutable rows by file identity; every new source is hash checked."""
    path = Path(path_text)
    try:
        with path.open('rb') as stream:
            digest = hashlib.sha256()
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                digest.update(block)
        if digest.hexdigest() != expected_sha256 or _file_signature(path) != signature:
            raise CatalogUnavailable()
        # mode=ro forbids writes. immutable avoids journals/locks on the pinned
        # source; stat checks above/below reject replacement during loading.
        with closing(sqlite3.connect(path.as_uri() + '?mode=ro&immutable=1', uri=True)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON')
            db.execute('PRAGMA trusted_schema=OFF')
            if db.execute('PRAGMA user_version').fetchone()[0] != PINNED_USER_VERSION:
                raise CatalogUnavailable()
            rows = db.execute('''
                SELECT i.id, i.sourceName, n.source, n.zhcn, n.zh, n.en,
                       g.sourceName AS group_source, gn.zhcn AS class_zhcn,
                       gn.zh AS class_zh, gn.source AS class_source
                FROM items AS i
                JOIN market_group AS m ON m.id = i.marketGroupId
                JOIN "groups" AS g ON g.id = CAST(i.id / 1000000 AS INTEGER)
                LEFT JOIN localised_strings AS n ON n.id = i.nameKey
                LEFT JOIN localised_strings AS gn ON gn.id = g.localisedNameIndex
                WHERE i.id >= 10000000000 AND i.id < 11000000000
                  AND i.marketGroupId >= 100000000 AND i.marketGroupId < 100100000
                ORDER BY i.id
            ''').fetchall()
        result = []
        for row in rows:
            name = _source_text(row['zhcn'], row['zh'], row['source'], row['sourceName'])
            ship_class = _source_text(row['class_zhcn'], row['class_zh'], row['class_source'], row['group_source'])
            if not name or not ship_class:
                raise CatalogUnavailable()
            aliases = tuple(_source_text(row[key]).casefold()
                            for key in ('zhcn', 'zh', 'en', 'source', 'sourceName'))
            result.append(_Ship(row['id'], name, ship_class, aliases))
        if not result or _file_signature(path) != signature:
            raise CatalogUnavailable()
        return tuple(result)
    except (OSError, sqlite3.Error, ValueError):
        raise CatalogUnavailable() from None


def _ships():
    configured = getattr(settings, 'STARSEA_SHIP_DB', '')
    if not isinstance(configured, (str, Path)) or not str(configured) or str(configured).startswith(('//', '\\\\')):
        raise CatalogUnavailable()
    try:
        path = Path(configured)
        if not path.is_absolute():
            raise CatalogUnavailable()
        path = path.resolve(strict=True)
        if str(path).startswith(('//', '\\\\')) or not path.is_file():
            raise CatalogUnavailable()
        signature = _file_signature(path)
    except (OSError, ValueError, RuntimeError):
        raise CatalogUnavailable() from None
    return _load_catalog(str(path), signature, PINNED_SHA256)


def _ship_snapshot(ship):
    return {'id': ship.id, 'name': ship.name, 'ship_class': ship.ship_class,
            'source_version': SOURCE_VERSION}


def search_ships(q='', ship_class='', page=1):
    q = _query(q, 'q').casefold()
    ship_class = _query(ship_class, 'ship_class')
    page = _positive_int(page, 'page', query_string=True, maximum=MAX_PAGE)
    matches = [ship for ship in _ships()
               if (not ship_class or ship.ship_class == ship_class)
               and (not q or any(q in alias for alias in ship.aliases))]
    offset = (page - 1) * PAGE_SIZE
    return {'count': len(matches), 'results': [_ship_snapshot(ship) for ship in matches[offset:offset + PAGE_SIZE]],
            'source_version': SOURCE_VERSION, 'notice': NOTICE}


def resolve_ship(ship_id):
    ship_id = _positive_int(ship_id, 'ship_id')
    for ship in _ships():
        if ship.id == ship_id:
            return _ship_snapshot(ship)
    raise ValidationError({'ship_id': '该型号不在当前目录中，请重新选择或使用自填型号。'})


def _security(value):
    if value is None:
        return None
    try:
        return value if math.isfinite(value) else None
    except (TypeError, ValueError, OverflowError):
        return None


def _location_name(row):
    return _source_text(row.zh_name, row.name)


def search_locations(kind='regions', parent_id=None, q=''):
    if not isinstance(kind, str) or kind not in ('regions', 'constellations', 'systems'):
        raise ValidationError({'kind': '请选择星域、星座或星系目录。'})
    q = _query(q, 'q')
    if kind == 'regions':
        if parent_id is not None:
            raise ValidationError({'parent_id': '星域目录不接受父级。'})
    else:
        parent_id = _positive_int(parent_id, 'parent_id', query_string=True)
    try:
        if kind == 'regions':
            rows = BoardRegions.objects.all()
            if not rows.exists():
                raise CatalogUnavailable('地理目录暂不可用，请稍后重试。')
            limit = REGION_LIMIT
        elif kind == 'constellations':
            if not BoardRegions.objects.filter(pk=parent_id).exists():
                raise ValidationError({'parent_id': '星域不存在。'})
            rows = BoardConstellations.objects.filter(region_id=parent_id)
            limit = CHILD_LIMIT
        else:
            if not BoardConstellations.objects.filter(pk=parent_id).exists():
                raise ValidationError({'parent_id': '星座不存在。'})
            rows = BoardSystems.objects.filter(constellation_id=parent_id)
            limit = CHILD_LIMIT
        if q:
            rows = rows.filter(Q(name__icontains=q) | Q(zh_name__icontains=q))
        return {'results': [
            {'id': row.pk, 'name': _location_name(row),
             'security': _security(row.security_status) if kind == 'systems' else None}
            for row in rows.order_by('pk')[:limit]
        ]}
    except DatabaseError:
        raise CatalogUnavailable('地理目录暂不可用，请稍后重试。') from None


def resolve_location(ids):
    """Return detached scalar values, never models or caller-provided names."""
    if ids is None:
        return None
    fields = {'region_id', 'constellation_id', 'solarsystem_id'}
    if not isinstance(ids, dict) or set(ids) - fields:
        raise ValidationError({'location': '地点仅接受星域、星座和星系 ID。'})
    region_id = _positive_int(ids.get('region_id'), 'region_id')
    constellation_id = ids.get('constellation_id')
    solarsystem_id = ids.get('solarsystem_id')
    if constellation_id is not None:
        constellation_id = _positive_int(constellation_id, 'constellation_id')
    if solarsystem_id is not None:
        solarsystem_id = _positive_int(solarsystem_id, 'solarsystem_id')
        if constellation_id is None:
            raise ValidationError({'constellation_id': '选择星系时须同时选择其星座。'})
    try:
        region = BoardRegions.objects.filter(pk=region_id).first()
        if region is None:
            raise ValidationError({'region_id': '星域不存在。'})
        constellation = system = None
        if constellation_id is not None:
            constellation = BoardConstellations.objects.filter(pk=constellation_id, region_id=region_id).first()
            if constellation is None:
                raise ValidationError({'constellation_id': '星座不存在或不属于所选星域。'})
        if solarsystem_id is not None:
            system = BoardSystems.objects.filter(pk=solarsystem_id, constellation_id=constellation_id).first()
            if system is None:
                raise ValidationError({'solarsystem_id': '星系不存在或不属于所选星座。'})
        return {
            'region_id': region.pk, 'region_name': _location_name(region),
            'constellation_id': constellation.pk if constellation else None,
            'constellation_name': _location_name(constellation) if constellation else None,
            'solarsystem_id': system.pk if system else None,
            'solarsystem_name': _location_name(system) if system else None,
            'security': _security(system.security_status) if system else None,
        }
    except DatabaseError:
        raise CatalogUnavailable('地理目录暂不可用，请稍后重试。') from None
