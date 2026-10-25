"""Public sanitized stored counts only; HTTP requests never trigger game RPC."""
from copy import deepcopy
from threading import Lock
import time

from django.conf import settings
from django.db import DatabaseError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from Authentication.permissions import PublicReadOrAuthenticated
from .validation import MAX_SAFE_INTEGER, MAX_SYSTEMS
from .snapshot import read_snapshot

PROJECTION_TTL_SECONDS = 60
METADATA_ERRORS = (DatabaseError, ImportError, TypeError, ValueError, RuntimeError)
# One bounded public entry per process, never identities or authorization.
_projection_entry = None
_projection_lock = Lock()


def _identifier(value):
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 16:
        value = int(value)
    return value if type(value) is int and 1 <= value <= MAX_SAFE_INTEGER else None


def _name(value):
    return value[:255] if isinstance(value, str) and value.strip() else None


def _load_system_metadata(rows):
    if not rows: return {}
    from StarFieldSearch.models import Solarsystem, Region
    identifiers = [str(row['solar_system_id']) for row in rows[:MAX_SYSTEMS]]
    systems = list(Solarsystem.objects.filter(ss_id__in=identifiers)
                   .values('ss_id', 'ss_title', 'ss_titleen', 'ss_region_id')[:MAX_SYSTEMS])
    region_ids = {str(_identifier(row['ss_region_id'])) for row in systems
                  if _identifier(row['ss_region_id']) is not None}
    regions = {row['r_id']: _name(row['r_title']) or _name(row['r_titleen'])
               for row in Region.objects.filter(r_id__in=region_ids)
               .values('r_id', 'r_title', 'r_titleen')[:MAX_SYSTEMS]}
    result = {}
    for row in systems:
        identifier = _identifier(row['ss_id'])
        region_id = _identifier(row['ss_region_id'])
        if identifier is None: continue
        # Membership requires both the system FK and an actual Region row.
        if str(region_id) not in regions: region_id = None
        result[identifier] = {'system_name': _name(row['ss_title']) or _name(row['ss_titleen']),
                              'region_id': region_id, 'region_name': regions.get(str(region_id))}
    return result


def system_metadata(rows):
    """Private history callers retain their uncached, safe fallback contract."""
    try:
        return _load_system_metadata(rows)
    except METADATA_ERRORS:
        return {}


def public_projection(path):
    global _projection_entry
    # File safety and full schema validation always happen before a cache hit.
    snapshot = read_snapshot(path)
    now = time.monotonic()
    with _projection_lock:
        cached = _projection_entry
    if (cached is not None and cached[0] == str(path) and cached[1] == snapshot
            and 0 <= now - cached[2] < PROJECTION_TTL_SECONDS):
        return deepcopy(cached[3])

    cacheable = snapshot['status'] != 'unavailable'
    try:
        metadata = _load_system_metadata(snapshot['systems'])
    except METADATA_ERRORS:
        metadata, cacheable = {}, False
    unknown = {'system_name': None, 'region_id': None, 'region_name': None}
    result = {**snapshot, 'systems': [
        {**row, **metadata.get(row['solar_system_id'], unknown)} for row in snapshot['systems']]}
    if cacheable:
        # No file/DB I/O or copying under the lock. Late cold publications may
        # cause a miss, never a hit for a different freshly validated snapshot.
        entry = (str(path), deepcopy(snapshot), now, deepcopy(result))
        with _projection_lock:
            _projection_entry = entry
    return result


class AnomalyHotspotsView(APIView):
    permission_classes = [PublicReadOrAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'anomaly_hotspots'
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        return Response(public_projection(getattr(settings, 'ANOMALY_SNAPSHOT_FILE', '')),
                        headers={'Cache-Control': 'no-store'})
