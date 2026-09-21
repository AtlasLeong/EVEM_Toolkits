"""Fetch public static geography into the explicitly isolated tactical demo only.

The digest is a reproducibility checksum, not a source signature or a guarantee
of current in-game accuracy. Imports upsert only: they do not remove old static
rows, synthetic fixtures, organizations or player edits. A later refresh may
therefore retain pre-existing static rows absent from its downloaded snapshot.
"""
import argparse
from datetime import datetime, timezone
import gzip
import hashlib
import importlib.util
import io
import json
import math
import os
from pathlib import Path
import re
import sys
import tempfile
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
from uuid import uuid4


SOURCE_URL = 'https://evemtk.com/api'
BACKEND = Path(__file__).resolve().parents[2] / 'backend'
FORMAT = 'evem-tactical-universe-v1'
MAX_BODY_BYTES = 16 * 1024 * 1024
LIMITS = {'regions': 1000, 'constellations': 10000, 'systems': 30000,
          'stargates': 100000, 'relations': 50000}
TABLE_KEYS = ('regions', 'constellations', 'systems', 'stargates')
DEMO_ORGANIZATION_REQUEST = '0c06871e-388c-58a6-a7b6-3bbe1e0c2c2a'


def positive_id(value):
    if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,9}', value):
        value = int(value)
    if type(value) is not int or not 0 < value <= 2147483647:
        raise ValueError('Invalid static universe identifier')
    return value


def name(value):
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > 255:
        raise ValueError('Missing or invalid static universe name')
    if any(ord(character) < 32 for character in value):
        raise ValueError('Control characters in static universe name')
    return value


def finite(value, nullable=False):
    if nullable and value is None:
        return None
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError('Static coordinates and security must be finite numbers')
    return value


def indexed(rows, key, kind):
    if not isinstance(rows, list) or len(rows) > LIMITS[kind]:
        raise ValueError(f'Invalid or oversized {kind} collection')
    result = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f'Invalid {kind} row')
        identifier = positive_id(row.get(key))
        if identifier in result:
            raise ValueError(f'Duplicate {kind} identifier')
        result[identifier] = row
    return result


