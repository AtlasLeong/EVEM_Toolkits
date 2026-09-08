"""One-off, explicit Feedback release checks. Run from a candidate backend.

Modes are deliberately separate: inspect, rehearse, backup, migrate.
Never changes the running release, reverse-migrates, or drops a database.
Database credentials stay in memory / a private option file and are never printed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from uuid import uuid4
from datetime import datetime, timezone

parser = argparse.ArgumentParser()
parser.add_argument('mode', choices=['inspect', 'rehearse', 'backup', 'migrate'])
parser.add_argument('--backup-dir')
args = parser.parse_args()
sys.path.insert(0, str(Path.cwd()))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'EVE_MDjango.settings')

import django
django.setup()
from django.conf import settings
from django.db import connections
from django.db.migrations.executor import MigrationExecutor

connection = connections['default']
expected = [('Feedback', '0001_initial'), ('Feedback', '0002_feedbackattachment_and_more')]

def inspect_plan():
    executor = MigrationExecutor(connection)
    executor.loader.check_consistent_history(connection)
    targets = executor.loader.graph.leaf_nodes('Feedback')
    plan = executor.migration_plan(targets)
    steps = [(migration.app_label, migration.name) for migration, backwards in plan]
    if any(backwards for _, backwards in plan) or any(step not in expected for step in steps):
        raise RuntimeError(f'Unexpected migration plan: {steps}')
    with connection.cursor() as cursor:
        cursor.execute('SELECT VERSION(), @@default_storage_engine')
        version, default_engine = cursor.fetchone()
        if default_engine.lower() != 'innodb':
            raise RuntimeError('New feedback tables require default InnoDB storage')
        cursor.execute('SELECT ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s', ['authentication_evemuser'])
        engine = cursor.fetchone()
        if not engine or engine[0] != 'InnoDB':
            raise RuntimeError('Auth table must use InnoDB for row locking')
    print(json.dumps({'mysql_version': version, 'auth_engine': engine[0], 'plan': steps}))
    return executor, targets, steps

def database_identity():
    return {key: str(connection.settings_dict[key]) for key in ('NAME', 'HOST', 'PORT')}

def dump_database(folder):
    folder.mkdir(mode=0o700, parents=True, exist_ok=False)
    target = folder / 'default-before-feedback.sql'
    db = connection.settings_dict
    def quoted(value):
        return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'
    descriptor, option_path = tempfile.mkstemp(prefix='mysql-options-', dir=folder)
    try:
        with os.fdopen(descriptor, 'w') as options:
            options.write('[client]\n' + '\n'.join(f'{key}={quoted(value)}' for key, value in {
                'user': db['USER'], 'password': db['PASSWORD'], 'host': db['HOST'], 'port': db['PORT'] or 3306,
            }.items()) + '\n')
        with target.open('xb') as output:
            os.chmod(target, 0o600)
            result = subprocess.run(['mysqldump', f'--defaults-extra-file={option_path}', '--single-transaction', '--quick', '--routines', '--triggers', '--no-tablespaces', '--set-gtid-purged=OFF', db['NAME']], stdout=output, stderr=subprocess.PIPE)
        if result.returncode:
            raise RuntimeError('Database backup failed; inspect private server logs before proceeding')
    finally:
        Path(option_path).unlink(missing_ok=True)
    with target.open('rb') as source:
        digest = hashlib.file_digest(source, 'sha256').hexdigest() if hasattr(hashlib, 'file_digest') else None
    if digest is None:
        h = hashlib.sha256()
        with target.open('rb') as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b''):
                h.update(chunk)
        digest = h.hexdigest()
    with target.open('rb') as source:
        source.seek(max(0, target.stat().st_size - 4096))
        if b'Dump completed' not in source.read():
            raise RuntimeError('Incomplete dump footer')
    (folder / 'backup.json').write_text(json.dumps({'file': str(target), 'size': target.stat().st_size, 'sha256': digest, 'database': database_identity(), 'created_at': datetime.now(timezone.utc).isoformat()}))
    print(json.dumps({'backup': str(target), 'bytes': target.stat().st_size, 'sha256': digest}))

if args.mode == 'inspect':
    inspect_plan()
elif args.mode == 'backup':
    inspect_plan()
    if not args.backup_dir:
        raise RuntimeError('--backup-dir required')
    destination = Path(args.backup_dir).resolve()
    if destination.parent != Path('/EVEMTK/deploy-backups'):
        raise RuntimeError('Backup must be an explicit child of the private backup directory')
    dump_database(destination)
elif args.mode == 'migrate':
    executor, targets, steps = inspect_plan()
    folder = Path(args.backup_dir or '').resolve()
    if folder.parent != Path('/EVEMTK/deploy-backups') or not (folder / 'backup.json').is_file():
        raise RuntimeError('Verified backup is required')
    record = json.loads((folder / 'backup.json').read_text())
    if record['database'] != database_identity() or (datetime.now(timezone.utc) - datetime.fromisoformat(record['created_at'])).total_seconds() > 86400:
        raise RuntimeError('Backup belongs to a different database or is older than 24 hours')
    source = Path(record['file'])
    h = hashlib.sha256()
    with source.open('rb') as dump:
        for chunk in iter(lambda: dump.read(1024 * 1024), b''):
            h.update(chunk)
    if h.hexdigest() != record['sha256']:
        raise RuntimeError('Backup digest mismatch')
    executor.migrate(targets)
    if inspect_plan()[2]:
        raise RuntimeError('Feedback migration remains pending')
    print('Feedback-only additive migrations applied; previous code remains running.')
elif args.mode == 'rehearse':
    inspect_plan()
    qa_name = 'evem_feedback_qa_' + uuid4().hex[:12]
    if qa_name == connection.settings_dict['NAME'] or not qa_name.startswith('evem_feedback_qa_'):
        raise RuntimeError('Unsafe rehearsal database')
    with connection.cursor() as cursor:
        cursor.execute(f'CREATE DATABASE `{qa_name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    connection.close()
    connection.settings_dict['NAME'] = qa_name
    settings.DATABASES['default']['NAME'] = qa_name
    connections.databases['default']['NAME'] = qa_name
    def assert_qa_database():
        with connections['default'].cursor() as cursor:
            cursor.execute('SELECT DATABASE()')
            if cursor.fetchone()[0] != qa_name:
                raise RuntimeError('Rehearsal connection is not isolated')
    assert_qa_database()
    # All writes below are to the new isolated database, never production.
    executor = MigrationExecutor(connection)
    executor.migrate(executor.loader.graph.leaf_nodes('Authentication') + executor.loader.graph.leaf_nodes('Feedback'))
    from django.contrib.auth import get_user_model
    from rest_framework.test import APIClient
    from django.test import override_settings
    from django.core.files.uploadedfile import SimpleUploadedFile
    from concurrent.futures import ThreadPoolExecutor
    from django.db import close_old_connections
    from Feedback.models import FeedbackTicket
    User = get_user_model()
    owner = User.objects.create_user(username='feedback_qa_owner', email='owner@feedback-qa.invalid')
    other = User.objects.create_user(username='feedback_qa_other', email='other@feedback-qa.invalid')
    staff = User.objects.create_user(username='feedback_qa_staff', email='staff@feedback-qa.invalid', is_staff=True)
    def client(user):
        instance = APIClient()
        instance.force_authenticate(user=user)
        return instance
    with tempfile.TemporaryDirectory(prefix='private-feedback-qa-') as storage, override_settings(ALLOWED_HOSTS=['testserver'], FEEDBACK_UPLOAD_ROOT=storage):
        payload = dict(request_id=str(uuid4()), type='bug', module='planetary', title='Isolated MySQL smoke', description='Disposable rehearsal only', contact='')
        response = client(owner).post('/api/feedback/', payload, format='json')
        assert response.status_code == 201, response.status_code
        pk = response.data['id']
        assert client(other).get(f'/api/feedback/{pk}/').status_code == 404
        assert client(owner).get('/api/feedback/?scope=all').status_code == 403
        assert client(staff).patch(f'/api/feedback/{pk}/', {'status': 'processing'}, format='json').status_code == 200
        assert client(owner).post(f'/api/feedback/{pk}/comments/', {'request_id': str(uuid4()), 'body': 'Additional context'}, format='json').status_code == 201
        uploaded = client(owner).post(f'/api/feedback/{pk}/attachments/', {'request_id': str(uuid4()), 'file': SimpleUploadedFile('qa.txt', b'private attachment')}, format='multipart')
        assert uploaded.status_code == 201, uploaded.status_code
        path = f'/api/feedback/{pk}/attachments/{uploaded.data["id"]}/download/'
        assert client(other).get(path).status_code == 404
        download = client(staff).get(path)
        assert download.status_code == 200
        assert b''.join(download.streaming_content) == b'private attachment'
        rate_user = User.objects.create_user(username='feedback_qa_rate', email='rate@feedback-qa.invalid')
        rate_id = rate_user.pk
        def submit(index):
            close_old_connections()
            try:
                assert_qa_database()
                response = client(User.objects.get(pk=rate_id)).post('/api/feedback/', {**payload, 'title': f'Concurrent {index}', 'request_id': str(uuid4())}, format='json')
                return response.status_code
            finally:
                close_old_connections()
        with ThreadPoolExecutor(max_workers=6) as pool:
            codes = list(pool.map(submit, range(25)))
        assert codes.count(201) == 20 and codes.count(429) == 5, codes
        assert FeedbackTicket.objects.filter(author_id=rate_id).count() == 20
    print(json.dumps({'rehearsal_database': qa_name, 'auth_model': settings.AUTH_USER_MODEL, 'smoke': 'passed', 'concurrent_create': {'201': codes.count(201), '429': codes.count(429)}, 'cleanup': 'schema retained, disposable files removed'}))
