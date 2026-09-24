"""One-off, opt-in MySQL 8 preflight for TacticalCollaboration migration 0007.

Run from the candidate backend directory. No mode is invoked by the deployer.
Database credentials and backup contents must remain in private server storage.
"""
import argparse
from contextlib import contextmanager
from copy import deepcopy
import hashlib
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
from uuid import uuid4


TARGET = [('TacticalCollaboration', '0007_multiboard_pirate')]
BACKUP_ROOT = Path('/EVEMTK/deploy-backups')
CONFIG_PATH = Path('/EVEMTK/deploy/config.json')
MIGRATION_PATH = Path('TacticalCollaboration/migrations/0007_multiboard_pirate.py')
QA_NAME = re.compile(r'evem_tactical_qa_[0-9a-f]{12}\Z')
EXPECTED_COUNTS = (1, 3, 4)


class PreflightError(RuntimeError):
    """Stop without changing production when a release gate is not satisfied."""


def require_root_operator(uid):
    if uid != 0:
        raise PreflightError('Production preflight requires the root operator')


def require_root_controlled(metadata):
    if (stat.S_ISLNK(metadata.st_mode) or metadata.st_uid != 0 or
            stat.S_IMODE(metadata.st_mode) & 0o022):
        raise PreflightError('Candidate code and ancestor paths must be root-controlled')


def require_trusted_script_path(path):
    """Do not execute privileged preflight code below a deploy-user-writable path."""
    node = Path(path).absolute()
    while True:
        require_root_controlled(node.lstat())
        if node == node.parent:
            return
        node = node.parent


def require_trusted_backend_tree(backend):
    backend = Path(backend).absolute()
    require_trusted_script_path(backend)
    for folder, directories, filenames in os.walk(backend, followlinks=False):
        for leaf in directories + filenames:
            require_root_controlled((Path(folder) / leaf).lstat())


def require_plan(plan):
    if list(plan) != TARGET:
        raise PreflightError('Expected only TacticalCollaboration.0007; inspect the migration plan')
    return TARGET


def backup_destination(path, root=BACKUP_ROOT):
    root = private_backup_root(root)
    path = Path(path).resolve()
    if not root.is_dir() or path.parent != root or path.exists():
        raise PreflightError('Backup destination must be a new direct child of the private backup root')
    return path


def private_backup_root(root):
    root = Path(root)
    if root.is_symlink() or not root.is_dir():
        raise PreflightError('Backup root must be a private real directory')
    if os.name == 'posix':
        metadata = root.stat()
        if metadata.st_uid != os.geteuid() or stat.S_IMODE(metadata.st_mode) & 0o077:
            raise PreflightError('Backup root must belong to the operator and deny group/other access')
    return root.resolve()


def candidate_identity(backend):
    backend = Path(backend)
    try:
        sha = (backend / '.release-sha').read_text(encoding='ascii').strip()
        migration = (backend / MIGRATION_PATH).read_bytes()
    except (OSError, UnicodeError) as exc:
        raise PreflightError('Candidate release marker or migration file is missing') from exc
    if not re.fullmatch(r'[0-9a-f]{40}', sha):
        raise PreflightError('Candidate backend must contain a 40-character release SHA')
    return {'sha': sha, 'migration_sha256': hashlib.sha256(migration).hexdigest()}


def require_manifest_match(manifest, candidate, source, snapshot):
    if manifest.get('format') != 1:
        raise PreflightError('Unsupported tactical backup manifest')
    for key, current in (('candidate', candidate), ('source', source), ('snapshot', snapshot)):
        if manifest.get(key) != current:
            raise PreflightError(f'Backup manifest {key} no longer matches the candidate or source database')
    return manifest


