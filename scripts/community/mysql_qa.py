"""Opt-in Community MySQL rehearsal. Default is a non-networked plan.

Creates one new QA schema; never selects business databases or drops schemas.
Read this script and README before an explicitly authorized --execute run.
"""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import sys
import tempfile
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event
from uuid import uuid4


class SafetyError(Exception):
    pass


class CheckFailed(Exception):
    pass


def require(condition, label):
    if not condition:
        raise CheckFailed(label)


def validate_schema(name):
    if not isinstance(name, str) or not re.fullmatch(r'evem_community_qa_[a-z0-9_]{12,40}', name):
        raise SafetyError('Database name is outside the strict QA whitelist')
    return name


def validate_database_map(mapping, name):
    validate_schema(name)
    if set(mapping) != {'default'}:
        raise SafetyError('Only one isolated default database alias is allowed')
    config = mapping['default']
    if config.get('ENGINE') != 'django.db.backends.mysql' or config.get('NAME') != name or config.get('TEST', {}).get('NAME') != name:
        raise SafetyError('Database alias or test name does not match the QA schema')


def confirm_execution(name, confirmation):
    validate_schema(name)
    if confirmation != name:
        raise SafetyError('Execution requires an exact --confirm-new-database match')


def load_credentials(path, environ=None):
    # Match deployed settings' .env precedence without executing/importing them.
    keys = ('DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT')
    source = os.environ if environ is None else environ
    result = {key: source.get(key, '') for key in keys}
    env_path = Path(path) / '.env'
    if env_path.exists():
        for raw in env_path.read_text(encoding='utf-8-sig').splitlines():
            line = raw.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            if key.strip() in keys:
                result[key.strip()] = value.strip()
    if any(not result[key] for key in keys):
        raise SafetyError('Required DB configuration is missing; values are not logged')
    if not result['DB_PORT'].isascii() or not result['DB_PORT'].isdecimal() or not 1 <= int(result['DB_PORT']) <= 65535:
        raise SafetyError('Invalid DB port')
    return result


def create_schema(name, credentials, connector):
    validate_schema(name)
    if name == credentials['DB_NAME']:
        raise SafetyError('QA name must differ from the live database')
    # Intentionally no db/database argument: no business schema is selected.
    connection = connector(host=credentials['DB_HOST'], port=int(credentials['DB_PORT']),
                           user=credentials['DB_USER'], passwd=credentials['DB_PASSWORD'],
                           charset='utf8mb4', connect_timeout=10)
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT 1 FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s', [name])
            if cursor.fetchone() is not None:
                raise SafetyError('QA schema already exists; reuse is forbidden')
            # Identifer is strictly whitelisted; CREATE fails if a concurrent run won.
            cursor.execute(f'CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci')
    finally:
        connection.close()


def configure_isolated_django(candidate, name, credentials, media_root):
    import django
    from django.conf import settings
    if settings.configured:
        raise SafetyError('Run in a fresh process; existing Django settings are forbidden')
    os.environ.pop('DJANGO_SETTINGS_MODULE', None)
    sys.path.insert(0, str(candidate))
    databases = {'default': {
        'ENGINE': 'django.db.backends.mysql', 'NAME': name,
        'USER': credentials['DB_USER'], 'PASSWORD': credentials['DB_PASSWORD'],
        'HOST': credentials['DB_HOST'], 'PORT': credentials['DB_PORT'],
        'CONN_MAX_AGE': 0, 'TEST': {'NAME': name},
        'OPTIONS': {'charset': 'utf8mb4', 'init_command': 'SET SESSION innodb_lock_wait_timeout=5'},
    }}
    validate_database_map(databases, name)
    settings.configure(
        SECRET_KEY=secrets.token_hex(32), DEBUG=False, USE_TZ=False, TIME_ZONE='Asia/Shanghai',
        ALLOWED_HOSTS=['testserver', 'localhost'],
        INSTALLED_APPS=['django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework', 'Authentication', 'Community'],
        AUTH_USER_MODEL='Authentication.EVEMUser', DATABASES=databases, DATABASE_ROUTERS=[],
        ROOT_URLCONF='_community_mysql_qa_urls', MIDDLEWARE=[],
        DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        PASSWORD_HASHERS=['django.contrib.auth.hashers.MD5PasswordHasher'],
        EMAIL_BACKEND='django.core.mail.backends.locmem.EmailBackend',
        COMMUNITY_UPLOAD_ROOT=str(media_root), COMMUNITY_CLAIMS_PER_DAY=100,
        REST_FRAMEWORK={'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication']},
    )
    django.setup()
    from django.urls import include, path
    urls = types.ModuleType('_community_mysql_qa_urls')
    urls.urlpatterns = [path('api/community/', include('Community.urls'))]
    sys.modules[urls.__name__] = urls
    validate_database_map(settings.DATABASES, name)


