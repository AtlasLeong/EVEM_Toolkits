"""Decode only the observed anomaly-statistics wire schema, never heuristics."""
import msgpack

from .validation import (MAX_SYSTEMS, MAX_SAFE_INTEGER, validate_rows,
                         AnomalyValidationError as AnomalyProtocolError)

MAX_RESPONSE_BYTES = 2 * 1024 * 1024
# Both IDs were observed for this same exact two-field statistics record.
OBSERVED_STATISTICS_SCHEMAS = frozenset({112, 113})


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
                or type(record[0]) is not int or record[0] not in OBSERVED_STATISTICS_SCHEMAS):
            raise AnomalyProtocolError()
        rows.append(_unpack(record[1]))
    return validate_rows(rows)
