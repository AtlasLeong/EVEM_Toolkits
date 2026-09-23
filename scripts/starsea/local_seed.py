"""Provision a separate Starsea preview without changing an existing user or post."""
import os
import importlib.util
import json
from pathlib import Path
import sys

LOCAL_SETTINGS = 'EVE_MDjango.starsea_local_settings'
DEMO_PASSWORD = 'Starsea2026'


def require_local(settings_name, database, backend):
    expected = Path(backend) / '.starsea-local.sqlite3'
    configured = Path(database.get('NAME', ''))
    if expected.is_symlink() or configured.is_symlink():
        raise ValueError('Refusing a symlinked preview database')
    if settings_name != LOCAL_SETTINGS or database.get('ENGINE') != 'django.db.backends.sqlite3' or configured.resolve() != expected.resolve():
        raise ValueError('Refusing writes outside the separate Starsea preview database')


def read_geography(path):
    """Use the existing local public snapshot; never fetch or copy tactical records."""
    path = Path(path)
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError('Missing or unsafe offline geography snapshot')
    spec = importlib.util.spec_from_file_location('starsea_geography_validation', Path(__file__).resolve().parents[1] / 'tactical/real_universe.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    snapshot = json.loads(path.read_text(encoding='utf-8'))
    try:
        metadata = snapshot['metadata']
        if (metadata['format'] != module.FORMAT or metadata['sha256'] != module.content_digest(snapshot)
                or metadata.get('kind') != 'evem-public-static-snapshot' or metadata.get('source_url') != module.SOURCE_URL):
            raise ValueError('Offline geography checksum mismatch')
        for key in ('regions', 'constellations', 'systems'):
            if not isinstance(snapshot[key], list) or len(snapshot[key]) > module.LIMITS[key]:
                raise ValueError('Oversized offline geography')
        if not snapshot['regions'] or not snapshot['systems']:
            raise ValueError('Empty offline geography')
        region_map = module.indexed(snapshot['regions'], 'region_id', 'regions')
        constellation_map = module.indexed(snapshot['constellations'], 'constellation_id', 'constellations')
        module.indexed(snapshot['systems'], 'system_id', 'systems')
        for kind in ('regions', 'constellations', 'systems'):
            if metadata['counts'].get(kind) != len(snapshot[kind]):
                raise ValueError('Geography counts do not match')
            for row in snapshot[kind]:
                module.name(row.get('zh_name')).encode('utf-8')
                if kind != 'regions':
                    if module.positive_id(row.get('region_id')) not in region_map:
                        raise ValueError('Unknown region parent')
                    for axis in ('x', 'y', 'z'):
                        module.finite(row.get(axis))
                if kind == 'systems':
                    parent = constellation_map.get(module.positive_id(row.get('constellation_id')))
                    if not parent or parent['region_id'] != row['region_id']:
                        raise ValueError('Invalid system parent hierarchy')
                    module.finite(row.get('security_status'), nullable=True)
    except (KeyError, TypeError) as exc:
        raise ValueError('Invalid offline geography') from exc
    return snapshot


def seed_geography(backend):
    from django.conf import settings
    from django.db import connection, transaction
    from TacticalBoard.models import BoardRegions, BoardConstellations, BoardSystems
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    snapshot = read_geography(Path(backend) / '.tactical-universe.json')
    tables = set(connection.introspection.table_names())
    with connection.schema_editor() as editor:
        for model in (BoardRegions, BoardConstellations, BoardSystems):
            if model._meta.db_table not in tables:
                editor.create_model(model)
    with transaction.atomic():
        BoardRegions.objects.bulk_create([BoardRegions(region_id=row['region_id'], name=row['zh_name'], zh_name=row['zh_name']) for row in snapshot['regions']], ignore_conflicts=True)
        BoardConstellations.objects.bulk_create([BoardConstellations(**row, name=row['zh_name']) for row in snapshot['constellations']], ignore_conflicts=True)
        BoardSystems.objects.bulk_create([BoardSystems(**{key: value for key, value in row.items() if key != 'region_id'}, name=row['zh_name']) for row in snapshot['systems']], ignore_conflicts=True)
    print(f"Offline geography ready: {len(snapshot['systems'])} real static systems; no tactical/user records copied.")


def initialize():
    backend = Path(__file__).resolve().parents[2] / 'backend'
    current = os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS)
    if current != LOCAL_SETTINGS:
        raise ValueError('Production or unknown settings are forbidden')
    sys.path.insert(0, str(backend))
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    import django
    django.setup()
    from django.conf import settings
    from django.core.management import call_command
    from django.contrib.auth import get_user_model
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    read_geography(backend / '.tactical-universe.json')
    call_command('migrate', interactive=False, verbosity=0)
    seed_geography(backend)
    root = Path(settings.STARSEA_UPLOAD_ROOT)
    if root.is_symlink() or root.resolve().is_relative_to(backend.resolve()):
        raise ValueError('Refusing an unsafe image directory')
    root.mkdir(parents=True, exist_ok=True)
    for role, name, staff in [('pilot', '星海记录员', False), ('reviewer', '星海审核员', True), ('another', '另一位飞行员', False)]:
        user, created = get_user_model().objects.get_or_create(username=f'starsea_preview_{role}', defaults={
            'email': f'{role}@starsea.local', 'first_name': name, 'is_staff': staff,
        })
        if created:
            user.set_password(DEMO_PASSWORD)
            user.save(update_fields=['password'])
    print('Starsea isolated accounts ready; existing passwords and posts are unchanged.')


if __name__ == '__main__':
    initialize()