def assert_qa_connections(name):
    from django.conf import settings
    from django.db import connections
    validate_database_map(settings.DATABASES, name)
    validate_database_map(connections.databases, name)
    if set(connections) != {'default'}:
        raise SafetyError('Unexpected database alias')
    for alias in connections:
        connection = connections[alias]
        validate_database_map({'default': connection.settings_dict}, name)
        with connection.cursor() as cursor:
            cursor.execute('SELECT DATABASE()')
            if cursor.fetchone()[0] != name:
                raise SafetyError('Actual connection is not the QA database')


def request(user, method, path, payload=None, multipart=False):
    from rest_framework.test import APIClient
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return getattr(client, method)('/api/community/' + path, payload, format='multipart' if multipart else 'json')


def fixture_user(label, staff=False):
    from django.contrib.auth import get_user_model
    token = uuid4().hex
    return get_user_model().objects.create_user(username=f'{label}_{token}', email=f'{token}@example.invalid', is_staff=staff)


def claim(user, corporation_id=None):
    data = dict(request_id=str(uuid4()), statement='Isolated QA ownership proof', contact='qa@example.invalid')
    if corporation_id is None:
        data.update(name='QA-' + uuid4().hex, short_name='QA')
    else:
        data['corporation_id'] = corporation_id
    response = request(user, 'post', 'claims/', data)
    require(response.status_code == 201, f'claim status={response.status_code}')
    return response.data


def approved_owner(owner, staff):
    application = claim(owner)
    response = request(staff, 'post', f"reviews/claims/{application['id']}/decision/", {'decision': 'approve', 'reason': 'QA'})
    require(response.status_code == 200, f'ownership approval status={response.status_code}')
    return application['corporation']['id']


def draft(owner, corporation_id):
    response = request(owner, 'post', f'corporations/{corporation_id}/draft/', {'request_id': str(uuid4())})
    require(response.status_code == 201, f'draft status={response.status_code}')
    return response.data


def pending_revision(owner, corporation_id):
    revision = draft(owner, corporation_id)
    response = request(owner, 'patch', f"revisions/{revision['id']}/", {'expected_version': revision['version'], 'introduction': 'QA introduction', 'public_contact': 'qa@example.invalid'})
    require(response.status_code == 200, f'patch status={response.status_code}')
    response = request(owner, 'post', f"revisions/{revision['id']}/submit/", {'expected_version': response.data['version']})
    require(response.status_code == 200, f'submit status={response.status_code}')
    return response.data


def parallel_calls(name, operations, hooks=None):
    """Run each operation on its own verified connection; record only DB error codes."""
    from django.db import connections
    barrier = Barrier(len(operations))
    hooks = hooks or {}
    def worker(index):
        connections.close_all()
        errors = []
        try:
            assert_qa_connections(name)
            def wrapper(execute, sql, params, many, context):
                try:
                    result = execute(sql, params, many, context)
                    if index in hooks:
                        hooks[index](sql)
                    return result
                except Exception as error:
                    if error.args and isinstance(error.args[0], int):
                        errors.append(error.args[0])
                    raise
            with connections['default'].execute_wrapper(wrapper):
                barrier.wait(timeout=10)
                code = operations[index]()
                return {'status': code, 'database_error_codes': errors}
        finally:
            connections.close_all()
    with ThreadPoolExecutor(max_workers=len(operations)) as pool:
        futures = [pool.submit(worker, index) for index in range(len(operations))]
        return [future.result(timeout=30) for future in futures]


