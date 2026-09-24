"""Provision one isolated Market QA account on a proven loopback MySQL server."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import uuid


BACKUP_ROOT = Path('/EVEMTK/deploy-backups')
SOURCE_DATABASE = 'eve_echoes'
ENV_NAME = 'market-qa.env'
QA_SCHEMA_RE = re.compile(r'evem_market_qa_[0-9a-f]{12}\Z')


class QaProvisionError(RuntimeError):
    """Safe failure without database credentials or raw server output."""


def _connected_identity(connection) -> tuple[str, str]:
    with connection.cursor() as cursor:
        cursor.execute('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles')
        row = cursor.fetchone()
    if not isinstance(row, (tuple, list)) or len(row) != 3:
        raise QaProvisionError()
    database, server_uuid, mandatory_roles = row
    if (not isinstance(database, str) or not isinstance(server_uuid, str)
            or not isinstance(mandatory_roles, str) or mandatory_roles):
        raise QaProvisionError()
    try:
        parsed = uuid.UUID(server_uuid)
    except ValueError:
        raise QaProvisionError() from None
    if not parsed.int or str(parsed) != server_uuid:
        raise QaProvisionError()
    return database, server_uuid


def verify_same_server(source_connection, loopback_connection, expected_database: str) -> str:
    """Require the candidate and loopback connections to be the same schema/server."""
    try:
        source_database, source_uuid = _connected_identity(source_connection)
        loopback_database, loopback_uuid = _connected_identity(loopback_connection)
        if (source_database != expected_database or loopback_database != expected_database
                or source_uuid != loopback_uuid):
            raise QaProvisionError()
        return source_uuid
    except Exception:
        raise QaProvisionError('Candidate and loopback MySQL identities could not be proven.') from None


def validate_backup_directory(destination, expected_database, *, backup_root=BACKUP_ROOT,
                              effective_uid=None, stat_reader=None) -> Path:
    """Require the exact new root-private backup artifact directory."""
    try:
        destination = Path(destination)
        backup_root = Path(backup_root)
        if (expected_database != SOURCE_DATABASE or not destination.is_absolute()
                or not backup_root.is_absolute() or destination.parent != backup_root):
            raise QaProvisionError()
        if effective_uid != 0:
            raise QaProvisionError()
        reader = stat_reader or (lambda path: path.lstat())
        root_info = reader(backup_root)
        dir_info = reader(destination)
        if (not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != 0
                or stat.S_IMODE(root_info.st_mode) & 0o022
                or not stat.S_ISDIR(dir_info.st_mode) or dir_info.st_uid != 0
                or stat.S_IMODE(dir_info.st_mode) != 0o700):
            raise QaProvisionError()
        manifest = destination / 'backup.json'
        dump = destination / 'default-before-market.sql'
        manifest_info = reader(manifest)
        dump_info = reader(dump)
        for info in (manifest_info, dump_info):
            if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
                    or stat.S_IMODE(info.st_mode) != 0o600):
                raise QaProvisionError()
        with manifest.open('rb') as stream:
            contents = stream.read(4097)
        if len(contents) > 4096:
            raise QaProvisionError()
        record = json.loads(contents)
        if (not isinstance(record, dict) or record.get('database') != expected_database
                or record.get('file') != str(dump)
                or type(record.get('size')) is not int or record['size'] <= 0
                or record['size'] != dump_info.st_size
                or not isinstance(record.get('sha256'), str)
                or not re.fullmatch(r'[0-9a-f]{64}', record['sha256'])):
            raise QaProvisionError()
        return destination
    except Exception:
        raise QaProvisionError('A matching root-private backup directory is required.') from None


def _require_absent(connection, schema: str) -> None:
    try:
        checks = (
            ('SELECT COUNT(*) FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = %s',
             'QA schema already exists.'),
            ('SELECT COUNT(*) FROM mysql.user WHERE User = %s',
             'QA account already exists.'),
        )
        for sql, failure in checks:
            with connection.cursor() as cursor:
                cursor.execute(sql, (schema,))
                row = cursor.fetchone()
            if not isinstance(row, (tuple, list)) or len(row) != 1 \
                    or type(row[0]) is not int or row[0] != 0:
                raise QaProvisionError(failure)
    except QaProvisionError:
        raise
    except Exception:
        raise QaProvisionError('QA account and schema absence could not be proven.') from None


def write_private_env(destination: Path, schema: str, password: str,
                      server_uuid: str, *, platform_name=None, nofollow_flag=None,
                      open_file=None, chmod_file=None) -> None:
    """Write credentials exclusively in the private backup directory."""
    platform_name = os.name if platform_name is None else platform_name
    nofollow_flag = getattr(os, 'O_NOFOLLOW', 0) if nofollow_flag is None else nofollow_flag
    open_file = os.open if open_file is None else open_file
    chmod_file = getattr(os, 'fchmod', None) if chmod_file is None else chmod_file
    try:
        parsed_uuid = uuid.UUID(server_uuid)
        if (platform_name != 'posix' or not nofollow_flag or chmod_file is None
                or not Path(destination).is_absolute() or not QA_SCHEMA_RE.fullmatch(schema)
                or not isinstance(password, str) or len(password) < 24
                or not re.fullmatch(r'[A-Za-z0-9_-]+', password)
                or str(parsed_uuid) != server_uuid or not parsed_uuid.int):
            raise QaProvisionError()
    except (TypeError, ValueError, QaProvisionError):
        raise QaProvisionError('The private QA credential file could not be created.') from None
    output_path = Path(destination) / ENV_NAME
    data = (
        'EVEM_REHEARSAL_ENABLE=1\n'
        f'EVEM_REHEARSAL_DB_NAME={schema}\n'
        f'EVEM_REHEARSAL_DB_USER={schema}\n'
        f'EVEM_REHEARSAL_DB_PASSWORD={password}\n'
        f'EVEM_REHEARSAL_EXPECTED_SERVER_UUID={server_uuid}\n'
    )
    descriptor = None
    created = False
    try:
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | nofollow_flag
        flags |= getattr(os, 'O_CLOEXEC', 0)
        descriptor = open_file(output_path, flags, 0o600)
        created = True
        stream = os.fdopen(descriptor, 'w', encoding='ascii', newline='\n')
        descriptor = None
        with stream:
            chmod_file(stream.fileno(), 0o600)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        if descriptor is not None:
            os.close(descriptor)
        if created:
            try:
                output_path.unlink()
            except OSError:
                pass
        raise QaProvisionError('The private QA credential file could not be created.') from None


def provision_qa_account(destination, db_settings, source_connection, loopback_connection,
                         *, expected_database, backup_root=BACKUP_ROOT, effective_uid=None,
                         stat_reader=None) -> str:
    """Provision only a fresh same-named QA user, with no production-schema grants."""
    destination = validate_backup_directory(
        destination, expected_database, backup_root=backup_root,
        effective_uid=effective_uid, stat_reader=stat_reader,
    )
    if (not isinstance(db_settings, dict) or db_settings.get('NAME') != SOURCE_DATABASE
            or expected_database != SOURCE_DATABASE):
        raise QaProvisionError('The candidate default database is not the expected source schema.')
    server_uuid = verify_same_server(source_connection, loopback_connection,
                                     expected_database)
    schema = 'evem_market_qa_' + secrets.token_hex(6)
    password = secrets.token_urlsafe(32)
    if (not QA_SCHEMA_RE.fullmatch(schema) or not isinstance(password, str)
            or len(password) < 24 or not re.fullmatch(r'[A-Za-z0-9_-]+', password)):
        raise QaProvisionError('Secure QA credentials could not be generated.')
    _require_absent(loopback_connection, schema)
    try:
        write_private_env(destination, schema, password, server_uuid)
    except Exception:
        raise QaProvisionError('The private QA credential file could not be created.') from None
    escaped_schema = schema.replace('_', '\\_')
    try:
        with loopback_connection.cursor() as cursor:
            cursor.execute("CREATE USER %s@'127.0.0.1' IDENTIFIED BY %s", (schema, password))
            cursor.execute(
                f"GRANT ALL PRIVILEGES ON `{escaped_schema}`.* TO %s@'127.0.0.1'",
                (schema,),
            )
    except Exception:
        raise QaProvisionError(
            'QA account provisioning failed; inspect the private credential file and reconcile manually.'
        ) from None
    return schema


def _load_candidate_settings(backend):
    if __package__:
        from .market_mysql_backup import load_default_database_settings
    else:
        from market_mysql_backup import load_default_database_settings
    return load_default_database_settings(backend)


def _get_source_connection():
    from django.db import connections
    return connections['default']


def _connect_loopback(**kwargs):
    import MySQLdb
    return MySQLdb.connect(**kwargs)


def provision_from_candidate(backend, destination, expected_database,
                             *, load_settings=None, get_source_connection=None,
                             connect_loopback=None, backup_root=BACKUP_ROOT,
                             effective_uid=None, stat_reader=None,
                             platform_name=None) -> str:
    """Load the candidate in-process and prove its DB is the loopback target."""
    platform_name = os.name if platform_name is None else platform_name
    effective_uid = (getattr(os, 'geteuid', lambda: None)() if effective_uid is None
                     else effective_uid)
    if platform_name != 'posix' or effective_uid != 0 or expected_database != SOURCE_DATABASE:
        raise QaProvisionError('QA provisioning requires root on the expected Linux target.')
    destination = validate_backup_directory(
        destination, expected_database, backup_root=backup_root,
        effective_uid=effective_uid, stat_reader=stat_reader,
    )
    load_settings = _load_candidate_settings if load_settings is None else load_settings
    get_source_connection = (_get_source_connection if get_source_connection is None
                             else get_source_connection)
    connect_loopback = _connect_loopback if connect_loopback is None else connect_loopback
    try:
        settings, actual_database = load_settings(backend)
        if (not isinstance(settings, dict) or settings.get('NAME') != SOURCE_DATABASE
                or actual_database != SOURCE_DATABASE
                or any(not isinstance(settings.get(key), str) or not settings[key]
                       or any(char in settings[key] for char in '\x00\r\n')
                       for key in ('USER', 'PASSWORD'))):
            raise QaProvisionError()
        source_connection = get_source_connection()
    except Exception:
        raise QaProvisionError('The candidate default MySQL database could not be verified.') from None
    try:
        loopback_connection = connect_loopback(
            host='127.0.0.1', port=3306, user=settings['USER'],
            passwd=settings['PASSWORD'], db=SOURCE_DATABASE,
            connect_timeout=5, charset='utf8mb4',
        )
    except Exception:
        raise QaProvisionError('A loopback MySQL connection could not be established.') from None
    try:
        return provision_qa_account(
            destination, settings, source_connection, loopback_connection,
            expected_database=expected_database, backup_root=backup_root,
            effective_uid=effective_uid, stat_reader=stat_reader,
        )
    finally:
        try:
            loopback_connection.close()
        except Exception:
            pass


def main(argv=None, *, provisioner=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, required=True,
                        help='Absolute staged website backend with private .env')
    parser.add_argument('--expected-database', required=True,
                        help='Expected candidate default database (must be eve_echoes)')
    parser.add_argument('--backup-dir', type=Path, required=True,
                        help='Existing new backup directory under /EVEMTK/deploy-backups')
    parser.add_argument('--provision-qa', action='store_true',
                        help='Explicitly create one fresh QA account on the proven same server')
    args = parser.parse_args(argv)
    if not args.provision_qa:
        print('QA provisioning refused: --provision-qa is required.', file=sys.stderr)
        return 2
    provisioner = provision_from_candidate if provisioner is None else provisioner
    try:
        provisioner(args.backend, args.backup_dir, args.expected_database)
    except QaProvisionError as exc:
        print(f'QA provisioning refused: {exc}', file=sys.stderr)
        return 2
    except Exception:
        print('QA provisioning failed without a verified target.', file=sys.stderr)
        return 2
    print('QA account provisioned; credentials are in the private backup directory.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