def private_option_file(path):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise PreflightError('MySQL option file must be a private regular file')
    metadata = path.stat()
    if os.name == 'posix' and stat.S_IMODE(metadata.st_mode) & 0o077:
        raise PreflightError('MySQL option file is readable by group or others')
    if os.name == 'posix' and metadata.st_uid != os.geteuid():
        raise PreflightError('MySQL option file must belong to the running operator')
    allowed = {'host', 'port', 'user', 'password', 'socket', 'protocol', 'default-character-set'}
    try:
        lines = path.read_text(encoding='utf-8-sig').splitlines()
    except (OSError, UnicodeError) as exc:
        raise PreflightError('MySQL option file is not readable UTF-8 text') from exc
    in_client, seen_group, seen_options = False, False, set()
    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith(('#', ';')):
            continue
        if line == '[client]' and not seen_group:
            in_client, seen_group = True, True
            continue
        if not in_client or line.startswith(('!', '[')) or '=' not in line:
            raise PreflightError('MySQL option file must contain only one [client] group')
        key = line.split('=', 1)[0].strip().lower()
        if key not in allowed or key in seen_options:
            raise PreflightError('MySQL option file has an unsafe or duplicate option')
        seen_options.add(key)
    if not seen_group:
        raise PreflightError('MySQL option file has no [client] group')
    return path.resolve()


