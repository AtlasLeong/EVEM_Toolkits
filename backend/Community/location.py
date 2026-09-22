"""Validated catalogue references with immutable, query-free display snapshots."""
import math

from rest_framework.exceptions import ValidationError

from .activity import is_unicode_text


LOCATION_IDS = ('region_id', 'constellation_id', 'solarsystem_id')
LOCATION_NAMES = ('region_name', 'constellation_name', 'solarsystem_name')
LOCATION_SECURITIES = ('region_security', 'constellation_security', 'solarsystem_security')


def valid_id(value):
    return is_unicode_text(value) and 0 < len(value) <= 255 and value == value.strip()


def location_error(message):
    raise ValidationError({'base_location': message})


def normalized_security(value):
    """Snapshot numbers are JSON numbers, never strings or booleans."""
    if type(value) not in (int, float):
        return None
    try:
        return value if math.isfinite(value) else None
    except OverflowError:
        return None


def normalized_location(value):
    """Read stored snapshots safely without changing approved revision JSON.

    Historical names deliberately remain snapshots; a catalogue rename should
    not change already-reviewed public content or cause queries per list row.
    """
    if not isinstance(value, dict) or not valid_id(value.get('region_id')):
        return None
    ids = {key: value.get(key) for key in LOCATION_IDS}
    if any(item is not None and not valid_id(item) for item in ids.values()):
        return None
    if ids['solarsystem_id'] is not None and ids['constellation_id'] is None:
        return None
    names = {}
    for id_key, name_key in zip(LOCATION_IDS, LOCATION_NAMES):
        name = value.get(name_key)
        if ids[id_key] is None:
            if name is not None:
                return None
        elif not isinstance(name, str) or not name.strip() or len(name) > 255:
            return None
        names[name_key] = name
    security = value.get('security')
    if security is not None and normalized_security(security) is None:
        return None
    deepest_id = next(key for key in reversed(LOCATION_IDS) if ids[key] is not None)
    securities = {}
    for id_key, security_key in zip(LOCATION_IDS, LOCATION_SECURITIES):
        # Only an absent deepest-level key can inherit the legacy value. Null
        # and malformed explicit values remain unknown; ancestors are not inferred.
        level_security = value.get(security_key, security if id_key == deepest_id else None)
        securities[security_key] = normalized_security(level_security) if ids[id_key] is not None else None
    return {**ids, **names, 'security': security, **securities}


def catalogue_security(value):
    if isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def catalogue_name(record, prefix):
    # The source permits null Chinese titles, so retain a useful stable label.
    for field in ('title', 'titleen', 'id'):
        value = record[f'{prefix}_{field}']
        if isinstance(value, str) and value.strip():
            return value.strip()
    return record[f'{prefix}_id']


def validated_location(value):
    """Resolve IDs against the same routed managers as StarFieldSearch APIs.

    Input intentionally contains IDs only. Display labels/security are always
    derived here instead of trusting labels copied from a client response.
    """
    if value is None:
        return None
    if not isinstance(value, dict) or set(value) - set(LOCATION_IDS) or not valid_id(value.get('region_id')):
        location_error('请选择有效驻地星域，仅提交星域、星座和星系的 ID。')
    ids = {key: value.get(key) for key in LOCATION_IDS}
    if any(item is not None and not valid_id(item) for item in ids.values()):
        location_error('驻地 ID 必须是有效字符串。')
    if ids['solarsystem_id'] is not None and ids['constellation_id'] is None:
        location_error('选择星系前请先选择所属星座。')

    # Lazy loading keeps unrelated Community endpoints independent from the
    # catalogue and does not override the project's database router.
    from StarFieldSearch.models import Constellation, Region, Solarsystem

    region = Region.objects.filter(pk=ids['region_id']).values('r_id', 'r_title', 'r_titleen', 'r_safetylvl').first()
    if region is None:
        location_error('所选星域不存在，请重新选择。')
    region_security = catalogue_security(region['r_safetylvl'])
    snapshot = {'region_id': region['r_id'], 'region_name': catalogue_name(region, 'r'),
                'constellation_id': None, 'constellation_name': None,
                'solarsystem_id': None, 'solarsystem_name': None,
                'region_security': region_security, 'constellation_security': None,
                'solarsystem_security': None, 'security': region_security}
    if ids['constellation_id'] is not None:
        constellation = Constellation.objects.filter(pk=ids['constellation_id'], co_region_id=region['r_id']).values(
            'co_id', 'co_title', 'co_titleen', 'co_safetylvl').first()
        if constellation is None:
            location_error('所选星座不存在或不属于当前星域。')
        constellation_security = catalogue_security(constellation['co_safetylvl'])
        snapshot.update(constellation_id=constellation['co_id'], constellation_name=catalogue_name(constellation, 'co'),
                        constellation_security=constellation_security, security=constellation_security)
    if ids['solarsystem_id'] is not None:
        solarsystem = Solarsystem.objects.filter(pk=ids['solarsystem_id'], ss_region_id=region['r_id'],
                                                ss_constellation_id=snapshot['constellation_id']).values(
            'ss_id', 'ss_title', 'ss_titleen', 'ss_safetylvl').first()
        if solarsystem is None:
            location_error('所选星系不存在或不属于当前星域和星座。')
        solarsystem_security = catalogue_security(solarsystem['ss_safetylvl'])
        snapshot.update(solarsystem_id=solarsystem['ss_id'], solarsystem_name=catalogue_name(solarsystem, 'ss'),
                        solarsystem_security=solarsystem_security, security=solarsystem_security)
    return snapshot
