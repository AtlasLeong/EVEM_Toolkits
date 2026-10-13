"""Public sanitized stored counts only; HTTP requests never trigger game RPC."""
from django.conf import settings
from django.db import DatabaseError
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from Authentication.permissions import PublicReadOrAuthenticated
from .protocol import MAX_SAFE_INTEGER, MAX_SYSTEMS
from .snapshot import read_snapshot


def _identifier(value):
    if isinstance(value, str) and value.isascii() and value.isdecimal() and len(value) <= 16:
        value = int(value)
    return value if type(value) is int and 1 <= value <= MAX_SAFE_INTEGER else None


def _name(value):
    return value[:255] if isinstance(value, str) and value.strip() else None


def system_metadata(rows):
    if not rows: return {}
    try:
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
    except (DatabaseError, ImportError, TypeError, ValueError, RuntimeError):
        return {}


class AnomalyHotspotsView(APIView):
    permission_classes = [PublicReadOrAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'anomaly_hotspots'
    http_method_names = ['get', 'head', 'options']

    def get(self, request):
        snapshot = read_snapshot(getattr(settings, 'ANOMALY_SNAPSHOT_FILE', ''))
        metadata = system_metadata(snapshot['systems'])
        unknown = {'system_name': None, 'region_id': None, 'region_name': None}
        return Response({**snapshot, 'systems': [
            {**row, **metadata.get(row['solar_system_id'], unknown)} for row in snapshot['systems']]},
            headers={'Cache-Control': 'no-store'})