def concurrent_approvals(name):
    from Community.models import Claim, Corporation
    first, second = fixture_user('applicant_a'), fixture_user('applicant_b')
    reviewer_a, reviewer_b = fixture_user('reviewer_a', True), fixture_user('reviewer_b', True)
    application_a = claim(first)
    corporation_id = application_a['corporation']['id']
    application_b = claim(second, corporation_id)
    operations = [lambda: request(reviewer_a, 'post', f"reviews/claims/{application_a['id']}/decision/", {'decision': 'approve', 'reason': 'QA'}).status_code,
                  lambda: request(reviewer_b, 'post', f"reviews/claims/{application_b['id']}/decision/", {'decision': 'approve', 'reason': 'QA'}).status_code]
    result = parallel_calls(name, operations)
    require(sorted(item['status'] for item in result) == [200, 409], f'approval race={result}')
    require(Claim.objects.filter(corporation_id=corporation_id, status='approved').count() == 1, 'multiple approved ownerships')
    require(Corporation.objects.get(pk=corporation_id).owner_id in (first.pk, second.pk), 'owner assignment mismatch')
    return result


def concurrent_patch(name):
    from Community.models import Revision
    owner, staff = fixture_user('patch_owner'), fixture_user('patch_staff', True)
    corporation_id = approved_owner(owner, staff)
    revision = draft(owner, corporation_id)
    def operation(tagline):
        return lambda: request(owner, 'patch', f"revisions/{revision['id']}/", {'expected_version': revision['version'], 'tagline': tagline}).status_code
    result = parallel_calls(name, [operation('first'), operation('second')])
    require(sorted(item['status'] for item in result) == [200, 409], f'patch race={result}')
    current = Revision.objects.get(pk=revision['id'])
    require(current.version == revision['version'] + 1 and current.content['tagline'] in ('first', 'second'), 'stale write overwrote winner')
    return result


def forced_user_corporation_cycle(name, kind):
    """Force the real user-row -> corporation-row / FK-user-row lock overlap.

    A bounded coordination fallback allows a corrected users-first implementation
    to proceed; the harness does not require it to take the old unsafe lock order.
    """
    actor_ready, corporation_ready = Event(), Event()
    staff = fixture_user('lock_staff', True)
    if kind == 'applicant_fk':
        actor = fixture_user('lock_applicant')
        application = claim(actor)
        corporation_id = application['corporation']['id']
        review = lambda: request(staff, 'post', f"reviews/claims/{application['id']}/decision/", {'decision': 'approve', 'reason': 'QA'}).status_code
    else:
        owner = fixture_user('lock_owner')
        corporation_id = approved_owner(owner, staff)
        actor = staff
        if kind == 'reviewer_fk':
            revision = pending_revision(owner, corporation_id)
            review = lambda: request(staff, 'post', f"reviews/revisions/{revision['id']}/decision/", {'decision': 'approve', 'reason': 'QA'}).status_code
        else:
            review = lambda: request(staff, 'post', f'corporations/{corporation_id}/visibility/', {'is_listed': False, 'reason': 'QA'}).status_code
    data = {'request_id': str(uuid4()), 'corporation_id': corporation_id, 'statement': 'Concurrent QA retry', 'contact': 'qa@example.invalid'}
    def actor_hook(sql):
        if 'authentication_evemuser' in sql.lower() and 'FOR UPDATE' in sql.upper() and not actor_ready.is_set():
            actor_ready.set()
            corporation_ready.wait(timeout=2)
    def reviewer_hook(sql):
        if 'community_corporation' in sql.lower() and 'FOR UPDATE' in sql.upper():
            corporation_ready.set()
    def reviewing():
        require(actor_ready.wait(timeout=10), 'actor rendezvous timed out')
        return review()
    result = parallel_calls(name, [lambda: request(actor, 'post', 'claims/', data).status_code, reviewing], {0: actor_hook, 1: reviewer_hook})
    require([item['status'] for item in result] == [409, 200], f'{kind} lock overlap={result}')
    require(not any(item['database_error_codes'] for item in result), f'{kind} DB lock errors={result}')
    return result