def content_digest(snapshot):
    content = {key: snapshot[key] for key in TABLE_KEYS}
    content['omissions'] = snapshot['metadata']['omissions']
    encoded = json.dumps(content, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    return hashlib.sha256(encoded).hexdigest()


def normalize_snapshot(regions, constellations, systems, gates, relations):
    """Join exact IDs and names; never infer parents from position or proximity."""
    region_map = indexed(regions, 'region_id', 'regions')
    constellation_map = indexed(constellations, 'constellation_id', 'constellations')
    system_map = indexed(systems, 'system_id', 'systems')
    gate_map = indexed(gates, 'stargate_id', 'stargates')
    relation_map = indexed(relations, 'ss_id', 'relations')
    if not region_map or not system_map:
        raise ValueError('Empty public universe snapshot')
    # Validate IDs even on rows omitted later. Uninhabited, unnamed constellations
    # exposed by the public API are counted, not assigned invented parent names.
    for row in constellation_map.values():
        positive_id(row.get('region_id'))
    for row in relation_map.values():
        positive_id(row.get('ss_constellation_id'))
        positive_id(row.get('ss_region_id'))
    for row in region_map.values():
        name(row.get('zh_name'))
    normalized_systems = []
    used_constellations = set()
    used_regions = set()
    for identifier, row in sorted(system_map.items()):
        relation = relation_map.get(identifier)
        if relation is None:
            raise ValueError(f'Missing exact parent relationship for system {identifier}')
        system_name = name(row.get('zh_name'))
        if system_name != name(relation.get('ss_title')):
            raise ValueError(f'Conflicting system name for {identifier}')
        constellation_id = positive_id(relation.get('ss_constellation_id'))
        region_id = positive_id(relation.get('ss_region_id'))
        constellation = constellation_map.get(constellation_id)
        if (constellation is None or region_id not in region_map
                or positive_id(constellation.get('region_id')) != region_id):
            raise ValueError(f'Conflicting or missing parent hierarchy for {identifier}')
        if name(constellation.get('zh_name')) != name(relation.get('ss_constellation_title')):
            raise ValueError(f'Conflicting constellation name for {identifier}')
        normalized_systems.append({
            'system_id': identifier, 'zh_name': system_name,
            'constellation_id': constellation_id, 'region_id': region_id,
            'x': finite(row.get('x')), 'y': finite(row.get('y')), 'z': finite(row.get('z')),
            'security_status': finite(row.get('security_status'), nullable=True),
        })
        used_constellations.add(constellation_id)
        used_regions.add(region_id)
    normalized_constellations = [{
        'constellation_id': identifier, 'region_id': positive_id(constellation_map[identifier]['region_id']),
        'zh_name': name(constellation_map[identifier].get('zh_name')),
        **{axis: finite(constellation_map[identifier].get(axis)) for axis in ('x', 'y', 'z')},
    } for identifier in sorted(used_constellations)]
    normalized_gates, missing_gate_system_ids, excluded_gate_ids = [], set(), []
    pairs = set()
    for identifier, row in sorted(gate_map.items()):
        source = positive_id(row.get('system_id'))
        target = positive_id(row.get('destination_system_id'))
        destination_gate = row.get('destination_stargate_id')
        if destination_gate is not None:
            destination_gate = positive_id(destination_gate)
        if source == target:
            raise ValueError('Self-referencing public stargate')
        missing = {endpoint for endpoint in (source, target) if endpoint not in system_map}
        if missing:
            missing_gate_system_ids.update(missing)
            excluded_gate_ids.append(identifier)
            continue
        normalized_gates.append({'stargate_id': identifier, 'system_id': source,
                                 'destination_system_id': target, 'destination_stargate_id': destination_gate})
        pairs.add(tuple(sorted((source, target))))
    snapshot = {
        'regions': [{'region_id': identifier, 'zh_name': name(region_map[identifier]['zh_name'])}
                    for identifier in sorted(used_regions)],
        'constellations': normalized_constellations, 'systems': normalized_systems,
        'stargates': normalized_gates,
        'metadata': {
            'format': FORMAT, 'kind': 'evem-public-static-snapshot', 'source_url': SOURCE_URL,
            'counts': {'regions': len(used_regions), 'constellations': len(used_constellations),
                       'systems': len(normalized_systems), 'stargates': len(normalized_gates),
                       'undirected_gate_pairs': len(pairs)},
            'source_counts': dict(zip((*TABLE_KEYS, 'relations'), map(len, (regions, constellations, systems, gates, relations)))),
            'omissions': {
                'missing_gate_system_ids': sorted(missing_gate_system_ids),
                'excluded_gate_rows': len(excluded_gate_ids), 'excluded_gate_ids': excluded_gate_ids,
                'excluded_constellation_ids': sorted(set(constellation_map) - used_constellations),
                'excluded_region_ids': sorted(set(region_map) - used_regions),
                'relations_without_public_coordinates': sorted(set(relation_map) - set(system_map)),
            },
        },
    }
    snapshot['metadata']['sha256'] = content_digest(snapshot)
    return snapshot


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        raise HTTPError(request.full_url, code, 'Static snapshot redirects are forbidden', headers, fp)


def constellation_batches(identifiers):
    return [identifiers[index:index + 100] for index in range(0, len(identifiers), 100)]


def fetch_rows(opener, endpoint):
    fixed = {'boardregions', 'boardconstellations', 'boardsystems', 'boardstargate'}
    if endpoint not in fixed:
        if not re.fullmatch(r'solarsystem\?constellationID=[1-9][0-9]*(?:,[1-9][0-9]*){0,99}', endpoint):
            raise ValueError('Only fixed public static API paths are allowed')
        for identifier in endpoint.split('=', 1)[1].split(','):
            positive_id(identifier)
    request = Request(SOURCE_URL + '/' + endpoint, headers={
        'Accept': 'application/json', 'User-Agent': 'EVEM-Tactical-Local-Snapshot/1.0',
    }, method='GET')
    with opener.open(request, timeout=25) as response:
        if response.status != 200:
            raise ValueError('Static snapshot HTTP response was not successful')
        content_type = response.headers.get('Content-Type', '').split(';')[0].strip().lower()
        if content_type != 'application/json':
            raise ValueError('Static snapshot requires JSON')
        content_length = response.headers.get('Content-Length')
        if content_length is not None and (not content_length.isdigit() or int(content_length) > MAX_BODY_BYTES):
            raise ValueError('Static snapshot body exceeds safe bounds')
        body = response.read(MAX_BODY_BYTES + 1)
        encoding = response.headers.get('Content-Encoding', 'identity').strip().lower()
    if len(body) > MAX_BODY_BYTES:
        raise ValueError('Static snapshot body exceeds safe bounds')
    if encoding == 'gzip':
        try:
            with gzip.GzipFile(fileobj=io.BytesIO(body)) as compressed:
                body = compressed.read(MAX_BODY_BYTES + 1)
        except (OSError, EOFError) as error:
            raise ValueError('Invalid compressed static snapshot') from error
        if len(body) > MAX_BODY_BYTES:
            raise ValueError('Expanded static snapshot body exceeds safe bounds')
    elif encoding != 'identity':
        raise ValueError('Unsupported static snapshot encoding')
    try:
        rows = json.loads(body.decode('utf-8'), parse_constant=lambda value: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))
    except (ValueError, UnicodeError) as error:
        raise ValueError('Invalid static snapshot JSON') from error
    if not isinstance(rows, list) or len(rows) > max(LIMITS.values()):
        raise ValueError('Static snapshot response must be a bounded list')
    return rows


