"""Guarded, operator-only gzip activation for two fixed public static locations.

The default is a read-only receipt. This is not installed or run by CI and is
not a general Nginx editor. No application, collector, TLS or private route is
changed. Public gzip/identity and private-boundary checks remain operator work.
"""
import argparse
from contextlib import contextmanager
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import tempfile


NGINX_SITE = Path('/etc/nginx/conf.d/evemtk.conf')
NGINX_MAIN = Path('/etc/nginx/nginx.conf')
BACKUP_ROOT = Path('/root/evem-public-gzip-backups')
PUBLISH_LOCK = Path('/EVEMTK/deploy/publish.lock')
TRANSACTION = Path('/EVEMTK/deploy/transaction.json')
ASSETS = b'''    location /assets/ {
        alias /EVEMTK/deploy/shared/assets/;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
'''
GZIP = b'''        gzip on;
        gzip_comp_level 5;
        gzip_min_length 1024;
        gzip_vary on;
        gzip_types text/css application/javascript text/javascript application/json;
'''
CATALOG = b'''    location = /industry/manufacturing-scope.json {
        try_files $uri =404;
        add_header Cache-Control "no-cache" always;
''' + GZIP + b'    }\n'


class PublicGzipError(RuntimeError):
    """Deliberately non-sensitive operator error."""


class RollbackError(PublicGzipError):
    def __init__(self, backup):
        super().__init__('activation failed and recovery failed; inspect private backup')
        self.backup = str(backup)


def _sha(data):
    return hashlib.sha256(data).hexdigest()


def prepare(source):
    """Return a strict two-location patch; refuse an unknown/already used layout."""
    if (source.count(ASSETS) != 1
            or len(re.findall(rb'\blocation\s+[^\n{;]*?/assets/', source)) != 1
            or re.search(rb'/industry/manufacturing-scope\.json|\bgzip(?:_\w+)?\s', source)
            or source.count(b'    root /EVEMTK/deploy/current/frontend;\n') != 1
            or source.count(b'    location /api/ {') != 1):
        raise PublicGzipError('unexpected or already modified site layout; manual review required')
    compressed_assets = ASSETS.replace(b'    }\n', GZIP + b'    }\n', 1)
    return source.replace(ASSETS, compressed_assets + CATALOG, 1)


def _validate_metadata(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0
            or stat.S_IMODE(info.st_mode) & 0o022 or info.st_nlink != 1):
        raise PublicGzipError('configuration must be a non-symlink root-owned regular file, not group/world writable')


def _checked_read(path):
    before = path.lstat()
    _validate_metadata(before)
    descriptor = os.open(str(path), os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        info = os.fstat(descriptor)
        _validate_metadata(info)
        if (info.st_dev, info.st_ino) != (before.st_dev, before.st_ino):
            raise PublicGzipError('configuration identity changed during inspection')
        with os.fdopen(descriptor, 'rb', closefd=False) as source:
            data = source.read(131073)
        if len(data) > 131072:
            raise PublicGzipError('unexpected configuration size')
        return data, info
    finally:
        os.close(descriptor)


def plan():
    source, _ = _checked_read(NGINX_SITE)
    main_source, _ = _checked_read(NGINX_MAIN)
    candidate = prepare(source)
    return {'status': 'dry_run', 'site_sha_before': _sha(source),
            'site_sha_after': _sha(candidate), 'main_sha': _sha(main_source)}


def _require_root():
    if os.name != 'posix' or os.geteuid() != 0:
        raise PublicGzipError('apply requires the existing Linux root operator channel')


@contextmanager
def _release_guard():
    # Never create or replace the publisher's lock, which would split identity.
    import fcntl
    before = PUBLISH_LOCK.lstat()
    if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
        raise PublicGzipError('expected provisioned publisher lock is unavailable')
    descriptor = os.open(str(PUBLISH_LOCK), os.O_RDONLY | os.O_NOFOLLOW)
    try:
        current = os.fstat(descriptor)
        if (current.st_dev, current.st_ino) != (before.st_dev, before.st_ino):
            raise PublicGzipError('publisher lock identity changed')
        try:
            fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise PublicGzipError('publisher is busy; wait for the normal transaction') from None
        if TRANSACTION.exists() or TRANSACTION.is_symlink():
            raise PublicGzipError('unfinished release transaction; operator recovery required')
        yield
    finally:
        os.close(descriptor)


def _check_trusted_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o022:
        raise PublicGzipError('backup parent must be a root-owned non-symlink directory, not group/world writable')


def _check_private_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) & 0o077:
        raise PublicGzipError('backup parent must be a root-private non-symlink directory')


