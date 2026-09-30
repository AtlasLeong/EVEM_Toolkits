"""Batch enrichment for system security and location names."""

from __future__ import annotations

import math

from django.db import DatabaseError


SECURITY_COLORS = {
    'high': '#77e6e0',
    'low': '#f5b95d',
    'nullsec': '#ff7d72',
    'unknown': '#9fb4b9',
}


def _number(value):
    try:
        return float(value) if value is not None and math.isfinite(float(value)) else None
    except (TypeError, ValueError, OverflowError):
        return None


def security_meta(value):
    """Return a stable semantic band; the label is never color-only."""
    status = _number(value)
    if status is None:
        return {
            'security_status': None, 'security_label': '安等未知',
            'security_band': 'unknown', 'security_color': SECURITY_COLORS['unknown'],
        }
    if status <= 0:
        band = 'nullsec'
        label = '零安'
    elif status < 0.5:
        band = 'low'
        label = '低安'
    else:
        band = 'high'
        label = '高安'
    return {
        'security_status': status, 'security_label': label,
        'security_band': band, 'security_color': SECURITY_COLORS[band],
    }


def system_security_map(system_ids):
    """Resolve a page's systems in one query; unavailable tables fail closed."""
    ids = {int(value) for value in (system_ids or ()) if value is not None}
    if not ids:
        return {}
    try:
        from TacticalBoard.models import BoardSystems
        rows = BoardSystems.objects.filter(system_id__in=ids).select_related('constellation__region')
        # QuerySets defer database access until iteration; include evaluation in
        # the guard so an unavailable unmanaged lookup table cannot break KM.
        result = {}
        for row in rows:
            constellation = getattr(row, 'constellation', None)
            region = getattr(constellation, 'region', None)
            result[str(row.system_id)] = {
                **security_meta(getattr(row, 'security_status', None)),
                'system_name': getattr(row, 'zh_name', None) or getattr(row, 'name', '') or '',
                'constellation_name': getattr(constellation, 'zh_name', None) or getattr(constellation, 'name', '') or '',
                'region_name': getattr(region, 'zh_name', None) or getattr(region, 'name', '') or '',
            }
    except (ImportError, DatabaseError, AttributeError, TypeError, ValueError, RuntimeError):
        return {}
    return result
