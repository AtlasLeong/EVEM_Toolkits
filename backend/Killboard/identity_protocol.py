"""Bounded identity projections from the two offline-verified batch schemas.

Character batches are Ext10 -> list[Ext58(map)]. Corporation batches are
Ext10 -> list[Ext19([2, MessagePack map])]. Missing rows stay missing; no
identifier ranges, NPC status, unobserved aliases or names are inferred.
"""

from __future__ import annotations

import msgpack

from .session_bundle import MAX_KILL_ID, MAX_PROFILE_IDS


MAX_PROFILE_BYTES = 2 * 1024 * 1024
MAX_NAME_CHARS = 256


class IdentityProtocolError(ValueError):
    code = 'malformed'


def _invalid():
    return IdentityProtocolError('Invalid Killboard identity response.')


def profile_ids(values):
    if (not isinstance(values, (list, tuple)) or not 1 <= len(values) <= MAX_PROFILE_IDS
            or any(type(value) is not int or not 1 <= value <= MAX_KILL_ID for value in values)
            or len(set(values)) != len(values)):
        raise _invalid()
    return list(values)


def _unpack(value):
    if not isinstance(value, bytes) or len(value) > MAX_PROFILE_BYTES:
        raise _invalid()
    try:
        return msgpack.unpackb(value, raw=False, strict_map_key=False, object_pairs_hook=_unique_map,
                               max_array_len=MAX_PROFILE_IDS, max_map_len=64,
                               max_str_len=MAX_PROFILE_BYTES, max_bin_len=MAX_PROFILE_BYTES,
                               max_ext_len=MAX_PROFILE_BYTES)
    except (ValueError, TypeError, RecursionError, OverflowError, msgpack.UnpackException):
        raise _invalid() from None


def _unique_map(pairs):
    result = {}
    for key, value in pairs:
        if not isinstance(key, str) or key in result:
            raise _invalid()
        result[key] = value
    return result


def _name(value, *, optional=False):
    if value is None and optional:
        return ''
    if (not isinstance(value, str) or len(value) > MAX_NAME_CHARS
            or any(ord(character) < 32 or 127 <= ord(character) < 160 for character in value)):
        raise _invalid()
    return value


def _identifier(value, *, optional=False):
    if value is None and optional:
        return None
    if type(value) is not int or not 1 <= value <= MAX_KILL_ID:
        raise _invalid()
    return value


def _batch(payload, requested):
    requested = profile_ids(requested)
    if isinstance(payload, bytes):
        payload = _unpack(payload)
    if isinstance(payload, msgpack.ExtType) and payload.code == 10:
        payload = _unpack(payload.data)
    if not isinstance(payload, list) or len(payload) > len(requested):
        raise _invalid()
    return payload, set(requested)


def decode_public_info(payload, requested):
    rows, requested = _batch(payload, requested)
    result = {}
    for row in rows:
        if not isinstance(row, msgpack.ExtType) or row.code != 58:
            raise _invalid()
        row = _unpack(row.data)
        if not isinstance(row, dict):
            raise _invalid()
        identifier = _identifier(row.get('character_id'))
        if identifier not in requested or identifier in result:
            raise _invalid()
        result[identifier] = {'name': _name(row.get('character_name')),
                              'corporation_id': _identifier(row.get('corporation_id'), optional=True),
                              'alliance_id': _identifier(row.get('alliance_id'), optional=True)}
    return result


def decode_corp_brief(payload, requested):
    rows, requested = _batch(payload, requested)
    result = {}
    for row in rows:
        if not isinstance(row, msgpack.ExtType) or row.code != 19:
            raise _invalid()
        envelope = _unpack(row.data)
        if (not isinstance(envelope, list) or len(envelope) != 2
                or type(envelope[0]) is not int or envelope[0] != 2):
            raise _invalid()
        row = _unpack(envelope[1])
        if not isinstance(row, dict):
            raise _invalid()
        identifier = _identifier(row.get('corporation_id'))
        if identifier not in requested or identifier in result:
            raise _invalid()
        result[identifier] = {'name': _name(row.get('corporation_name')),
                              'ticker': _name(row.get('ticker_name')),
                              'alliance_id': _identifier(row.get('alliance_id'), optional=True),
                              'alliance_name': _name(row.get('alliance_name'), optional=True)}
    return result