def load_private_environment(path, config_path, backend):
    """Read the configured env file as data; never source it in a shell."""
    path, config_path, backend = Path(path), Path(config_path), Path(backend)
    if (not path.is_absolute() or path.is_symlink() or not path.is_file() or
            config_path.is_symlink() or not config_path.is_file()):
        raise PreflightError('Configured environment must be a private regular file')
    env_info, config_info = path.stat(), config_path.stat()
    if os.name == 'posix':
        if (env_info.st_uid != os.geteuid() or config_info.st_uid != os.geteuid() or
                stat.S_IMODE(env_info.st_mode) & 0o027 or
                stat.S_IMODE(config_info.st_mode) & 0o027 or
                (stat.S_IMODE(env_info.st_mode) & 0o040 and env_info.st_gid != config_info.st_gid)):
            raise PreflightError('Configured environment or deploy config has unsafe permissions')
    try:
        configured = json.loads(config_path.read_text(encoding='utf-8'))['env_file']
    except (OSError, ValueError, KeyError) as exc:
        raise PreflightError('Deploy config has no valid env_file') from exc
    if Path(configured).resolve() != path.resolve():
        raise PreflightError('--env-file does not match root-managed deploy config')
    candidate_env = backend / '.env'
    if (candidate_env.exists() or candidate_env.is_symlink()) and (
            not candidate_env.is_symlink() or candidate_env.resolve() != path.resolve()):
        raise PreflightError('Candidate backend .env overrides the selected private env file')
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        if '=' not in line:
            raise PreflightError('Invalid configured environment line')
        key, value = (part.strip() for part in line.split('=', 1))
        if (not re.fullmatch(r'[A-Z][A-Z0-9_]*', key) or key in values or
                key in {'DJANGO_SETTINGS_MODULE', 'PYTHONPATH', 'PYTHONHOME'} or key.startswith('LD_')):
            raise PreflightError('Unsafe or duplicate configured environment key')
        values[key] = value
    if not {'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'DB_HOST', 'DB_PORT'} <= values.keys():
        raise PreflightError('Configured environment must define all default database connection fields')
    return values


def require_source_connection_settings(connection, environment):
    mapping = {'DB_NAME': 'NAME', 'DB_USER': 'USER', 'DB_PASSWORD': 'PASSWORD',
               'DB_HOST': 'HOST', 'DB_PORT': 'PORT'}
    if any(str(connection.settings_dict.get(setting)) != environment[key]
           for key, setting in mapping.items()):
        raise PreflightError('Django default database connection differs from controlled environment')


def dump_evidence(path, folder):
    path, folder = Path(path), Path(folder).resolve()
    if path.is_symlink() or not path.is_file() or path.resolve().parent != folder or path.name != 'before-0007.sql':
        raise PreflightError('Backup dump must be a regular file in the selected private directory')
    if os.name == 'posix' and (path.stat().st_uid != os.geteuid() or
                               stat.S_IMODE(path.stat().st_mode) & 0o077):
        raise PreflightError('Backup dump must belong to the operator and be private')
    if path.stat().st_size == 0:
        raise PreflightError('Backup dump is empty')
    with path.open('rb') as source:
        source.seek(max(0, path.stat().st_size - 4096))
        tail = source.read().splitlines()
        last_line = next((line.strip() for line in reversed(tail) if line.strip()), b'')
        if not last_line.startswith(b'-- Dump completed on '):
            raise PreflightError('Backup dump has no completion footer')
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return {'file': str(path.resolve()), 'size': path.stat().st_size, 'sha256': digest.hexdigest()}


def require_dump(record, folder):
    path = Path(record.get('file', ''))
    current = dump_evidence(path, folder)
    if record != current:
        raise PreflightError('Backup dump content or location changed')
    return path


def require_rehearsal(manifest):
    qa = manifest.get('qa') or {}
    if (not QA_NAME.fullmatch(str(qa.get('database', ''))) or not qa.get('passed') or
            qa.get('dump_sha256') != (manifest.get('dump') or {}).get('sha256')):
        raise PreflightError('Successful isolated rehearsal for this exact dump is required')
    return qa


def save_manifest(path, record):
    path = Path(path)
    if path.exists() and (path.is_symlink() or (os.name == 'posix' and (
            path.stat().st_uid != os.geteuid() or stat.S_IMODE(path.stat().st_mode) & 0o077))):
        raise PreflightError('Existing manifest is not a private regular file')
    temporary = path.with_name(path.name + '.' + uuid4().hex + '.tmp')
    descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        with os.fdopen(descriptor, 'w', encoding='utf-8') as output:
            json.dump(record, output, ensure_ascii=False, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def require_source_counts(snapshot):
    organizations = snapshot.get('organizations') or []
    counts = (len(organizations), snapshot.get('report_count'), snapshot.get('force_count'))
    if counts != EXPECTED_COUNTS or sum(row['reports'] for row in organizations) != counts[1] or sum(
            row['forces'] for row in organizations) != counts[2]:
        raise PreflightError('Tactical source cardinality changed from the audited 1/3/4 baseline')
    return snapshot


def row_fingerprint(rows):
    """Hash a stable, column-named stream of rows, not just its cardinality."""
    digest = hashlib.sha256()
    for row in rows:
        digest.update(json.dumps(row, ensure_ascii=False, default=str, sort_keys=True,
                                 separators=(',', ':')).encode('utf-8'))
        digest.update(b'\n')
    return digest.hexdigest()


def table_fingerprint(connection, table_name):
    """Read old-schema rows without evaluating current Django model fields."""
    quoted = connection.ops.quote_name(table_name)
    with connection.cursor() as cursor:
        cursor.execute(f'SELECT * FROM {quoted} ORDER BY {connection.ops.quote_name("id")}')
        columns = [column[0] for column in cursor.description]

        def rows():
            while batch := cursor.fetchmany(256):
                for values in batch:
                    yield dict(zip(columns, values))

        return row_fingerprint(rows())


def require_clone_identity(source, clone, qa_name):
    if (not QA_NAME.fullmatch(qa_name) or clone.get('database') != qa_name or
            clone.get('database') == source.get('database') or
            source.get('server_uuid') != clone.get('server_uuid') or
            source.get('version') != clone.get('version') or
            not str(source.get('version', '')).startswith('8.0.37') or
            source.get('charset') != clone.get('charset') or
            source.get('collation') != clone.get('collation')):
        raise PreflightError('Clone is not a distinct schema on the same audited MySQL 8.0.37 server')
    return clone


def verify_migration_data(snapshot, boards, report_links, force_links, sighting_count):
    organizations = snapshot['organizations']
    if len(boards) != len(organizations) or sighting_count != 0:
        raise PreflightError('Unexpected board or pirate sighting count after migration')
    by_org = {board['organization_id']: board for board in boards}
    if len(by_org) != len(organizations):
        raise PreflightError('Migration did not create exactly one default board per organization')
    for organization in organizations:
        board = by_org.get(organization['id'])
        if (not board or board['kind'] != 'war' or board['name'] != '战争沙盘' or
                board['is_default'] is not True or
                any(board[key] != organization[key] for key in ('region_ids', 'border_hops', 'scope_version'))):
            raise PreflightError('Migrated default board does not preserve the legacy organization scope')
    for name, links, count in (('reports', report_links, snapshot['report_count']),
                               ('forces', force_links, snapshot['force_count'])):
        if len(links) != count or any(by_org.get(org_id, {}).get('id') != board_id
                                      for org_id, board_id in links):
            raise PreflightError(f'Migrated {name} are not all attached to their default board')
    return True


def perform_backup(folder, root, option_file, database, candidate, source, snapshot):
    folder = backup_destination(folder, root)
    option_file = private_option_file(option_file)
    if database != source.get('database'):
        raise PreflightError('Dump target differs from the audited source database')
    admin_server(option_file, source)
    folder.mkdir(mode=0o700)
    dump = folder / 'before-0007.sql'
    arguments = [
        'mysqldump', f'--defaults-file={option_file}', '--single-transaction', '--quick',
        '--routines', '--triggers', '--no-tablespaces', '--set-gtid-purged=OFF', '--hex-blob',
        '--default-character-set=utf8mb4', database,
    ]
    descriptor = os.open(dump, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        try:
            result = subprocess.run(arguments, stdout=output, stderr=subprocess.PIPE, check=False)
        except OSError as exc:
            raise PreflightError('mysqldump could not start; partial dump retained for inspection') from exc
    if result.returncode:
        raise PreflightError('mysqldump failed; partial dump retained, no manifest created')
    manifest = {
        'format': 1, 'created_at': datetime.now(timezone.utc).isoformat(),
        'candidate': candidate, 'source': source, 'snapshot': snapshot,
        'dump': dump_evidence(dump, folder),
    }
    save_manifest(folder / 'backup.json', manifest)
    return manifest


def require_unmigrated_schema(new_tables, board_columns, source_engines):
    if new_tables or board_columns or len(source_engines) != 3 or any(engine != 'InnoDB' for engine in source_engines):
        raise PreflightError('Source has partial 0007 schema or a non-InnoDB tactical table')


def require_all_innodb(non_innodb_tables):
    if non_innodb_tables:
        raise PreflightError('Full single-transaction backup requires every source base table to use InnoDB')


def require_no_events(events):
    if events:
        raise PreflightError('Source has MySQL events; stop and design a separate isolated backup/rehearsal plan')


def require_event_visibility(grants, database):
    """Fail closed if INFORMATION_SCHEMA.EVENTS could hide source events."""
    if any(str(row[0]).lstrip().upper().startswith('REVOKE ') for row in grants):
        raise PreflightError('Administrator EVENT visibility cannot be proven with partial REVOKE grants')
    quoted_database = '`' + database.replace('`', '``') + '`.*'
    accepted_scopes = {'*.*', quoted_database, f'{database}.*'}
    for row in grants:
        statement = row[0]
        match = re.match(r'^GRANT (.+?) ON (.+?) TO ', statement, re.IGNORECASE)
        if not match or match.group(2) not in accepted_scopes:
            continue
        privileges = {part.strip().upper() for part in match.group(1).split(',')}
        if 'EVENT' in privileges or 'ALL PRIVILEGES' in privileges:
            return
    raise PreflightError('Administrator needs direct EVENT or ALL PRIVILEGES grant on source schema')


def require_pirate_visibility_index(columns):
    if list(columns) != [(1, 'board_id'), (2, 'author_id'), (3, 'status')]:
        raise PreflightError('Expected pirate visibility index columns or order are missing')


def database_identity(connection):
    if connection.vendor != 'mysql':
        raise PreflightError('This preflight must run against MySQL, never SQLite')
    with connection.cursor() as cursor:
        cursor.execute('SELECT DATABASE(), @@server_uuid, VERSION(), @@default_storage_engine')
        database, server_uuid, version, engine = cursor.fetchone()
        cursor.execute('SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME '
                       'FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=DATABASE()')
        charset, collation = cursor.fetchone()
    if not database or not str(version).startswith('8.0.37') or engine != 'InnoDB' or charset != 'utf8mb4':
        raise PreflightError('Database must be the audited MySQL 8.0.37/InnoDB/utf8mb4 server')
    return {
        'database': database, 'server_uuid': str(server_uuid), 'version': str(version),
        'host': str(connection.settings_dict['HOST']), 'port': str(connection.settings_dict['PORT']),
        'charset': charset, 'collation': collation,
    }


def normalize_migration_plan(plan):
    if any(backwards for _, backwards in plan):
        raise PreflightError('Reverse migration is forbidden in this preflight')
    return [(migration.app_label, migration.name) for migration, _ in plan]


def migration_plan(connection):
    from django.db.migrations.executor import MigrationExecutor

    executor = MigrationExecutor(connection)
    executor.loader.check_consistent_history(connection)
    if executor.loader.detect_conflicts():
        raise PreflightError('Conflicting Django migrations')
    return normalize_migration_plan(executor.migration_plan(TARGET))


def require_source_schema(connection):
    from TacticalCollaboration.models import Board, Force, Organization, PirateSighting, Report

    existing_tables = [Organization._meta.db_table, Report._meta.db_table, Force._meta.db_table]
    new_tables = [Board._meta.db_table, PirateSighting._meta.db_table]
    with connection.cursor() as cursor:
        placeholders = ','.join(['%s'] * len(existing_tables))
        cursor.execute('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES '
                       f'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ({placeholders})', existing_tables)
        engines = dict(cursor.fetchall())
        cursor.execute('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() '
                       'AND TABLE_NAME IN (%s,%s)', new_tables)
        found_tables = [row[0] for row in cursor.fetchall()]
        cursor.execute('SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS '
                       'WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME=%s AND TABLE_NAME IN (%s,%s)',
                       ['board_id', Report._meta.db_table, Force._meta.db_table])
        found_columns = [f'{table}.{column}' for table, column in cursor.fetchall()]
        cursor.execute('SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES '
                       "WHERE TABLE_SCHEMA=DATABASE() AND TABLE_TYPE='BASE TABLE' AND ENGINE <> 'InnoDB'")
        non_innodb = cursor.fetchall()
        cursor.execute('SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()')
        events = cursor.fetchall()
    require_unmigrated_schema(found_tables, found_columns, [engines.get(table) for table in existing_tables])
    require_all_innodb(non_innodb)
    require_no_events(events)


def source_snapshot(alias):
    from django.db.models import Count
    from django.db import connections
    from TacticalCollaboration.models import Force, Organization, Report

    report_counts = dict(Report.objects.using(alias).values('organization_id').annotate(total=Count('pk'))
                         .values_list('organization_id', 'total'))
    force_counts = dict(Force.objects.using(alias).values('organization_id').annotate(total=Count('pk'))
                        .values_list('organization_id', 'total'))
    organizations = []
    for row in Organization.objects.using(alias).order_by('pk').values(
            'id', 'region_ids', 'border_hops', 'scope_version'):
        organizations.append({**row, 'reports': report_counts.get(row['id'], 0),
                              'forces': force_counts.get(row['id'], 0)})
    return {'organizations': organizations, 'report_count': Report.objects.using(alias).count(),
            'force_count': Force.objects.using(alias).count(),
            'report_sha256': table_fingerprint(connections[alias], Report._meta.db_table),
            'force_sha256': table_fingerprint(connections[alias], Force._meta.db_table)}


def inspect_source(connection, backend):
    candidate = candidate_identity(backend)
    identity = database_identity(connection)
    require_source_schema(connection)
    require_plan(migration_plan(connection))
    snapshot = require_source_counts(source_snapshot(connection.alias))
    return candidate, identity, snapshot


def verify_database_migration(connection, snapshot):
    from TacticalCollaboration.models import Board, Force, PirateSighting, Report

    alias = connection.alias
    if migration_plan(connection):
        raise PreflightError('Tactical migration 0007 is still pending')
    boards = list(Board.objects.using(alias).values('id', 'organization_id', 'name', 'kind',
                                                    'is_default', 'region_ids', 'border_hops', 'scope_version'))
    reports = list(Report.objects.using(alias).values_list('organization_id', 'board_id'))
    forces = list(Force.objects.using(alias).values_list('organization_id', 'board_id'))
    verify_migration_data(snapshot, boards, reports, forces, PirateSighting.objects.using(alias).count())
    with connection.cursor() as cursor:
        cursor.execute('SELECT SEQ_IN_INDEX, COLUMN_NAME FROM information_schema.STATISTICS '
                       'WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=%s AND INDEX_NAME=%s '
                       'ORDER BY SEQ_IN_INDEX',
                       [PirateSighting._meta.db_table, 'tactical_pirate_visible'])
        require_pirate_visibility_index(cursor.fetchall())
    return True


def require_ready_to_migrate(manifest, candidate, source, snapshot, maintenance_confirmed, now=None):
    if not maintenance_confirmed:
        raise PreflightError('Explicit maintenance-window confirmation is required')
    require_manifest_match(manifest, candidate, source, snapshot)
    require_rehearsal(manifest)
    now = now or datetime.now(timezone.utc)
    try:
        created_at = datetime.fromisoformat(manifest['created_at'])
        age = (now - created_at).total_seconds()
    except (KeyError, TypeError, ValueError) as exc:
        raise PreflightError('Backup manifest has no valid creation time') from exc
    if created_at.tzinfo is None or not 0 <= age <= 24 * 60 * 60:
        raise PreflightError('Backup must be fresh (within 24 hours)')
    return manifest


def restore_dump(record, folder, option_file, qa_name):
    if not QA_NAME.fullmatch(str(qa_name)):
        raise PreflightError('Restore is permitted only into a uniquely named tactical QA schema')
    dump = require_dump(record, folder)
    option_file = private_option_file(option_file)
    arguments = ['mysql', f'--defaults-file={option_file}', '--default-character-set=utf8mb4', qa_name]
    with dump.open('rb') as source:
        try:
            result = subprocess.run(arguments, stdin=source, stdout=subprocess.DEVNULL,
                                    stderr=subprocess.PIPE, check=False)
        except OSError as exc:
            raise PreflightError('MySQL restore could not start; QA schema retained for inspection') from exc
    if result.returncode:
        raise PreflightError('MySQL restore failed; QA schema retained for inspection')


def existing_backup_folder(folder, root=BACKUP_ROOT):
    folder, root = Path(folder), private_backup_root(root)
    if (folder.is_symlink() or not folder.is_dir() or folder.resolve().parent != root or
            (os.name == 'posix' and (folder.stat().st_uid != os.geteuid() or
                                     stat.S_IMODE(folder.stat().st_mode) & 0o077))):
        raise PreflightError('Backup folder must be a private direct child of the configured backup root')
    return folder.resolve()


def load_manifest(folder, root=BACKUP_ROOT):
    folder = existing_backup_folder(folder, root)
    path = folder / 'backup.json'
    if (path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024 or
            (os.name == 'posix' and (path.stat().st_uid != os.geteuid() or
                                     stat.S_IMODE(path.stat().st_mode) & 0o077))):
        raise PreflightError('Private backup manifest is missing or unsafe')
    try:
        record = json.loads(path.read_text(encoding='utf-8'))
    except (OSError, ValueError) as exc:
        raise PreflightError('Backup manifest is not valid JSON') from exc
    if not isinstance(record, dict) or record.get('format') != 1:
        raise PreflightError('Unsupported backup manifest')
    return record


def admin_server(option_file, source):
    """Confirm the private client credentials target the same audited server."""
    import MySQLdb

    option_file = private_option_file(option_file)
    try:
        admin = MySQLdb.connect(read_default_file=str(option_file), charset='utf8mb4')
    except Exception as exc:
        raise PreflightError('Cannot open the private MySQL administrator connection') from exc
    try:
        with admin.cursor() as cursor:
            cursor.execute('SELECT @@server_uuid, VERSION()')
            server_uuid, version = cursor.fetchone()
            cursor.execute('SELECT DEFAULT_CHARACTER_SET_NAME, DEFAULT_COLLATION_NAME '
                           'FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=%s',
                           [source['database']])
            schema = cursor.fetchone()
            cursor.execute('SHOW GRANTS FOR CURRENT_USER()')
            require_event_visibility(cursor.fetchall(), source['database'])
            cursor.execute('SELECT EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=%s',
                           [source['database']])
            require_no_events(cursor.fetchall())
        if (str(server_uuid) != source['server_uuid'] or str(version) != source['version'] or
                schema != (source['charset'], source['collation'])):
            raise PreflightError('MySQL option file points to a different server or source schema')
    finally:
        admin.close()


def create_qa_schema(option_file, source, qa_name):
    if not QA_NAME.fullmatch(qa_name) or qa_name == source['database']:
        raise PreflightError('Unsafe QA schema name')
    for value in (source['charset'], source['collation']):
        if not re.fullmatch(r'[A-Za-z0-9_]+', value):
            raise PreflightError('Unsafe source charset or collation')
    import MySQLdb

    admin = MySQLdb.connect(read_default_file=str(private_option_file(option_file)), charset='utf8mb4')
    try:
        with admin.cursor() as cursor:
            cursor.execute('SELECT @@server_uuid, VERSION()')
            server_uuid, version = cursor.fetchone()
            if str(server_uuid) != source['server_uuid'] or str(version) != source['version']:
                raise PreflightError('QA creator points to a different MySQL server')
            cursor.execute(f'CREATE DATABASE `{qa_name}` CHARACTER SET {source["charset"]} '
                           f'COLLATE {source["collation"]}')
    finally:
        admin.close()


@contextmanager
def cloned_connection(qa_name, option_file):
    """Never mutate Django's default/production connection for QA work."""
    if not QA_NAME.fullmatch(qa_name):
        raise PreflightError('Invalid QA schema name')
    from django.db import connections

    alias = 'tactical_multiboard_qa'
    if alias in connections.databases:
        raise PreflightError('QA database alias already exists')
    config = deepcopy(connections.databases['default'])
    config.update({'NAME': qa_name, 'USER': '', 'PASSWORD': '', 'HOST': '', 'PORT': ''})
    config['OPTIONS'] = {**config.get('OPTIONS', {}),
                         'read_default_file': str(private_option_file(option_file))}
    connections.databases[alias] = config
    try:
        qa = connections[alias]
        yield qa
    finally:
        if hasattr(connections._connections, alias):
            connections[alias].close()
            del connections[alias]
        del connections.databases[alias]


def apply_0007(connection):
    from django.db.migrations.executor import MigrationExecutor

    require_plan(migration_plan(connection))
    executor = MigrationExecutor(connection)
    executor.migrate(TARGET)


def perform_rehearsal(manifest, folder, option_file, source_connection, backend):
    candidate, source, snapshot = inspect_source(source_connection, backend)
    require_manifest_match(manifest, candidate, source, snapshot)
    if manifest.get('qa') is not None:
        raise PreflightError('This backup already has QA evidence; do not create another clone')
    require_dump(manifest['dump'], folder)
    admin_server(option_file, source)
    qa_name = 'evem_tactical_qa_' + uuid4().hex[:12]
    create_qa_schema(option_file, source, qa_name)
    restore_dump(manifest['dump'], folder, option_file, qa_name)
    with cloned_connection(qa_name, option_file) as qa:
        require_clone_identity(source, database_identity(qa), qa_name)
        require_source_schema(qa)
        require_plan(migration_plan(qa))
        if source_snapshot(qa.alias) != snapshot:
            raise PreflightError('Restored QA data differs from the audited production snapshot')
        try:
            apply_0007(qa)
        except Exception as exc:
            raise PreflightError('QA migration failed; retain its schema for manual inspection') from exc
        verify_database_migration(qa, snapshot)
    return {**manifest, 'qa': {'database': qa_name, 'dump_sha256': manifest['dump']['sha256'],
                               'passed': True, 'checked_at': datetime.now(timezone.utc).isoformat()}}


def perform_production_migration(manifest, folder, option_file, source_connection, backend,
                                 maintenance_confirmed):
    candidate, source, snapshot = inspect_source(source_connection, backend)
    require_ready_to_migrate(manifest, candidate, source, snapshot, maintenance_confirmed)
    require_dump(manifest['dump'], folder)
    qa_name = require_rehearsal(manifest)['database']
    admin_server(option_file, source)
    with cloned_connection(qa_name, option_file) as qa:
        require_clone_identity(source, database_identity(qa), qa_name)
        verify_database_migration(qa, snapshot)
    # Re-read immediately before the first production DDL. Changed live data aborts.
    current = inspect_source(source_connection, backend)
    if current != (candidate, source, snapshot):
        raise PreflightError('Production source changed after QA verification')
    try:
        apply_0007(source_connection)
    except Exception as exc:
        raise PreflightError('Production 0007 failed; stop and inspect partial MySQL DDL, never retry or fake') from exc
    verify_database_migration(source_connection, snapshot)
    return {**manifest, 'production': {'applied_at': datetime.now(timezone.utc).isoformat(),
                                       'candidate_sha': candidate['sha'], 'verified': True}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=('inspect', 'backup', 'rehearse', 'migrate'))
    parser.add_argument('--env-file', type=Path, required=True)
    parser.add_argument('--mysql-options-file', type=Path)
    parser.add_argument('--backup-dir', type=Path)
    parser.add_argument('--maintenance-confirmed', action='store_true')
    args = parser.parse_args(argv)
    if os.name != 'posix':
        raise PreflightError('Production preflight runs only on the audited Linux/MySQL host')
    require_root_operator(os.geteuid())
    require_trusted_script_path(__file__)
    backend = Path.cwd()
    require_trusted_backend_tree(backend)
    environment = load_private_environment(args.env_file, CONFIG_PATH, backend)
    os.environ.update(environment)
    os.environ['DJANGO_SETTINGS_MODULE'] = 'EVE_MDjango.settings'
    sys.path.insert(0, str(backend))
    import django
    django.setup()
    from django.db import connections

    source_connection = connections['default']
    require_source_connection_settings(source_connection, environment)
    candidate, source, snapshot = inspect_source(source_connection, backend)
    if args.mode == 'inspect':
        print(json.dumps({'candidate': candidate, 'source': source, 'snapshot': snapshot}, ensure_ascii=False))
        return
    if not args.backup_dir or not args.mysql_options_file:
        raise PreflightError('Backup directory and private MySQL option file are required')
    option_file = private_option_file(args.mysql_options_file)
    if args.mode == 'backup':
        manifest = perform_backup(args.backup_dir, BACKUP_ROOT, option_file, source['database'],
                                  candidate, source, snapshot)
        print(json.dumps({'backup': str(args.backup_dir), 'sha256': manifest['dump']['sha256']}))
        return
    folder = existing_backup_folder(args.backup_dir)
    manifest = load_manifest(folder)
    if args.mode == 'rehearse':
        result = perform_rehearsal(manifest, folder, option_file, source_connection, backend)
        save_manifest(folder / 'backup.json', result)
        print(json.dumps({'qa': result['qa']['database'], 'passed': True}))
        return
    result = perform_production_migration(manifest, folder, option_file, source_connection,
                                          backend, args.maintenance_confirmed)
    save_manifest(folder / 'backup.json', result)
    print(json.dumps({'migration': TARGET[0][1], 'verified': True, 'candidate': candidate['sha']}))


if __name__ == '__main__':
    try:
        main()
    except PreflightError as exc:
        raise SystemExit(str(exc)) from None
