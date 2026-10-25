"""Small limits for legacy query inputs; no production settings or I/O."""
from decimal import Decimal, InvalidOperation
import math
import re

from rest_framework.exceptions import ValidationError


LOCATION_LIMIT = 100
RESOURCE_LIMIT = 34
CANDIDATE_LIMIT = 5000
RESULT_LIMIT = 10000
MAX_ID = 9223372036854775807


def positive_id(value):
    if (isinstance(value, bool) or not isinstance(value, (int, str))
            or not re.fullmatch(r'[0-9]{1,19}', str(value))):
        raise ValidationError({'error': '地点 ID 必须为有效的正整数。'})
    number = int(value)
    if number <= 0 or number > MAX_ID:
        raise ValidationError({'error': '地点 ID 超出有效范围。'})
    return str(number)


def location_ids(value):
    if not isinstance(value, list) or len(value) > LOCATION_LIMIT:
        raise ValidationError({'error': '每级地点最多选择 100 项，请缩小查询条件。'})
    return list(dict.fromkeys(positive_id(item) for item in value))


def bounded_rows(queryset, limit):
    rows = list(queryset[:limit + 1])
    if len(rows) > limit:
        raise ValidationError({'error': '查询结果过多，请缩小地点或资源条件后重试。'})
    return rows


def numeric_yield(value):
    """Return a rank key, not a replacement for the stored serialized value."""
    if value is None or isinstance(value, bool) or not isinstance(value, (str, int, float, Decimal)):
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    # The API's existing consumers parse yields as finite floating-point values.
    return result if result.is_finite() and result >= 0 and math.isfinite(float(result)) else None
