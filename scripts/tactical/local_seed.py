"""Create synthetic tactical demo fixtures in one explicitly isolated SQLite DB."""
import argparse
import math
import os
from pathlib import Path
import sys
from uuid import uuid4

LOCAL_SETTINGS = 'EVE_MDjango.tactical_local_settings'
DEMO_PASSWORD = 'TacticalLocal2026'


def require_local(settings_name, database, backend):
    expected = Path(backend) / '.tactical-local.sqlite3'
    configured = Path(database.get('NAME', ''))
    if expected.is_symlink() or configured.is_symlink():
        raise ValueError('Refusing a symlinked demo database')
    if settings_name != LOCAL_SETTINGS or database.get('ENGINE') not in ('django.db.backends.sqlite3', 'EVE_MDjango.tactical_sqlite') or configured.resolve() != expected.resolve():
        raise ValueError('Refusing seed outside the isolated tactical demo database')


def demo_graph():
    regions = [{'region_id': 99000001 + index, 'name': name}
               for index, name in enumerate(['北境演习区', '晨曦演习区', '远航演习区'])]
    systems, gates = [], []
    labels = ['边境门户', '晨星基地', '前沿哨站', '赤道中继', '星环港', '静默前线', '深空关隘', '北境枢纽']
    for region_index, region in enumerate(regions):
        for index, label in enumerate(labels):
            angle = index * math.pi / 4
            system_id = 99001001 + region_index * 8 + index
            systems.append({
                'system_id': system_id, 'name': f'{label} {region_index + 1}',
                'region_id': region['region_id'], 'constellation_id': 99000101 + region_index,
                'x': (math.cos(angle) * 270 + region_index * 630) * 1e15,
                'y': 0, 'z': (math.sin(angle) * 220 + (region_index % 2) * 170) * 1e15,
                'security_status': round(0.4 - index * 0.12, 2),
            })
            gates.append((system_id, 99001001 + region_index * 8 + (index + 1) % 8))
        if region_index:
            gates.append((99001001 + (region_index - 1) * 8, 99001005 + region_index * 8))
    return regions, systems, gates


