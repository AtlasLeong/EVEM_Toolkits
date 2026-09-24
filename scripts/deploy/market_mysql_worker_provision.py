"""Provision one least-privilege Market worker MySQL account after migrations."""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile
import uuid


DATABASE = 'eve_echoes'
MARKET_TABLES = frozenset({
    'Market_collectionrun', 'Market_latestprice', 'Market_marketconfig',
    'Market_marketconfigaudit', 'Market_marketitem', 'Market_pricesnapshot',
})
WORKER_HOST = '127.0.0.1'
ENV_PATH = Path('/EVEMTK/deploy/shared/market/database.env')
WORKER_GRANTS = (
    ('Market_collectionrun', 'SELECT, INSERT, UPDATE'),
    ('Market_latestprice', 'SELECT, INSERT, UPDATE'),
    ('Market_marketconfig', 'SELECT, INSERT, UPDATE'),
    ('Market_marketitem', 'SELECT, UPDATE'),
    ('Market_pricesnapshot', 'SELECT, INSERT'),
)


class ProvisionError(RuntimeError):
    """A safe-to-display refusal with no credentials or raw SQL error."""


def _identity(connection) -> tuple[str, str, str]:
    with connection.cursor() as cursor:
        cursor.execute('SELECT DATABASE(), @@server_uuid, @@global.mandatory_roles')
        row = cursor.fetchone()
    if not isinstance(row, (tuple, list)) or len(row) != 3:
        raise ProvisionError()
    database, server_uuid, mandatory_roles = row
    if not all(isinstance(value, str) for value in row):
        raise ProvisionError()
    try:
        parsed = uuid.UUID(server_uuid)
    except ValueError:
        raise ProvisionError() from None
    if database != DATABASE or not parsed.int or str(parsed) != server_uuid or mandatory_roles:
        raise ProvisionError()
    return database, server_uuid, mandatory_roles


def verify_local_target(source_connection, loopback_connection) -> str:
    """Prove the selected default DB and local TCP connection are the same server."""
    try:
        source = _identity(source_connection)
        loopback = _identity(loopback_connection)
        if source != loopback:
            raise ProvisionError()
        return source[1]
    except Exception:
        raise ProvisionError('Candidate and loopback MySQL identities could not be proven.') from None


def require_market_tables(connection) -> None:
    """Require the complete migrated Market schema, without touching its data."""
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES '
                           'WHERE TABLE_SCHEMA = DATABASE()')
            rows = cursor.fetchall()
        present = {}
        for row in rows:
            if not isinstance(row, (tuple, list)) or len(row) != 2:
                raise ProvisionError()
            table, kind = row
            if table in MARKET_TABLES:
                if table in present:
                    raise ProvisionError()
                present[table] = kind
        if set(present) != MARKET_TABLES or any(kind != 'BASE TABLE' for kind in present.values()):
            raise ProvisionError()
    except Exception:
        raise ProvisionError('The expected migrated Market tables are unavailable.') from None


def grant_market_worker(connection, username: str, password: str) -> None:
    """Create a fresh exact-host user; issue only static, table-level DML grants."""
    _require_generated_identity(username, password)
    try:
        with connection.cursor() as cursor:
            cursor.execute('CREATE USER %s@%s IDENTIFIED BY %s',
                           (username, WORKER_HOST, password))
            for table, privileges in WORKER_GRANTS:
                cursor.execute(
                    f'GRANT {privileges} ON `eve_echoes`.`{table}` TO %s@%s',
                    (username, WORKER_HOST),
                )
    except Exception:
        raise ProvisionError('Worker account creation or table grants failed; reconcile manually.') from None


def _require_generated_identity(username: str, password: str) -> None:
    if (not isinstance(username, str)
            or re.fullmatch(r'evem_market_worker_[0-9a-f]{12}', username) is None
            or not isinstance(password, str)
            or re.fullmatch(r'[A-Za-z0-9_-]{32,}', password) is None):
        raise ProvisionError('Generated worker identity is invalid.')


def private_market_directory(mode: int, owner_uid: int, effective_uid: int) -> bool:
    return (stat.S_ISDIR(mode) and owner_uid == effective_uid
            and not stat.S_IMODE(mode) & 0o027)


