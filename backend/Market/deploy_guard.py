"""Coordinate the short-lived market worker with publish and rollback."""

from contextlib import contextmanager
import errno
import os
from pathlib import Path
import stat


class CollectorBusy(Exception):
    pass


class CollectorUnavailable(Exception):
    pass


class _PosixFileLock:
    def acquire(self, stream):
        import fcntl
        fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def release(self, stream):
        import fcntl
        fcntl.flock(stream, fcntl.LOCK_UN)


@contextmanager
def collector_guard(root=None, *, lock_api=None):
    deploy_root = Path(root or os.environ.get('MARKET_DEPLOY_ROOT', '/EVEMTK/deploy'))
    if not deploy_root.is_absolute():
        raise CollectorUnavailable('market deployment root must be absolute')
    lock_path = deploy_root / 'shared' / 'market' / 'collector.lock'
    try:
        original = lock_path.lstat()
        if not stat.S_ISREG(original.st_mode) or lock_path.resolve(strict=True) != lock_path:
            raise CollectorUnavailable('market release lock is invalid')
    except OSError as exc:
        raise CollectorUnavailable('market release lock is unavailable') from exc
    flags = (os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_CLOEXEC', 0)
             | getattr(os, 'O_NONBLOCK', 0))
    try:
        descriptor = os.open(lock_path, flags)
    except OSError as exc:
        raise CollectorUnavailable('market release lock is unavailable') from exc
    lock = lock_api or _PosixFileLock()
    with os.fdopen(descriptor, 'rb') as stream:
        opened = os.fstat(stream.fileno())
        if (not stat.S_ISREG(opened.st_mode)
                or (opened.st_dev, opened.st_ino) != (original.st_dev, original.st_ino)):
            raise CollectorUnavailable('market release lock is invalid')
        try:
            lock.acquire(stream)
        except OSError as exc:
            if isinstance(exc, BlockingIOError) or exc.errno in (errno.EAGAIN, errno.EACCES):
                raise CollectorBusy('market release lock is busy') from None
            raise CollectorUnavailable('market release lock failed') from exc
        try:
            if (deploy_root / 'transaction.json').exists():
                raise CollectorBusy('unfinished release blocks market collection')
            yield
        finally:
            lock.release(stream)