def fetch_snapshot():
    # No credentials, proxy credentials, cookies, redirect, arbitrary host or POST.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    regions, constellations, systems, gates = [fetch_rows(opener, path) for path in (
        'boardregions', 'boardconstellations', 'boardsystems', 'boardstargate')]
    constellation_ids = sorted(indexed(constellations, 'constellation_id', 'constellations'))
    relations = []
    for batch in constellation_batches(constellation_ids):
        relations.extend(fetch_rows(opener, 'solarsystem?constellationID=' + ','.join(map(str, batch))))
        if len(relations) > LIMITS['relations']:
            raise ValueError('Static parent relationships exceed safe bounds')
    snapshot = normalize_snapshot(regions, constellations, systems, gates, relations)
    snapshot['metadata']['retrieved_at'] = datetime.now(timezone.utc).isoformat()
    return snapshot


def snapshot_path(backend):
    target = Path(backend) / '.tactical-universe.json'
    for path in (target, *target.parents):
        if path.is_symlink():
            raise ValueError('Refusing a symlinked snapshot path')
    if target.exists() and not target.is_file():
        raise ValueError('Snapshot path must be a regular file')
    return target


def require_local_environment():
    """Refuse production settings, alternate databases and uninitialized demos."""
    from django.conf import settings
    from django.db import connection
    spec = importlib.util.spec_from_file_location('tactical_snapshot_local_seed', Path(__file__).with_name('local_seed.py'))
    local_seed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(local_seed)
    local_seed.require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], BACKEND)
    if not getattr(settings, 'TACTICAL_LOCAL_DEMO', False):
        raise ValueError('TACTICAL_LOCAL_DEMO is required')
    database = Path(settings.DATABASES['default']['NAME'])
    if not database.is_file():
        raise ValueError('Run local_seed.py first; the isolated demo database must already exist')
    snapshot_path(BACKEND)
    required = {'board_regions', 'board_constellations', 'board_systems', 'board_stargates',
                'TacticalCollaboration_organization', 'TacticalCollaboration_membership'}
    if not required.issubset(set(connection.introspection.table_names())):
        raise ValueError('Run local_seed.py first; isolated demo tables are missing')
    return BACKEND


def seed_real_organization(snapshot):
    """Create this fixture only once, even if its owner later renames the board."""
    from django.contrib.auth import get_user_model
    from django.utils import timezone as django_timezone
    from TacticalCollaboration import services
    from TacticalCollaboration.models import CommandReceipt, Membership, Organization
    users = {}
    User = get_user_model()
    founder = User.objects.filter(username='tactical_demo_founder').first()
    if founder is None:
        raise ValueError('Run local_seed.py first; founder fixture is missing')
    receipt = CommandReceipt.objects.filter(actor=founder, scope='create', request_id=DEMO_ORGANIZATION_REQUEST).first()
    if receipt:
        # Never reset scope, membership, force edits, removals or credentials.
        organization_id = receipt.result['id']
        if not Organization.objects.filter(pk=organization_id, founder=founder).exists():
            raise ValueError('Real demo receipt no longer refers to its original organization')
        return {'organization_id': organization_id, 'created': False}
    users['founder'] = founder
    for role in ('commander', 'scout'):
        users[role] = User.objects.filter(username=f'tactical_demo_{role}', is_active=True).first()
        if users[role] is None:
            raise ValueError(f'Run local_seed.py first; active {role} fixture is missing')
    selected = sorted(row['system_id'] for row in snapshot['systems'] if row['region_id'] == 10000001)
    if len(selected) < 5:
        raise ValueError('The public Derelik snapshot must contain five real systems for the exercise')
    result = services.create_organization(founder, {
        'name': '真实星图 · 本地演习', 'request_id': DEMO_ORGANIZATION_REQUEST,
    })
    organization = Organization.objects.get(pk=result['id'])
    for role in ('commander', 'scout'):
        Membership.objects.create(organization=organization, user=users[role], role=role)
    connection_id = str(uuid4())
    services.admit(founder, organization.pk, connection_id)

    def command(action, **payload):
        return services.command(founder, organization.pk, {
            'action': action, 'request_id': str(uuid4()), 'connection_id': connection_id, **payload,
        })

    command('scope.update', expected_version=1, region_ids=[10000001], border_hops=1)
    for system_id, (label, side, people, ships) in zip(selected, [
        ('演示敌方主力', 'enemy', 68, {'battleship': 42, 'cruiser': 18, 'dreadnought': 3}),
        ('演示敌方机动队', 'enemy', 24, {'cruiser': 18, 'battleship': 6}),
        ('演示敌方旗舰群', 'enemy', 12, {'light_carrier': 4, 'dreadnought': 6, 'heavy_carrier': 2}),
        ('演示我方主力', 'friendly', 82, {'battleship': 60, 'cruiser': 20}),
        ('演示我方支援', 'friendly', 16, {'light_carrier': 5, 'cruiser': 10}),
    ]):
        command('force.create', name=label, side=side, system_id=system_id, people=people, ships=ships,
                notes='本地交互演示数据，非真实军情；星系位置来自公开静态星图。',
                observed_at=django_timezone.now().isoformat())
    services.leave(founder, organization.pk, connection_id)
    return {'organization_id': organization.pk, 'created': True}


