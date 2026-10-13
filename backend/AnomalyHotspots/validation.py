"""Pure in-memory row validation shared by stored HTTP data and worker decode.

This module must not import MessagePack, game transport, or private sessions.
The web runtime only reads sanitized JSON snapshots and static geography.
"""
MAX_SYSTEMS = 10_000
MAX_SAFE_INTEGER = 2**53 - 1


class AnomalyValidationError(Exception):
    code = 'malformed'

    def __init__(self):
        super().__init__('Anomaly statistics are unavailable or malformed.')


def validate_rows(rows):
    if not isinstance(rows, list) or len(rows) > MAX_SYSTEMS:
        raise AnomalyValidationError()
    seen, result, total = set(), [], 0
    for row in rows:
        if not isinstance(row, dict) or set(row) != {'solar_system_id', 'destroy_num'}:
            raise AnomalyValidationError()
        identifier, count = row['solar_system_id'], row['destroy_num']
        if (type(identifier) is not int or not 1 <= identifier <= MAX_SAFE_INTEGER
                or type(count) is not int or not 0 <= count <= MAX_SAFE_INTEGER
                or identifier in seen):
            raise AnomalyValidationError()
        seen.add(identifier)
        total += count
        if total > MAX_SAFE_INTEGER:
            raise AnomalyValidationError()
        result.append({'solar_system_id': identifier, 'destroy_num': count})
    return sorted(result, key=lambda row: row['solar_system_id'])