def upload_public_flow():
    from django.core.files.uploadedfile import SimpleUploadedFile
    from PIL import Image
    owner, staff = fixture_user('media_owner'), fixture_user('media_staff', True)
    corporation_id = approved_owner(owner, staff)
    revision = draft(owner, corporation_id)
    raster = io.BytesIO()
    Image.new('RGB', (20, 10), 'blue').save(raster, 'PNG')
    uploaded = request(owner, 'post', f'corporations/{corporation_id}/media/', {'request_id': str(uuid4()), 'file': SimpleUploadedFile('qa.png', raster.getvalue())}, True)
    require(uploaded.status_code == 201, f'upload status={uploaded.status_code}')
    asset_id = uploaded.data['id']
    image_path = f'corporations/{corporation_id}/media/{asset_id}/'
    require(request(None, 'get', image_path).status_code == 404, 'unreviewed image exposed')
    patched = request(owner, 'patch', f"revisions/{revision['id']}/", {'expected_version': revision['version'], 'introduction': 'QA public content', 'public_contact': 'qa@example.invalid', 'logo_asset_id': asset_id})
    require(patched.status_code == 200, f'image patch status={patched.status_code}')
    pending = request(owner, 'post', f"revisions/{revision['id']}/submit/", {'expected_version': patched.data['version']})
    require(pending.status_code == 200, f'image submit status={pending.status_code}')
    reviewed = request(staff, 'post', f"reviews/revisions/{revision['id']}/decision/", {'decision': 'approve', 'reason': 'QA'})
    require(reviewed.status_code == 200, f'image approval status={reviewed.status_code}')
    streamed = request(None, 'get', image_path)
    require(streamed.status_code == 200, 'approved image unavailable')
    b''.join(streamed.streaming_content)
    streamed.close()
    hidden = request(staff, 'post', f'corporations/{corporation_id}/visibility/', {'is_listed': False, 'reason': 'QA'})
    require(hidden.status_code == 200, f'hide status={hidden.status_code}')
    require(request(None, 'get', image_path).status_code == 404, 'hidden image still public')
    return {'upload': 201, 'before_review': 404, 'approved': 200, 'hidden': 404}