def publish_bytes(target, payload):
    """Replace only the fixed sibling file; clean up only our exact temp path."""
    snapshot_path(target.parent)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode='wb', prefix='.tactical-universe-', suffix='.tmp',
                                         dir=target.parent, delete=False) as output:
            temporary = Path(output.name)
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        snapshot_path(target.parent)
        os.replace(temporary, target)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()


def import_snapshot(snapshot):
    backend = require_local_environment()
    from django.core.cache import cache
    from django.db import transaction
    from TacticalBoard.models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
    metadata = snapshot.get('metadata', {})
    if (metadata.get('format') != FORMAT or metadata.get('source_url') != SOURCE_URL
            or metadata.get('sha256') != content_digest(snapshot)):
        raise ValueError('Snapshot format, source or content digest does not match')
    try:
        retrieved = datetime.fromisoformat(metadata.get('retrieved_at', ''))
    except (TypeError, ValueError) as error:
        raise ValueError('Snapshot retrieval timestamp is missing') from error
    if retrieved.utcoffset() is None:
        raise ValueError('Snapshot retrieval timestamp needs an explicit timezone')
    target = snapshot_path(backend)
    if target.exists() and target.stat().st_size > MAX_BODY_BYTES:
        raise ValueError('Existing snapshot exceeds safe bounds')
    previous = target.read_bytes() if target.exists() else None
    payload = json.dumps(snapshot, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(payload) > MAX_BODY_BYTES:
        raise ValueError('Normalized snapshot exceeds safe bounds')
    published = False
    try:
        with transaction.atomic():
            imports = [
                (BoardRegions, 'region_id', ['name', 'zh_name'], [
                    BoardRegions(region_id=row['region_id'], name=row['zh_name'], zh_name=row['zh_name'])
                    for row in snapshot['regions']]),
                (BoardConstellations, 'constellation_id', ['region', 'name', 'zh_name', 'x', 'y', 'z'], [
                    BoardConstellations(**row, name=row['zh_name']) for row in snapshot['constellations']]),
                (BoardSystems, 'system_id', ['constellation', 'name', 'zh_name', 'x', 'y', 'z', 'security_status'], [
                    BoardSystems(**{key: value for key, value in row.items() if key != 'region_id'}, name=row['zh_name'])
                    for row in snapshot['systems']]),
                (BoardStargates, 'stargate_id', ['system', 'destination_system_id', 'destination_stargate_id'], [
                    BoardStargates(**row, name='') for row in snapshot['stargates']]),
            ]
            for model, key, fields, rows in imports:
                model.objects.bulk_create(rows, batch_size=100, update_conflicts=True,
                                          update_fields=fields, unique_fields=[key])
            result = seed_real_organization(snapshot)
            publish_bytes(target, payload)
            published = True
            transaction.on_commit(cache.clear)
        return {**result, 'sha256': metadata['sha256'], 'counts': metadata['counts']}
    except Exception:
        # A filesystem error rolls back the transaction. If database commit itself
        # fails after replacement, restore the prior file before propagating it.
        if published:
            if previous is None:
                snapshot_path(backend).unlink()
            else:
                publish_bytes(target, previous)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['fetch-import'])
    parser.parse_args()
    local_settings = 'EVE_MDjango.tactical_local_settings'
    if os.environ.get('DJANGO_SETTINGS_MODULE', local_settings) != local_settings:
        raise ValueError('Production or unknown settings are forbidden')
    os.environ['DJANGO_SETTINGS_MODULE'] = local_settings
    sys.path.insert(0, str(BACKEND))
    import django
    django.setup()
    require_local_environment()
    result = import_snapshot(fetch_snapshot())
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == '__main__':
    main()
