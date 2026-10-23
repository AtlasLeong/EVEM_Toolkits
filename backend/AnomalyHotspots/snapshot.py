"""Bounded sanitized last-good snapshots, atomically shared with the web API."""
import json
import os
from pathlib import Path
import stat
import tempfile
import time

from .validation import AnomalyValidationError, MAX_SAFE_INTEGER
from .metric import activity_metric, legacy_metric, validate_metric, validate_metric_rows

MAX_SNAPSHOT_BYTES = 2 * 1024 * 1024
STATUSES = frozenset({'ok', 'unavailable', 'unauthorized', 'rate_limited', 'network_error',
                      'malformed', 'budget_exhausted', 'lease_lost', 'configuration_error',
                      'service_rejected', 'account_busy'})
LEGACY_KEYS = frozenset({'version', 'collected_at_ms', 'last_attempt_at_ms', 'status', 'systems', 'statistics_window'})
KEYS = LEGACY_KEYS | {'metric'}


class SnapshotError(Exception):
    def __init__(self):
        super().__init__('Anomaly snapshot is unavailable or invalid.')


def unavailable():
    return {'version': 2, 'collected_at_ms': None, 'last_attempt_at_ms': None,
            'status': 'unavailable', 'systems': [], 'statistics_window': None,
            'metric': legacy_metric()}


def _timestamp(value, nullable=False):
    if value is None and nullable: return None
    if type(value) is not int or not 0 <= value <= MAX_SAFE_INTEGER: raise SnapshotError()
    return value


def validate_snapshot(value):
    try:
        if (not isinstance(value, dict) or type(value['version']) is not int
                or value['version'] not in (1, 2)
                or set(value) != (LEGACY_KEYS if value['version'] == 1 else KEYS)
                or value['statistics_window'] is not None
                or value['status'] not in STATUSES): raise SnapshotError()
        metric = legacy_metric() if value['version'] == 1 else validate_metric(value['metric'])
        collected = _timestamp(value['collected_at_ms'], True)
        attempted = _timestamp(value['last_attempt_at_ms'], True)
        rows = validate_metric_rows(value['systems'], metric)
        if (collected is None and rows or value['status'] == 'ok' and collected is None
                or collected is not None and (attempted is None or attempted < collected)):
            raise SnapshotError()
        return {**value, 'version': 2, 'systems': rows, 'metric': metric}
    except (KeyError, TypeError, AnomalyValidationError):
        raise SnapshotError() from None


def _reject_link_components(path):
    """Inspect every component with stdlib only; never load private bundles."""
    for component in (path, *path.parents):
        if component.is_symlink():
            raise SnapshotError()
        try:
            info = component.lstat()
        except FileNotFoundError:
            continue
        if getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise SnapshotError()


def _path(path):
    if not isinstance(path, (str, Path)) or not str(path).strip() or not Path(path).is_absolute():
        raise SnapshotError()
    result = Path(path)
    _reject_link_components(result)
    return result


def _check_file(info):
    if (not stat.S_ISREG(info.st_mode) or info.st_size > MAX_SNAPSHOT_BYTES
            or os.name == 'posix' and stat.S_IMODE(info.st_mode) != 0o640):
        raise SnapshotError()


def read_snapshot(path):
    try:
        source = _path(path)
        before = source.lstat()
        _check_file(before)
        flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        with os.fdopen(os.open(source, flags), 'rb') as stream:
            opened = os.fstat(stream.fileno())
            _check_file(opened)
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino): raise SnapshotError()
            encoded = stream.read(MAX_SNAPSHOT_BYTES + 1)
            final = os.fstat(stream.fileno())
            if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                    final.st_size, final.st_mtime_ns, final.st_ctime_ns): raise SnapshotError()
        if len(encoded) > MAX_SNAPSHOT_BYTES: raise SnapshotError()
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result: raise SnapshotError()
                result[key] = value
            return result
        return validate_snapshot(json.loads(encoded, object_pairs_hook=unique))
    except (OSError, ValueError, TypeError, RecursionError, SnapshotError):
        return unavailable()


def _write(path, value):
    temporary = None
    try:
        destination = _path(path)
        parent = destination.parent
        if not parent.is_dir(): raise SnapshotError()
        if os.name == 'posix':
            info = parent.stat()
            if stat.S_IMODE(info.st_mode) not in (0o750, 0o2750) or info.st_uid != os.geteuid(): raise SnapshotError()
            if destination.exists() and destination.stat().st_uid != os.geteuid(): raise SnapshotError()
        encoded = json.dumps(validate_snapshot(value), separators=(',', ':'), allow_nan=False).encode('utf-8')
        if len(encoded) > MAX_SNAPSHOT_BYTES: raise SnapshotError()
        descriptor, temporary = tempfile.mkstemp(prefix='.anomaly-snapshot-', dir=parent)
        with os.fdopen(descriptor, 'wb') as stream:
            if os.name == 'posix':
                os.fchmod(stream.fileno(), 0o640)
                os.fchown(stream.fileno(), -1, parent.stat().st_gid)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
        temporary = None
    except (OSError, ValueError, TypeError):
        raise SnapshotError() from None
    finally:
        if temporary is not None:
            try: os.unlink(temporary)
            except OSError: pass


def write_success(path, rows, *, now_ms=None):
    now = _timestamp(int(time.time() * 1000) if now_ms is None else now_ms)
    _write(path, {'version': 2, 'collected_at_ms': now, 'last_attempt_at_ms': now,
                  'status': 'ok', 'systems': rows, 'statistics_window': None,
                  'metric': activity_metric()})


def write_failure(path, status, *, now_ms=None):
    if status not in STATUSES - {'ok'}: raise SnapshotError()
    previous = read_snapshot(path)
    now = _timestamp(int(time.time() * 1000) if now_ms is None else now_ms)
    _write(path, {**previous, 'last_attempt_at_ms': now, 'status': status})