def write_private_environment(path: Path, username: str, password: str) -> None:
    """Publish a complete 0600 systemd env file atomically, never replacing one."""
    _require_generated_identity(username, password)
    path = Path(path)
    parent = path.parent
    try:
        if (not path.is_absolute() or path.name != 'database.env'
                or parent.is_symlink() or parent.resolve(strict=True) != parent
                or not parent.is_dir()):
            raise ProvisionError()
        if os.name != 'nt':
            metadata = parent.stat()
            if not private_market_directory(metadata.st_mode, metadata.st_uid, os.geteuid()):
                raise ProvisionError()
    except (OSError, RuntimeError, ProvisionError):
        raise ProvisionError('Worker environment parent is not private.') from None
    temporary = None
    try:
        descriptor, name = tempfile.mkstemp(prefix='.database.env-', dir=parent)
        temporary = Path(name)
        with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as output:
            for key, value in (
                ('MARKET_DB_NAME', DATABASE),
                ('MARKET_DB_USER', username),
                ('MARKET_DB_PASSWORD', password),
                ('MARKET_DB_HOST', WORKER_HOST),
                ('MARKET_DB_PORT', '3306'),
            ):
                output.write(f'{key}="{value}"\n')
            output.flush()
            os.fsync(output.fileno())
        os.link(temporary, path)
        if os.name != 'nt':
            flags = os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0) | getattr(os, 'O_NOFOLLOW', 0)
            directory_fd = os.open(parent, flags)
            try:
                os.fsync(directory_fd)
            finally:
                os.close(directory_fd)
    except OSError:
        raise ProvisionError('Private worker environment could not be installed; inspect before retry.') from None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def _open_loopback(source_connection, *, username=None, password=None):
    settings = source_connection.settings_dict
    if (source_connection.vendor != 'mysql'
            or settings.get('ENGINE') != 'django.db.backends.mysql'
            or settings.get('NAME') != DATABASE
            or any(not settings.get(key) for key in ('USER', 'PASSWORD', 'HOST', 'PORT'))):
        raise ProvisionError('The candidate default MySQL configuration is unsuitable.')
    parameters = {
        'host': WORKER_HOST,
        'port': 3306,
        'database': DATABASE,
        'user': username if username is not None else settings['USER'],
        'password': password if password is not None else settings['PASSWORD'],
        'charset': 'utf8mb4',
        'connect_timeout': 5,
    }
    return source_connection.get_new_connection(parameters)


def _verify_worker_login(connection, username: str, expected_uuid: str) -> None:
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT CURRENT_USER(), DATABASE(), @@server_uuid, CURRENT_ROLE()')
            identity = cursor.fetchone()
        if identity != (f'{username}@{WORKER_HOST}', DATABASE, expected_uuid, 'NONE'):
            raise ProvisionError()
    except Exception:
        raise ProvisionError('Worker login did not match the exact loopback account and server.') from None


def provision_worker(source_connection, env_path: Path = ENV_PATH) -> str:
    """Preflight the candidate/local target, then install one new restricted user."""
    admin_connection = None
    worker_connection = None
    try:
        admin_connection = _open_loopback(source_connection)
        server_uuid = verify_local_target(source_connection, admin_connection)
        require_market_tables(admin_connection)
        username = 'evem_market_worker_' + secrets.token_hex(6)
        password = secrets.token_urlsafe(32)
        _require_generated_identity(username, password)
        write_private_environment(env_path, username, password)
        grant_market_worker(admin_connection, username, password)
        worker_connection = _open_loopback(source_connection, username=username, password=password)
        _verify_worker_login(worker_connection, username, server_uuid)
        return server_uuid
    except ProvisionError:
        raise
    except Exception:
        raise ProvisionError('Worker provisioning failed; inspect the private env and account state.') from None
    finally:
        for connection in (worker_connection, admin_connection):
            if connection is not None:
                try:
                    connection.close()
                except Exception:
                    pass


def load_candidate_default_connection(backend: Path):
    """Select exactly one website candidate and its Django default DB in-process."""
    backend = Path(backend)
    if (not backend.is_absolute() or not (backend / 'manage.py').is_file()
            or not (backend / 'EVE_MDjango' / 'settings.py').is_file()
            or not (backend / '.env').is_file() or not (backend / 'logs').is_dir()):
        raise ProvisionError('Candidate backend or its private environment is unavailable.')
    if (os.environ.get('DJANGO_SETTINGS_MODULE') not in (None, 'EVE_MDjango.settings')
            or 'EVE_MDjango' in sys.modules or 'EVE_MDjango.settings' in sys.modules):
        raise ProvisionError('A different or already loaded Django candidate is selected.')
    try:
        sys.path.insert(0, str(backend.resolve(strict=True)))
        os.environ['DJANGO_SETTINGS_MODULE'] = 'EVE_MDjango.settings'
        import django
        django.setup()
        from django.db import connections
        connection = connections['default']
        if (connection.vendor != 'mysql'
                or connection.settings_dict.get('ENGINE') != 'django.db.backends.mysql'
                or connection.settings_dict.get('NAME') != DATABASE):
            raise ProvisionError()
        return connection
    except Exception:
        raise ProvisionError('The candidate default MySQL configuration could not be loaded.') from None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', required=True, type=Path,
                        help='Absolute staged backend directory with its private .env')
    parser.add_argument('--provision-worker', action='store_true',
                        help='Explicitly authorize account creation and table grants')
    args = parser.parse_args(argv)
    source_connection = None
    try:
        if not args.provision_worker:
            raise ProvisionError('Pass --provision-worker to authorize MySQL account creation.')
        if not sys.platform.startswith('linux') or not hasattr(os, 'geteuid') or os.geteuid() != 0:
            raise ProvisionError('Run this one-shot provisioning command as root on Linux.')
        source_connection = load_candidate_default_connection(args.backend)
        provision_worker(source_connection)
        print('Market worker MySQL account created; private environment installed.')
        return 0
    except ProvisionError as exc:
        parser.exit(1, str(exc) + '\n')
    except Exception:
        parser.exit(1, 'Worker provisioning failed; inspect the private env and account state.\n')
    finally:
        if source_connection is not None:
            try:
                source_connection.close()
            except Exception:
                pass


if __name__ == '__main__':
    raise SystemExit(main())
