"""Partial static-universe projection; never returns the full graph by default."""
import math
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from TacticalBoard.models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
from .services import bad, digest, locked_org, membership, scope_data, text


def data_source(systems):
    # The reserved 99xxxxxx IDs belong only to our explicit loopback fixture.
    # Production static tables are never reclassified from a client flag.
    if not systems:
        kind, label = 'empty', '未加载星图'
    elif getattr(settings, 'TACTICAL_LOCAL_DEMO', False):
        synthetic = sum(99000000 <= row['system_id'] < 100000000 for row in systems)
        kind = 'synthetic-demo' if synthetic == len(systems) else 'mixed' if synthetic else 'static-board'
        label = {'synthetic-demo': '本地虚构演习星图', 'mixed': '混合演习星图',
                 'static-board': 'EVEM 公开静态星图快照'}[kind]
    else:
        kind, label = 'static-board', 'EVEM 静态星图'
    return {'kind': kind, 'label': label, 'is_real': kind == 'static-board'}


def sanitize_optional_numbers(rows, fields):
    count = 0
    for row in rows:
        for field in fields:
            value = row[field]
            if value is not None and (not isinstance(value, (int, float)) or not math.isfinite(value)):
                row[field] = None
                count += 1
    return count


@transaction.atomic
def map_data(user, organization_id):
    org = locked_org(organization_id)
    membership(user, org)
    return {**static_projection(org.region_ids, org.border_hops), 'scope': scope_data(org)}


def static_projection(region_ids, border_hops):
    """Public geometry only; callers resolve current authorization/scope first.

    Snapshot annotations and the map deliberately share this projection so
    missing coordinates and border expansion cannot produce different scopes.
    Never cache organization metadata or any member/deployment data here.
    """
    empty = {'systems': [], 'stargates': [], 'regions': [], 'constellations': [], 'boundary_exits': [],
             'data_source': data_source([]), 'warnings': []}
    if not region_ids:
        return empty
    key = 'tactical:graph:' + digest({'regions': sorted(region_ids), 'hops': border_hops,
                                    'schema': 2, 'local_demo': getattr(settings, 'TACTICAL_LOCAL_DEMO', False),
                                    'data_version': getattr(settings, 'TACTICAL_GRAPH_DATA_VERSION', '1')})
    cached = cache.get(key)
    if cached is not None:
        # Cached content is exclusively static public universe geometry. The
        # authorized callers always resolve live organization scope/permission.
        return cached
    selected = set(BoardSystems.objects.filter(constellation__region_id__in=region_ids).values_list('system_id', flat=True))
    frontier = selected.copy()
    for _ in range(border_hops):
        edges = BoardStargates.objects.filter(Q(system_id__in=frontier) | Q(destination_system_id__in=frontier)).values_list('system_id', 'destination_system_id')
        neighbors = {sid for edge in edges for sid in edge if sid is not None} - selected
        # Validate destinations against static systems, not orphan gate IDs.
        frontier = set(BoardSystems.objects.filter(pk__in=neighbors).values_list('pk', flat=True))
        selected.update(frontier)
        if not frontier:
            break
    systems = list(BoardSystems.objects.filter(pk__in=selected).order_by('pk').values(
        'system_id', 'zh_name', 'name', 'x', 'y', 'z', 'security_status', 'constellation_id', 'constellation__region_id'))
    valid = [row for row in systems if all(isinstance(row[axis], (int, float)) and math.isfinite(row[axis]) for axis in ('x', 'z'))]
    warnings = [{'code': 'missing_coordinates', 'count': len(systems) - len(valid)}] if len(valid) != len(systems) else []
    systems = valid
    drawable = {row['system_id'] for row in systems}
    for row in systems:
        row['region_id'] = row.pop('constellation__region_id')
    edges = BoardStargates.objects.filter(Q(system_id__in=selected) | Q(destination_system_id__in=selected)).values_list('system_id', 'destination_system_id')
    pairs, exits = set(), set()
    for source, destination in edges:
        if destination is None:
            continue
        if source in drawable and destination in drawable:
            pairs.add(tuple(sorted((source, destination))))
        elif source in drawable and destination not in selected:
            exits.add((source, destination))
        elif destination in drawable and source not in selected:
            exits.add((destination, source))
    outside = {s.pk: s.zh_name or s.name for s in BoardSystems.objects.filter(pk__in={b for _, b in exits})}
    constellation_ids = {s['constellation_id'] for s in systems}
    region_ids = {s['region_id'] for s in systems}
    result = {'systems': systems, 'data_source': data_source(systems), 'warnings': warnings,
            'stargates': [{'system_id': a, 'destination_system_id': b} for a, b in sorted(pairs)],
            'regions': list(BoardRegions.objects.filter(pk__in=region_ids).order_by('pk').values('region_id', 'zh_name')),
            'constellations': list(BoardConstellations.objects.filter(pk__in=constellation_ids).order_by('pk').values('constellation_id', 'region_id', 'zh_name', 'x', 'y', 'z')),
            'boundary_exits': [{'system_id': a, 'destination_system_id': b, 'destination_name': outside[b]} for a, b in sorted(exits) if b in outside]}
    # Optional legacy numeric columns must remain JSON-safe on cold AND cached
    # reads; invalid plane coordinates were already excluded, never fabricated.
    invalid_fields = sanitize_optional_numbers(systems, ('y', 'security_status'))
    invalid_fields += sanitize_optional_numbers(result['constellations'], ('x', 'y', 'z'))
    if invalid_fields:
        warnings.append({'code': 'nonfinite_fields', 'count': invalid_fields})
    cache.set(key, result, timeout=300)
    return result


@transaction.atomic
def catalog(user, organization_id, kind, query):
    org = locked_org(organization_id)
    membership(user, org)
    if kind == 'regions':
        return {'results': [{'id': r.pk, 'name': r.zh_name or r.name} for r in BoardRegions.objects.order_by('region_id')[:500]]}
    if kind != 'systems':
        bad('不支持的目录类型。')
    query = text(query, 80, blank=True)
    if not query:
        return {'results': []}
    rows = BoardSystems.objects.filter(Q(zh_name__icontains=query) | Q(name__icontains=query)).select_related('constellation__region').order_by('pk')[:30]
    results = [{'id': row.pk, 'name': row.zh_name or row.name, 'security_status': row.security_status,
                'region_name': row.constellation.region.zh_name or row.constellation.region.name} for row in rows]
    sanitize_optional_numbers(results, ('security_status',))
    return {'results': results}
