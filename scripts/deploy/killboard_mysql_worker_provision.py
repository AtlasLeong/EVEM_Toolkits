"""One-shot root provisioning of table-scoped Killboard DML and private env."""
import argparse
import importlib.util
import os
from pathlib import Path
import re
import secrets
import stat
import sys
import tempfile

_spec = importlib.util.spec_from_file_location('market_worker_provision_shared', Path(__file__).with_name('market_mysql_worker_provision.py'))
shared = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(shared)
ProvisionError = shared.ProvisionError
GRANTS = {
    'Killboard_shipclass': 'SELECT, INSERT, UPDATE',
    'Killboard_collectionpolicy': 'SELECT, INSERT, UPDATE',
    'Killboard_killreport': 'SELECT, INSERT, UPDATE',
    'Killboard_killparticipant': 'SELECT, INSERT, UPDATE, DELETE',
    'Killboard_killitem': 'SELECT, INSERT, UPDATE, DELETE',
    'Killboard_probecursor': 'SELECT, INSERT, UPDATE',
    'Killboard_proberun': 'SELECT, INSERT, UPDATE',
}


def provision(connection, directory):
    directory = Path(directory)
    info = directory.lstat()
    if (not directory.is_absolute() or directory.is_symlink() or not stat.S_ISDIR(info.st_mode)
            or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700):
        raise ProvisionError('Private root-owned provisioning directory required.')
    environment = directory / 'database.env'
    if environment.exists():
        raise ProvisionError('Existing worker environment must be reviewed; refusing replacement.')
    admin = shared._open_loopback(connection)
    worker = None
    try:
        server_uuid = shared.verify_local_target(connection, admin)
        with admin.cursor() as cursor:
            cursor.execute('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')
            present = dict(cursor.fetchall())
            if any(present.get(table) != 'BASE TABLE' for table in GRANTS):
                raise ProvisionError('Migrated Killboard tables required.')
        username = 'evem_kb_' + secrets.token_hex(6)
        password = secrets.token_urlsafe(32)
        if not re.fullmatch(r'evem_kb_[0-9a-f]{12}', username) or not re.fullmatch(r'[A-Za-z0-9_-]{32,}', password):
            raise ProvisionError('Invalid generated identity.')
        # Persist recovery information privately before CREATE USER/GRANT.
        fd, temporary = tempfile.mkstemp(prefix='.database-', dir=directory)
        try:
            with os.fdopen(fd, 'w', encoding='utf-8') as out:
                for key, value in {'NAME': shared.DATABASE, 'USER': username, 'PASSWORD': password,
                                   'HOST': shared.WORKER_HOST, 'PORT': '3306'}.items():
                    out.write(f'KILLBOARD_DB_{key}="{value}"\n')
                out.flush()
                os.fsync(out.fileno())
            os.link(temporary, environment)
        finally:
            os.unlink(temporary)
        # MySQL account changes may be durable after a crash. Make the recovery
        # filename durable too before issuing any account mutation.
        directory_fd = os.open(directory, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0)
                               | getattr(os, 'O_NOFOLLOW', 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        with admin.cursor() as cursor:
            cursor.execute('CREATE USER %s@%s IDENTIFIED BY %s', (username, shared.WORKER_HOST, password))
            for table, privileges in GRANTS.items():
                cursor.execute(f'GRANT {privileges} ON `eve_echoes`.`{table}` TO %s@%s', (username, shared.WORKER_HOST))
        worker = shared._open_loopback(connection, username=username, password=password)
        shared._verify_worker_login(worker, username, server_uuid)
    except ProvisionError:
        raise
    except Exception:
        raise ProvisionError('Provisioning failed; inspect private account/config state before retry.') from None
    finally:
        for opened in (worker, admin):
            if opened is not None:
                opened.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', type=Path, required=True)
    parser.add_argument('--private-directory', type=Path, required=True)
    parser.add_argument('--provision-worker', action='store_true')
    args = parser.parse_args()
    try:
        if not args.provision_worker or not sys.platform.startswith('linux') or os.geteuid() != 0:
            raise ProvisionError('Explicit root provisioning required.')
        connection = shared.load_candidate_default_connection(args.backend)
        try:
            provision(connection, args.private_directory)
        finally:
            connection.close()
        print('Killboard table-scoped worker configured; no credentials displayed.')
    except Exception:
        parser.exit(1, 'Killboard worker provisioning failed; inspect private state.\n')


if __name__ == '__main__':
    main()