def _backup(source, info, receipt):
    _check_trusted_directory(BACKUP_ROOT.parent)
    if not BACKUP_ROOT.exists():
        BACKUP_ROOT.mkdir(mode=0o700)
    _check_private_directory(BACKUP_ROOT)
    backup = Path(tempfile.mkdtemp(prefix='activation-', dir=str(BACKUP_ROOT)))
    metadata = {key: getattr(info, key) for key in ('st_mode', 'st_uid', 'st_gid', 'st_atime_ns', 'st_mtime_ns')}
    for name, data in (('evemtk.conf', source), ('receipt.json',
                       (json.dumps({**receipt, 'original_metadata': metadata}, sort_keys=True) + '\n').encode())):
        descriptor = os.open(str(backup / name), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, 'wb') as target:
            target.write(data)
            target.flush()
            os.fsync(target.fileno())
    return backup


def _replace(source, info, restore_time=False):
    descriptor, temporary = tempfile.mkstemp(prefix='.public-gzip-', dir=str(NGINX_SITE.parent))
    try:
        with os.fdopen(descriptor, 'wb') as target:
            target.write(source)
            target.flush()
            os.fsync(target.fileno())
            if hasattr(os, 'fchown'):
                os.fchown(target.fileno(), info.st_uid, info.st_gid)
            os.chmod(temporary, stat.S_IMODE(info.st_mode))
        if restore_time:
            os.utime(temporary, ns=(info.st_atime_ns, info.st_mtime_ns))
        os.replace(temporary, NGINX_SITE)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _run(*command):
    # nginx errors can contain configuration snippets; only sanitized errors
    # and receipt hashes leave this helper. The private backup remains local.
    subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)


def apply(expected_site_sha, expected_main_sha, *, runner=_run, verify=None):
    _require_root()
    if not all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value)
               for value in (expected_site_sha, expected_main_sha)):
        raise PublicGzipError('both exact lowercase SHA-256 digests are required for apply')
    with _release_guard():
        source, info = _checked_read(NGINX_SITE)
        main_source, _ = _checked_read(NGINX_MAIN)
        if _sha(source) != expected_site_sha or _sha(main_source) != expected_main_sha:
            raise PublicGzipError('configuration digest changed; inspect before applying')
        candidate = prepare(source)
        receipt = {'site_sha_before': _sha(source), 'site_sha_after': _sha(candidate),
                   'main_sha': _sha(main_source)}
        backup = _backup(source, info, receipt)
        # Refuse a concurrent manual edit rather than overwriting or rolling it back.
        if (_checked_read(NGINX_SITE)[0] != source or _checked_read(NGINX_MAIN)[0] != main_source):
            raise PublicGzipError('configuration changed after backup; no activation attempted')
        try:
            _replace(candidate, info)
            runner('nginx', '-t')
            runner('systemctl', 'reload', 'nginx')
            runner('systemctl', 'is-active', '--quiet', 'nginx')
            if verify is not None:
                verify()
        except BaseException:
            watched = (signal.SIGINT, signal.SIGTERM) + ((signal.SIGHUP,) if hasattr(signal, 'SIGHUP') else ())
            handlers = {item: signal.signal(item, signal.SIG_IGN) for item in watched}
            try:
                _replace(source, info, restore_time=True)
                if _checked_read(NGINX_SITE)[0] != source or _checked_read(NGINX_MAIN)[0] != main_source:
                    raise PublicGzipError('recovery content verification failed')
                runner('nginx', '-t')
                runner('systemctl', 'reload', 'nginx')
                runner('systemctl', 'is-active', '--quiet', 'nginx')
            except BaseException:
                raise RollbackError(backup) from None
            finally:
                for item, handler in handlers.items():
                    signal.signal(item, handler)
            raise PublicGzipError('activation failed; original configuration restored and service checked') from None
        return {**receipt, 'status': 'applied', 'backup': str(backup)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--expected-site-sha')
    parser.add_argument('--expected-main-sha')
    args = parser.parse_args(argv)
    handlers = {}
    try:
        if args.apply:
            if not args.expected_site_sha or not args.expected_main_sha:
                raise PublicGzipError('apply requires --expected-site-sha and --expected-main-sha')
            def interrupted(signum, frame):
                raise PublicGzipError('operator activation interrupted')
            for item in (signal.SIGINT, signal.SIGTERM) + ((signal.SIGHUP,) if hasattr(signal, 'SIGHUP') else ()):
                handlers[item] = signal.signal(item, interrupted)
            receipt = apply(args.expected_site_sha, args.expected_main_sha)
        else:
            receipt = plan()
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except PublicGzipError as error:
        receipt = {'status': 'failed', 'error': str(error)}
        if isinstance(error, RollbackError):
            receipt.update(status='recovery_failed', backup=error.backup)
        print(json.dumps(receipt, sort_keys=True))
        return 1
    except (OSError, ValueError):
        print(json.dumps({'status': 'failed', 'error': 'host preflight failed; inspect privately'}))
        return 1
    finally:
        for item, handler in handlers.items():
            signal.signal(item, handler)


if __name__ == '__main__':
    raise SystemExit(main())
