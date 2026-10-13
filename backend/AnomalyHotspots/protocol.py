"""Decode only the observed anomaly-statistics wire schema, never heuristics."""
import msgpack

MAX_SYSTEMS = 10_000
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_SAFE_INTEGER = 2**53 - 1


class AnomalyProtocolError(Exception):
    code = 'malformed'

    def __init__(self):
        super().__init__('Anomaly statistics are unavailable or malformed.')


def _unpack(data):
    if not isinstance(data, bytes) or len(data) > MAX_RESPONSE_BYTES:
        raise AnomalyProtocolError()
    try:
        return msgpack.unpackb(data, raw=False, strict_map_key=True,
                               max_array_len=MAX_SYSTEMS, max_map_len=2,
                               max_str_len=64, max_bin_len=MAX_RESPONSE_BYTES,
                               max_ext_len=MAX_RESPONSE_BYTES)
    except (ValueError, TypeError, RecursionError, msgpack.UnpackException):
        raise AnomalyProtocolError() from None


def validate_rows(rows):
    if not isinstance(rows, list) or len(rows) > MAX_SYSTEMS:
        raise AnomalyProtocolError()
    seen, result, total = set(), [], 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'solar_system_id', 'destroy_num'}:
            raise AnomalyProtocolError()
        identifier, count = row['solar_system_id'], row['destroy_num']
        if (type(identifier) is not int or not 1 <= identifier <= MAX_SAFE_INTEGER
                or type(count) is not int or not 0 <= count <= MAX_SAFE_INTEGER
                or identifier in seen):
            raise AnomalyProtocolError()
        seen.add(identifier)
        total += count
        if total > MAX_SAFE_INTEGER:
            raise AnomalyProtocolError()
        result.append({'solar_system_id': identifier, 'destroy_num': count})
    return sorted(result, key=lambda row: row['solar_system_id'])


def decode_statistics(value):
    # The inherited transport already consumes one Ext10 boundary.
    if isinstance(value, msgpack.ExtType) and value.code == 10:
        value = _unpack(value.data)
    if not isinstance(value, list) or len(value) > MAX_SYSTEMS:
        raise AnomalyProtocolError()
    rows, total = [], 0
    for extension in value:
        if not isinstance(extension, msgpack.ExtType) or extension.code != 19:
            raise AnomalyProtocolError()
        total += len(extension.data)
        if total > MAX_RESPONSE_BYTES:
            raise AnomalyProtocolError()
        record = _unpack(extension.data)
        if (not isinstance(record, list) or len(record) != 2
                or type(record[0]) is not int or record[0] != 112):
            raise AnomalyProtocolError()
        rows.append(_unpack(record[1]))
    return validate_rows(rows)