def run_rehearsal(candidate, live, name):
    import MySQLdb
    credentials = load_credentials(live)
    # Verify candidate migration files before creating any database.
    for app in ('Authentication', 'Community'):
        if not (candidate / app / 'migrations' / '0001_initial.py').is_file():
            raise SafetyError('Candidate initial migration missing')
    create_schema(name, credentials, MySQLdb.connect)
    print(json.dumps({'stage': 'created_new_qa_schema', 'database': name, 'retention': 'never auto-dropped'}), flush=True)
    with tempfile.TemporaryDirectory(prefix='private-community-qa-') as storage:
        configure_isolated_django(candidate, name, credentials, storage)
        from django.db import connections
        from django.db.migrations.executor import MigrationExecutor
        assert_qa_connections(name)
        with connections['default'].cursor() as cursor:
            cursor.execute('SELECT VERSION(), @@default_storage_engine')
            version, engine = cursor.fetchone()
            require(version.startswith('8.') and engine.lower() == 'innodb', 'requires MySQL 8 / InnoDB')
        executor = MigrationExecutor(connections['default'])
        targets = executor.loader.graph.leaf_nodes()
        plan = executor.migration_plan(targets)
        allowed = {'auth', 'contenttypes', 'Authentication', 'Community'}
        if any(backwards or migration.app_label not in allowed for migration, backwards in plan):
            raise SafetyError('Unexpected migration app or reverse migration')
        executor.migrate(targets)
        assert_qa_connections(name)
        print(json.dumps({'stage': 'migrated', 'mysql_version': version, 'auth_model': 'Authentication.EVEMUser', 'migrations': len(plan)}), flush=True)
        # Deliberately no DiscoverRunner/setup_databases/teardown_databases. TestCase
        # rollback hooks run on the already-verified QA database, never another DB.
        result = unittest.TestResult()
        unittest.defaultTestLoader.loadTestsFromName('Community.tests').run(result)
        unit_report = {'case': 'community_api_suite', 'tests': result.testsRun,
                       'failed': [test.id() for test, _ in result.failures + result.errors]}
        print(json.dumps(unit_report), flush=True)
        if not result.wasSuccessful():
            connections.close_all()
            return 1
        failures = []
        cases = [('upload_public_flow', upload_public_flow), ('concurrent_approvals', lambda: concurrent_approvals(name)),
                 ('concurrent_patch', lambda: concurrent_patch(name))]
        cases += [(kind, lambda kind=kind: forced_user_corporation_cycle(name, kind)) for kind in ('applicant_fk', 'reviewer_fk', 'moderator_fk')]
        for label, case in cases:
            try:
                assert_qa_connections(name)
                evidence = case()
                print(json.dumps({'case': label, 'passed': True, 'evidence': evidence}), flush=True)
            except Exception as error:
                failures.append(label)
                # CheckFailed messages are authored above using only synthetic IDs,
                # statuses and numeric MySQL codes. Never print driver error text.
                detail = str(error) if isinstance(error, CheckFailed) else 'redacted'
                print(json.dumps({'case': label, 'passed': False, 'error_type': type(error).__name__, 'detail': detail}), flush=True)
        connections.close_all()
        print(json.dumps({'stage': 'complete', 'database': name, 'failed_cases': failures,
                          'retention': 'QA schema retained; temporary image fixtures removed'}), flush=True)
        return 1 if failures else 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate-backend', required=True, type=Path)
    parser.add_argument('--live-backend', required=True, type=Path)
    parser.add_argument('--database', required=True)
    parser.add_argument('--execute', action='store_true')
    parser.add_argument('--confirm-new-database')
    args = parser.parse_args(argv)
    name = validate_schema(args.database)
    candidate, live = args.candidate_backend.resolve(), args.live_backend.resolve()
    if candidate == live or not candidate.is_dir() or not live.is_dir():
        raise SafetyError('Candidate and live backend must be distinct existing directories')
    if any(not (candidate / app / 'models.py').is_file() for app in ('Authentication', 'Community')):
        raise SafetyError('Candidate model source missing')
    if not args.execute:
        digest = hashlib.sha256()
        for app in ('Authentication', 'Community'):
            for source in sorted((candidate / app).rglob('*.py')):
                digest.update(source.relative_to(candidate).as_posix().encode())
                digest.update(source.read_bytes())
        print(json.dumps({'mode': 'plan_only_no_network', 'database': name, 'candidate_sha256': digest.hexdigest(),
                          'creates_new_schema': True, 'business_database_selected': False, 'drops_database': False,
                          'checks': ['real_EVEMUser_migrations', 'Community_API_suite', 'upload_public_state', 'competing_approvals', 'stale_version_patch', 'applicant_reviewer_moderator_FK_lock_cycles']}))
        return 0
    confirm_execution(name, args.confirm_new_database)
    return run_rehearsal(candidate, live, name)


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception as error:
        # Includes connector/config failures: driver exception messages may expose
        # usernames, hosts or connection metadata. Keep them off shared output.
        print(json.dumps({'stage': 'aborted', 'error_type': type(error).__name__, 'detail': 'redacted; inspect reviewed configuration locally'}), file=sys.stderr)
        sys.exit(2)
