"""Partial static-universe projection; never returns the full graph by default."""
from django.conf import settings
from django.core.cache import cache
from django.db import transaction
from django.db.models import Q
from TacticalBoard.models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
from .services import bad, digest, locked_org, membership, scope_data, text


@transaction.atomic
def map_data(user, organization_id):
    org = locked_org(organization_id)
    membership(user, org)
    scope = scope_data(org)
    empty = {'systems': [], 'stargates': [], 'regions': [], 'constellations': [], 'boundary_exits': [], 'scope': scope}
    if not org.region_ids:
        return empty
    key = 'tactical:graph:' + digest({'regions': sorted(org.region_ids), 'hops': org.border_hops,
                                    'data_version': getattr(settings, 'TACTICAL_GRAPH_DATA_VERSION', '1')})
    cached = cache.get(key)
    if cached is not None:
        # Cached content is exclusively static public universe geometry. Current
        # organization scope/version and permission are always resolved above.
        return {**cached, 'scope': scope}
    selected = set(BoardSystems.objects.filter(constellation__region_id__in=org.region_ids).values_list('system_id', flat=True))
    frontier = selected.copy()
    for _ in range(org.border_hops):
        edges = BoardStargates.objects.filter(Q(system_id__in=frontier) | Q(destination_system_id__in=frontier)).values_list('system_id', 'destination_system_id')
        neighbors = {sid for edge in edges for sid in edge if sid is not None} - selected
        # Validate destinations against static systems, not orphan gate IDs.
        frontier = set(BoardSystems.objects.filter(pk__in=neighbors).values_list('pk', flat=True))
        selected.update(frontier)
        if not frontier:
            break
    systems = list(BoardSystems.objects.filter(pk__in=selected).order_by('pk').values(
        'system_id', 'zh_name', 'name', 'x', 'y', 'z', 'security_status', 'constellation_id', 'constellation__region_id'))
    for row in systems:
        row['region_id'] = row.pop('constellation__region_id')
    edges = BoardStargates.objects.filter(Q(system_id__in=selected) | Q(destination_system_id__in=selected)).values_list('system_id', 'destination_system_id')
    pairs, exits = set(), set()
    for source, destination in edges:
        if destination is None:
            continue
        if source in selected and destination in selected:
            pairs.add(tuple(sorted((source, destination))))
        elif source in selected:
            exits.add((source, destination))
        elif destination in selected:
            exits.add((destination, source))
    outside = {s.pk: s.zh_name or s.name for s in BoardSystems.objects.filter(pk__in={b for _, b in exits})}
    constellation_ids = {s['constellation_id'] for s in systems}
    region_ids = {s['region_id'] for s in systems}
    result = {'systems': systems,
            'stargates': [{'system_id': a, 'destination_system_id': b} for a, b in sorted(pairs)],
            'regions': list(BoardRegions.objects.filter(pk__in=region_ids).order_by('pk').values('region_id', 'zh_name')),
            'constellations': list(BoardConstellations.objects.filter(pk__in=constellation_ids).order_by('pk').values('constellation_id', 'region_id', 'zh_name', 'x', 'y', 'z')),
            'boundary_exits': [{'system_id': a, 'destination_system_id': b, 'destination_name': outside[b]} for a, b in sorted(exits) if b in outside]}
    cache.set(key, result, timeout=300)
    return {**result, 'scope': scope}


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
    return {'results': [{'id': row.pk, 'name': row.zh_name or row.name, 'security_status': row.security_status,
                         'region_name': row.constellation.region.zh_name or row.constellation.region.name} for row in rows]}
