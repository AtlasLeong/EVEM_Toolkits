"""Pure sanitized metric provenance, independent of transport and sessions.

The observed client range mapping is versioned, not a statistics time window:
0 is no heat; 1:1–50, 2:51–100, 3:101–150, 4:151–200, 5:>200.
Historical v1 rows have no proven metric, including when their values are small.
"""
from .validation import AnomalyValidationError, validate_rows


def activity_metric():
    return {'kind': 'activity_level', 'range_version': 1}


def legacy_metric():
    return {'kind': 'legacy_unclassified', 'range_version': None}


def validate_metric(value):
    if not isinstance(value, dict) or set(value) != {'kind', 'range_version'}:
        raise AnomalyValidationError()
    if (value['kind'] == 'activity_level' and type(value['range_version']) is int
            and value['range_version'] == 1):
        return activity_metric()
    if value['kind'] == 'legacy_unclassified' and value['range_version'] is None:
        return legacy_metric()
    raise AnomalyValidationError()


def validate_metric_rows(rows, metric):
    semantics = validate_metric(metric)
    result = validate_rows(rows)
    if semantics == activity_metric() and any(row['destroy_num'] > 5 for row in result):
        raise AnomalyValidationError()
    return result
