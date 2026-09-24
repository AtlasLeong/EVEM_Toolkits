"""Create a verified, root-private backup of the website's default MySQL database."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile


BACKUP_ROOT = Path('/EVEMTK/deploy-backups')
DUMP_NAME = 'default-before-market.sql'


class BackupError(RuntimeError):
    """A safe-to-display backup failure without database credentials or dump data."""


def _option_value(value):
    return '"' + str(value).replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n') + '"'


def private_backup_parent(mode, owner_uid, effective_uid):
    return (stat.S_ISDIR(mode) and owner_uid == effective_uid
            and not stat.S_IMODE(mode) & 0o022)


def _verify_dump(path):
    size = path.stat().st_size
    if not size:
        raise BackupError('Database backup is empty.')
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
        source.seek(max(0, size - 4096))
        lines = source.read().splitlines()
    if not lines or not lines[-1].startswith(b'-- Dump completed on '):
        raise BackupError('Database backup is incomplete.')
    return size, digest.hexdigest()


def backup_default_database(destination, db_settings, *, backup_root=BACKUP_ROOT,
                            runner=subprocess.run):
    """Dump the entire default schema; never restore or apply migrations."""
    backup_root = Path(backup_root)
    destination = Path(destination)
    if (not destination.is_absolute() or not backup_root.is_absolute()
            or destination.parent != backup_root or backup_root.is_symlink()
            or not backup_root.is_dir()):
        raise BackupError('Backup destination must be a new direct child of the private backup root.')
    if os.name != 'nt':
        parent = backup_root.stat()
        if not private_backup_parent(parent.st_mode, parent.st_uid, os.geteuid()):
            raise BackupError('Backup root must be owned by the caller and not writable by others.')
    for key in ('NAME', 'USER', 'PASSWORD', 'HOST', 'PORT'):
        if not db_settings.get(key):
            raise BackupError('The default MySQL database configuration is incomplete.')
        if any(character in str(db_settings[key]) for character in ('\x00', '\r', '\n')):
            raise BackupError('The default MySQL database configuration is invalid.')
    try:
        destination.mkdir(mode=0o700)
    except OSError as exc:
        raise BackupError('Backup destination could not be created; no existing path is overwritten.') from None
    dump = destination / DUMP_NAME
    manifest = destination / 'backup.json'
    option_path = None
    success = False
    try:
        descriptor, option_name = tempfile.mkstemp(prefix='mysql-options-', dir=destination)
        option_path = Path(option_name)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as options:
            options.write('[client]\n')
            for key, value in (
                ('user', db_settings['USER']), ('password', db_settings['PASSWORD']),
                ('host', db_settings['HOST']), ('port', db_settings['PORT']),
            ):
                options.write(f'{key}={_option_value(value)}\n')
        flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0)
        child_environment = {key: os.environ[key]
                             for key in ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ')
                             if key in os.environ}
        child_environment['MYSQL_TEST_LOGIN_FILE'] = str(destination / 'no-login-file.cnf')
        with os.fdopen(os.open(dump, flags, 0o600), 'wb') as output:
            try:
                result = runner([
                    'mysqldump', f'--defaults-file={option_path}',
                    '--single-transaction', '--quick', '--routines', '--triggers', '--events',
                    '--no-tablespaces', '--set-gtid-purged=OFF', db_settings['NAME'],
                ], stdout=output, stderr=subprocess.PIPE, check=False,
                    env=child_environment)
            except (OSError, subprocess.SubprocessError):
                raise BackupError('Database backup command failed.') from None
            output.flush()
            os.fsync(output.fileno())
        if result.returncode:
            raise BackupError('Database backup command failed.')
        size, digest = _verify_dump(dump)
        record = {
            'file': str(dump), 'size': size, 'sha256': digest,
            'database': str(db_settings['NAME']),
            'created_at': datetime.now(timezone.utc).isoformat(),
        }
        with os.fdopen(os.open(manifest, flags, 0o600), 'w', encoding='utf-8') as output:
            json.dump(record, output, sort_keys=True)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        success = True
        return record
    finally:
        if option_path is not None:
            option_path.unlink(missing_ok=True)
        if not success:
            dump.unlink(missing_ok=True)
            manifest.unlink(missing_ok=True)


def load_default_database_settings(backend):
    """Load only the explicitly chosen website backend, without showing secrets."""
    backend = Path(backend)
    if (not backend.is_absolute() or not (backend / 'manage.py').is_file()
            or not (backend / 'EVE_MDjango' / 'settings.py').is_file()
            or not (backend / '.env').is_file() or not (backend / 'logs').is_dir()):
        raise BackupError('Candidate backend or its private environment is unavailable.')
    if os.environ.get('DJANGO_SETTINGS_MODULE') not in (None, 'EVE_MDjango.settings'):
        raise BackupError('A different Django settings module is already selected.')
    sys.path.insert(0, str(backend.resolve(strict=True)))
    os.environ['DJANGO_SETTINGS_MODULE'] = 'EVE_MDjango.settings'
    import django
    django.setup()
    from django.db import connections
    connection = connections['default']
    if connection.vendor != 'mysql':
        raise BackupError('The default database is not MySQL.')
    with connection.cursor() as cursor:
        cursor.execute('SELECT DATABASE()')
        actual_database = cursor.fetchone()[0]
    return dict(connection.settings_dict), actual_database


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--backend', required=True, type=Path,
                        help='Absolute candidate backend directory with its private .env')
    parser.add_argument('--expected-database', required=True,
                        help='Exact default schema name expected before creating the dump')
    parser.add_argument('--backup-dir', required=True, type=Path,
                        help='New direct child of /EVEMTK/deploy-backups')
    args = parser.parse_args(argv)
    try:
        if hasattr(os, 'geteuid') and os.geteuid() != 0:
            raise BackupError('Run the backup as root to create a root-private artifact.')
        settings, actual_database = load_default_database_settings(args.backend)
        if (settings.get('NAME') != args.expected_database
                or actual_database != args.expected_database):
            raise BackupError('The active default database does not match the expected schema.')
        record = backup_default_database(args.backup_dir, settings)
        print(json.dumps(record, sort_keys=True))
        return 0
    except BackupError as exc:
        parser.exit(1, str(exc) + '\n')
    except Exception:
        parser.exit(1, 'Market database backup failed without a verified dump.\n')


if __name__ == '__main__':
    raise SystemExit(main())