def initialize(load_accounts=0):
    backend = Path(__file__).resolve().parents[2] / 'backend'
    sys.path.insert(0, str(backend))
    current = os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS)
    if current != LOCAL_SETTINGS:
        raise ValueError('Production or unknown settings are forbidden')
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    import django
    django.setup()
    from django.conf import settings
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    from django.core.management import call_command
    call_command('migrate', interactive=False, verbosity=0)
    from django.contrib.auth import get_user_model
    from django.db import connection
    from django.utils import timezone
    from TacticalBoard.models import BoardRegions, BoardConstellations, BoardSystems, BoardStargates
    from TacticalCollaboration.models import Organization, Membership
    from TacticalCollaboration import services
    with connection.cursor() as cursor:
        cursor.execute('PRAGMA journal_mode=WAL')
    existing = set(connection.introspection.table_names())
    with connection.schema_editor() as editor:
        for model in [BoardRegions, BoardConstellations, BoardSystems, BoardStargates]:
            if model._meta.db_table not in existing:
                editor.create_model(model)
    regions, systems, gates = demo_graph()
    for region in regions:
        BoardRegions.objects.update_or_create(region_id=region['region_id'], defaults={
            'name': region['name'], 'zh_name': region['name'], 'description': 'Synthetic local exercise only',
        })
    for index, region in enumerate(regions):
        BoardConstellations.objects.update_or_create(constellation_id=99000101 + index, defaults={
            'region_id': region['region_id'], 'name': f'演习星座 {index + 1}', 'zh_name': f'演习星座 {index + 1}',
            'x': index * 630e15, 'y': 0, 'z': 0,
        })
    for system in systems:
        record = {key: value for key, value in system.items() if key not in ('system_id', 'region_id')}
        record['zh_name'] = record['name']
        BoardSystems.objects.update_or_create(system_id=system['system_id'], defaults=record)
    for index, (left, right) in enumerate(gates):
        BoardStargates.objects.update_or_create(stargate_id=99002001 + index, defaults={
            'system_id': left, 'destination_system_id': right, 'name': '演习星门',
        })
    users = {}
    for role, name in [('founder', '北境统帅'), ('commander', '舰队指挥'), ('scout', '前线斥候'), ('newcomer', '新飞行员')]:
        user, created = get_user_model().objects.get_or_create(username=f'tactical_demo_{role}', defaults={
            'email': f'{role}@tactical.local', 'first_name': name,
        })
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=['password'])
        users[role] = user
    org = Organization.objects.filter(name='北境联合 · 本地演习', founder=users['founder']).first()
    created_board = org is None
    if created_board:
        services.create_organization(users['founder'], {'name': '北境联合 · 本地演习', 'request_id': str(uuid4())})
        org = Organization.objects.get(name='北境联合 · 本地演习', founder=users['founder'])
    for role in ('commander', 'scout'):
        Membership.objects.get_or_create(organization=org, user=users[role], defaults={'role': role})
    if created_board:
        cid = str(uuid4())
        services.admit(users['founder'], org.pk, cid)
        def command(action, **payload):
            return services.command(users['founder'], org.pk, {
                'action': action, 'request_id': str(uuid4()), 'connection_id': cid, **payload,
            })
        command('scope.update', expected_version=1, region_ids=[regions[0]['region_id'], regions[1]['region_id']], border_hops=1)
        for name, side, system_id, people, ships in [
            ('敌方主力 A', 'enemy', 99001001, 68, {'battleship': 42, 'cruiser': 18, 'dreadnought': 3}),
            ('敌方机动队', 'enemy', 99001005, 24, {'cruiser': 18, 'battleship': 6}),
            ('敌方旗舰集群', 'enemy', 99001010, 12, {'light_carrier': 4, 'dreadnought': 6, 'heavy_carrier': 2}),
            ('我方主力编队', 'friendly', 99001003, 82, {'battleship': 60, 'cruiser': 20}),
            ('我方支援编队', 'friendly', 99001009, 16, {'light_carrier': 5, 'cruiser': 10}),
        ]:
            command('force.create', name=name, side=side, system_id=system_id, people=people, ships=ships,
                    notes='本地演示数据，不代表真实战局。', observed_at=timezone.now().isoformat())
        services.leave(users['founder'], org.pk, cid)
        scout_cid = str(uuid4())
        services.admit(users['scout'], org.pk, scout_cid)
        services.command(users['scout'], org.pk, {
            'action': 'report.create', 'request_id': str(uuid4()), 'connection_id': scout_cid,
            'system_id': 99001007, 'people': 32, 'ships': {'battleship': 20, 'cruiser': 8},
            'notes': '星门附近发现敌方集结，尚未确认是否为主力分队。', 'observed_at': timezone.now().isoformat(),
        })
        services.leave(users['scout'], org.pk, scout_cid)
    if load_accounts:
        load_org, _ = Organization.objects.get_or_create(name='容量验证 · 隔离演习', founder=users['founder'])
        Membership.objects.get_or_create(organization=load_org, user=users['founder'], defaults={'role': 'founder'})
        for index in range(load_accounts):
            user, _ = get_user_model().objects.get_or_create(username=f'tactical_load_{index:03d}')
            Membership.objects.get_or_create(organization=load_org, user=user, defaults={'role': 'scout'})
    print(f'Isolated demo ready. Organization ID: {org.pk}. Synthetic systems: {len(systems)}.')
    print('Demo users: founder@tactical.local, commander@tactical.local, scout@tactical.local, newcomer@tactical.local')
    print('Local-only demo password is documented in scripts/tactical/README.md; never use it on production.')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--load-accounts', type=int, default=0, choices=range(0, 102), metavar='0..101')
    arguments = parser.parse_args()
    initialize(arguments.load_accounts)
