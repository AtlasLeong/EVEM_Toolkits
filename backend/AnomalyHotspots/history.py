"""Bounded sanitized history, with no Django, database or game/session imports.

The existing collector lock provides a single writer. Immutable samples are
durable before their manifest reference is committed; pruning happens only
after that commit. Web readers need group-read access, never write access.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import time

from .snapshot import STATUSES
from .validation import AnomalyValidationError, MAX_SAFE_INTEGER, MAX_SYSTEMS
from .metric import activity_metric, legacy_metric, validate_metric, validate_metric_rows

# These two limits bound committed manifest references, not crash staging.
RETENTION_MS = 30 * 24 * 60 * 60 * 1000
MAX_SAMPLES = 4321
MAX_HISTORY_BYTES = 512 * 1024 * 1024
MAX_SAMPLE_BYTES = 2 * 1024 * 1024
MAX_MANIFEST_BYTES = 1024 * 1024
MAX_ATTEMPTS = 200
MAX_ATTEMPT_BYTES = 128 * 1024
# One serialized writer may stage one sample before replacing the index. Old
# referenced files cannot be pruned before that commit. A metadata replacement
# may temporarily coexist with its old generation. Count unique inodes, since
# the immutable hardlink publication briefly has two names for the same bytes.
# These are collector-managed artifacts; unrelated operator files are untouched.
MAX_STAGED_SAMPLES = 1
MAX_PHYSICAL_SAMPLE_FILES = MAX_SAMPLES + MAX_STAGED_SAMPLES
MAX_PHYSICAL_HISTORY_BYTES = (MAX_HISTORY_BYTES + MAX_SAMPLE_BYTES
                              + 2 * MAX_MANIFEST_BYTES + MAX_ATTEMPT_BYTES)
MAX_DIRECTORY_ENTRIES = 20_000
SAMPLE_NAME = re.compile(r'sample-(0|[1-9][0-9]{0,15})\.json\Z')
TEMPORARY_NAME = re.compile(r'\.history-tmp-[a-zA-Z0-9_-]{8,64}\Z')
AUDIT_STAGES = frozenset({'connection', 'authentication', 'statistics'})
AUDIT_REASONS = (STATUSES - {'ok', 'unavailable'}) | frozenset({
    'timeout', 'connection_unavailable', 'session_closed', 'unsupported_rpc'})
# Mirror the collector's bounded pool without importing its private runtime.
MAX_POOL_SIZE = 201
HISTORY_STATUSES = frozenset({'ok', 'unavailable', 'disabled'})


class HistoryError(Exception):
    def __init__(self):
        super().__init__('Anomaly history is unavailable or invalid.')


def _integer(value, *, minimum=0, maximum=MAX_SAFE_INTEGER):
    if type(value) is not int or not minimum <= value <= maximum: raise HistoryError()
    return value


def _now(now_ms):
    return _integer(int(time.time() * 1000) if now_ms is None else now_ms)


def _no_links(path):
    for component in (path, *path.parents):
        if component.is_symlink(): raise HistoryError()
        try: info = component.lstat()
        except FileNotFoundError: continue
        if getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise HistoryError()


def _directory(directory, *, write=False):
    if not isinstance(directory, (str, Path)) or not str(directory).strip(): raise HistoryError()
    path = Path(directory)
    if not path.is_absolute(): raise HistoryError()
    _no_links(path)
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode): raise HistoryError()
    if os.name == 'posix' and (stat.S_IMODE(info.st_mode) not in (0o750, 0o2750)
                              or write and info.st_uid != os.geteuid()):
        raise HistoryError()
    return path, info


def _file_info(info, owner, maximum):
    if (not stat.S_ISREG(info.st_mode) or info.st_size > maximum or info.st_nlink != 1
            or getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400)):
        raise HistoryError()
    if os.name == 'posix' and (stat.S_IMODE(info.st_mode) != 0o640 or info.st_uid != owner.st_uid
                              or info.st_gid != owner.st_gid): raise HistoryError()


def _read(path, owner, maximum):
    _no_links(path)
    before = path.lstat()
    _file_info(before, owner, maximum)
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        _file_info(opened, owner, maximum)
        if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino): raise HistoryError()
        encoded = stream.read(maximum + 1)
        final = os.fstat(stream.fileno())
        if (opened.st_size, opened.st_mtime_ns, opened.st_ctime_ns) != (
                final.st_size, final.st_mtime_ns, final.st_ctime_ns): raise HistoryError()
    if len(encoded) > maximum: raise HistoryError()
    return encoded


def _decode(encoded):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result: raise HistoryError()
            result[key] = value
        return result
    return json.loads(encoded, object_pairs_hook=unique)


def _encode(value, maximum):
    result = json.dumps(value, separators=(',', ':'), allow_nan=False).encode('utf-8')
    if len(result) > maximum: raise HistoryError()
    return result


def _sync_directory(directory):
    if os.name != 'posix': return
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def _atomic(path, owner, encoded, *, immutable=False):
    temporary = None
    try:
        _no_links(path)
        if path.exists(): _file_info(path.lstat(), owner, max(MAX_MANIFEST_BYTES, MAX_ATTEMPT_BYTES))
        _physical_budget(path.parent, owner, len(encoded), sample=immutable)
        descriptor, temporary = tempfile.mkstemp(prefix='.history-tmp-', dir=path.parent)
        with os.fdopen(descriptor, 'wb') as stream:
            if os.name == 'posix':
                os.fchown(stream.fileno(), -1, owner.st_gid)
                os.fchmod(stream.fileno(), 0o640)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        if immutable:
            # Linking the fully fsynced file publishes all bytes at once and
            # fails on an existing name instead of replacing immutable data.
            os.link(temporary, path)
            os.unlink(temporary)
        else:
            os.replace(temporary, path)
        temporary = None
        _sync_directory(path.parent)
    finally:
        if temporary is not None:
            try: os.unlink(temporary)
            except OSError: pass


def _sample_name(stamp):
    return 'sample-' + str(_integer(stamp)) + '.json'


def _sample(value):
    legacy_keys = {'version', 'collected_at_ms', 'statistics_window', 'systems'}
    if (not isinstance(value, dict) or type(value.get('version')) is not int or value['version'] not in (1, 2)
            or set(value) != (legacy_keys if value['version'] == 1 else legacy_keys | {'metric'})
            or value['statistics_window'] is not None): raise HistoryError()
    metric = legacy_metric() if value['version'] == 1 else validate_metric(value['metric'])
    stamp = _integer(value['collected_at_ms'])
    return {'version': 2, 'collected_at_ms': stamp, 'statistics_window': None,
            'metric': metric, 'systems': validate_metric_rows(value['systems'], metric)}


def _entry(stamp, encoded):
    return {'id': stamp, 'bytes': len(encoded), 'sha256': hashlib.sha256(encoded).hexdigest()}


def _read_sample(directory, owner, entry):
    encoded = _read(directory / _sample_name(entry['id']), owner, MAX_SAMPLE_BYTES)
    if _entry(entry['id'], encoded) != entry: raise HistoryError()
    result = _sample(_decode(encoded))
    if result['collected_at_ms'] != entry['id']: raise HistoryError()
    return result


def _manifest(directory, owner):
    path = directory / 'manifest.json'
    try: value = _decode(_read(path, owner, MAX_MANIFEST_BYTES))
    except FileNotFoundError:
        # A missing index is not a new store if immutable samples already exist.
        for index, item in enumerate(directory.iterdir()):
            if index >= MAX_DIRECTORY_ENTRIES or SAMPLE_NAME.fullmatch(item.name): raise HistoryError()
        return []
    if (not isinstance(value, dict) or set(value) != {'version', 'samples'}
            or type(value['version']) is not int or value['version'] != 1
            or not isinstance(value['samples'], list) or len(value['samples']) > MAX_SAMPLES): raise HistoryError()
    previous, total = -1, 0
    for entry in value['samples']:
        if not isinstance(entry, dict) or set(entry) != {'id', 'bytes', 'sha256'}: raise HistoryError()
        stamp = _integer(entry['id'])
        size = _integer(entry['bytes'], minimum=1, maximum=MAX_SAMPLE_BYTES)
        if (stamp <= previous or not isinstance(entry['sha256'], str)
                or not re.fullmatch('[0-9a-f]{64}', entry['sha256'])): raise HistoryError()
        previous, total = stamp, total + size
        _file_info((directory / _sample_name(stamp)).lstat(), owner, MAX_SAMPLE_BYTES)
    if total > MAX_HISTORY_BYTES: raise HistoryError()
    return value['samples']


def _write_manifest(directory, owner, entries):
    _atomic(directory / 'manifest.json', owner,
            _encode({'version': 1, 'samples': entries}, MAX_MANIFEST_BYTES))


def _remove_orphans(directory, owner, referenced):
    """Only schema-valid, collector-owned immutable samples may be removed."""
    for index, path in enumerate(directory.iterdir()):
        if index >= MAX_DIRECTORY_ENTRIES: raise HistoryError()
        match = SAMPLE_NAME.fullmatch(path.name)
        if not match or path.name in referenced: continue
        stamp = _integer(int(match.group(1)))
        encoded = _read(path, owner, MAX_SAMPLE_BYTES)
        value = _sample(_decode(encoded))
        if value['collected_at_ms'] != stamp: raise HistoryError()
        # The parent is private and only the collector can mutate its entries.
        _no_links(path)
        _file_info(path.lstat(), owner, MAX_SAMPLE_BYTES)
        path.unlink()
    _sync_directory(directory)


def _cleanup_temporaries(directory, owner):
    """Recover files left by our atomic writer, never arbitrary dot files.

    Only the collector owns write access to this directory. A linked temporary
    may have two names after a crash; removing the temporary preserves the
    immutable published name, including a sample already referenced by index.
    """
    for index, path in enumerate(directory.iterdir()):
        if index >= MAX_DIRECTORY_ENTRIES: raise HistoryError()
        if not TEMPORARY_NAME.fullmatch(path.name): continue
        _no_links(path)
        info = path.lstat()
        if (not stat.S_ISREG(info.st_mode) or not 1 <= info.st_nlink <= 2
                or info.st_size > max(MAX_SAMPLE_BYTES, MAX_MANIFEST_BYTES, MAX_ATTEMPT_BYTES)):
            raise HistoryError()
        if os.name == 'posix':
            mode = stat.S_IMODE(info.st_mode)
            if (info.st_uid != owner.st_uid or mode not in (0o600, 0o640)
                    or mode == 0o640 and info.st_gid != owner.st_gid
                    or mode == 0o600 and info.st_nlink != 1): raise HistoryError()
        path.unlink()
    _sync_directory(directory)


def _physical_budget(directory, owner, additional_bytes, *, sample=False):
    """Bound recognized physical storage including crash-staged generations.

    Reject excess rather than deleting referenced data to make staging space.
    Caller holds the collector's single-writer lock. Existing orphan cleanup
    runs before the next publication, preventing accumulation across retries.
    """
    sample_count, total, seen = 0, additional_bytes, set()
    for index, path in enumerate(directory.iterdir()):
        if index >= MAX_DIRECTORY_ENTRIES: raise HistoryError()
        is_sample = SAMPLE_NAME.fullmatch(path.name)
        if not is_sample and path.name not in {'manifest.json', 'attempts.json'}: continue
        # The private parent was checked before entering publication; lstat
        # plus _file_info rejects leaf symlinks/reparse points without walking
        # the same ancestry thousands of times per bounded budget scan.
        info = path.lstat()
        maximum = MAX_SAMPLE_BYTES if is_sample else (
            MAX_MANIFEST_BYTES if path.name == 'manifest.json' else MAX_ATTEMPT_BYTES)
        _file_info(info, owner, maximum)
        sample_count += bool(is_sample)
        identity = (info.st_dev, info.st_ino)
        if identity not in seen:
            total += info.st_size
            seen.add(identity)
    if (sample_count + sample > MAX_SAMPLES + MAX_STAGED_SAMPLES
            or total > MAX_HISTORY_BYTES + MAX_SAMPLE_BYTES + 2 * MAX_MANIFEST_BYTES + MAX_ATTEMPT_BYTES):
        raise HistoryError()


def record_success(directory, rows, *, now_ms=None):
    try:
        stamp = _now(now_ms)
        value = _sample({'version': 2, 'collected_at_ms': stamp, 'statistics_window': None,
                         'metric': activity_metric(), 'systems': rows})
        encoded = _encode(value, MAX_SAMPLE_BYTES)
        if len(encoded) > MAX_HISTORY_BYTES: raise HistoryError()
        parent, owner = _directory(directory, write=True)
        _cleanup_temporaries(parent, owner)
        entries = _manifest(parent, owner)
        if entries:
            latest = _read_sample(parent, owner, entries[-1])
            if stamp < latest['collected_at_ms']: raise HistoryError()
            if stamp == latest['collected_at_ms']:
                if value != latest: raise HistoryError()
                _remove_orphans(parent, owner, {_sample_name(entry['id']) for entry in entries})
                return
        elif not (parent / 'manifest.json').exists():
            # Publish an empty index first, so a first-sample crash is recoverable.
            _write_manifest(parent, owner, [])
        target = parent / _sample_name(stamp)
        keep = {_sample_name(entry['id']) for entry in entries} | {target.name}
        _remove_orphans(parent, owner, keep)
        if target.exists():
            if _read(target, owner, MAX_SAMPLE_BYTES) != encoded: raise HistoryError()
        else:
            _atomic(target, owner, encoded, immutable=True)
        retained = [entry for entry in entries if entry['id'] >= stamp - RETENTION_MS]
        retained.append(_entry(stamp, encoded))
        total = sum(entry['bytes'] for entry in retained)
        while len(retained) > MAX_SAMPLES or total > MAX_HISTORY_BYTES:
            total -= retained.pop(0)['bytes']
        _write_manifest(parent, owner, retained)
        _remove_orphans(parent, owner, {_sample_name(entry['id']) for entry in retained})
    except (OSError, ValueError, TypeError, RecursionError, AnomalyValidationError):
        raise HistoryError() from None


def _empty(status='unavailable', *, metric=None):
    return {'version': 2, 'status': status, 'statistics_window': None, 'interval': None,
            'metric': legacy_metric() if metric is None else metric,
            'coverage': {'comparable': 0, 'new': 0, 'missing': 0, 'negative': 0, 'unchanged': 0},
            'systems': [], 'intervals': [], 'next_before': None}


def _interval(previous, current):
    return {'id': current['id'], 'start_at_ms': previous['id'], 'end_at_ms': current['id'],
            'elapsed_ms': current['id'] - previous['id']}


def read_changes(directory, *, interval=None, before=None, limit=100, now_ms=None):
    try:
        if interval is not None: _integer(interval)
        if before is not None: _integer(before)
        _integer(limit, minimum=1, maximum=100)
        current_time = _now(now_ms)
        if directory is None or directory == '': return _empty()
        try: parent, owner = _directory(directory)
        except FileNotFoundError: return _empty()
        entries = [entry for entry in _manifest(parent, owner)
                   if current_time - RETENTION_MS <= entry['id'] <= current_time]
        if not entries:
            if interval is not None: raise HistoryError()
            return _empty()
        if len(entries) == 1:
            sample = _read_sample(parent, owner, entries[0])
            if interval is not None: raise HistoryError()
            return _empty('baseline', metric=sample['metric'])
        choices = [_interval(entries[index - 1], entries[index]) for index in range(len(entries) - 1, 0, -1)]
        selected = next((item for item in choices if item['id'] == interval), None) if interval is not None else choices[0]
        if selected is None: raise HistoryError()
        page = [item for item in choices if before is None or item['id'] < before]
        next_before = page[limit - 1]['id'] if len(page) > limit else None
        by_id = {entry['id']: entry for entry in entries}
        old = _read_sample(parent, owner, by_id[selected['start_at_ms']])
        current = _read_sample(parent, owner, by_id[selected['end_at_ms']])
        if old['metric'] != activity_metric() or current['metric'] != activity_metric():
            return {**_empty('incomparable'), 'interval': selected,
                    'intervals': page[:limit], 'next_before': next_before}
        previous_counts = {row['solar_system_id']: row['destroy_num'] for row in old['systems']}
        current_counts = {row['solar_system_id']: row['destroy_num'] for row in current['systems']}
        comparable = previous_counts.keys() & current_counts.keys()
        systems = [{'solar_system_id': identifier, 'previous_destroy_num': previous_counts[identifier],
                    'destroy_num': current_counts[identifier],
                    'delta': current_counts[identifier] - previous_counts[identifier]}
                   for identifier in sorted(comparable)]
        return {'version': 2, 'status': 'ok', 'statistics_window': None, 'interval': selected,
                'metric': activity_metric(),
                'coverage': {'comparable': len(comparable), 'new': len(current_counts.keys() - previous_counts.keys()),
                             'missing': len(previous_counts.keys() - current_counts.keys()),
                             'negative': sum(row['delta'] < 0 for row in systems),
                             'unchanged': sum(row['delta'] == 0 for row in systems)},
                'systems': systems, 'intervals': page[:limit], 'next_before': next_before}
    except (OSError, ValueError, TypeError, RecursionError, AnomalyValidationError):
        raise HistoryError() from None


def _attempt(value):
    required = {'at_ms', 'status', 'system_count'}
    optional = {'session_slot', 'pool_size', 'rpc_count', 'stage', 'reason', 'history_status'}
    if (not isinstance(value, dict) or not required <= set(value) or set(value) - required - optional
            or value['status'] not in STATUSES): raise HistoryError()
    _integer(value['at_ms'])
    _integer(value['system_count'], maximum=MAX_SYSTEMS)
    if 'session_slot' in value and (not isinstance(value['session_slot'], str)
                                    or not re.fullmatch('[A-Z]{1,2}', value['session_slot'])): raise HistoryError()
    if 'pool_size' in value: _integer(value['pool_size'], minimum=1, maximum=MAX_POOL_SIZE)
    if 'rpc_count' in value: _integer(value['rpc_count'], maximum=5)
    if 'stage' in value and value['stage'] not in AUDIT_STAGES: raise HistoryError()
    if 'reason' in value and value['reason'] not in AUDIT_REASONS: raise HistoryError()
    if 'history_status' in value and value['history_status'] not in HISTORY_STATUSES: raise HistoryError()
    return value


def _attempts(parent, owner):
    try: value = _decode(_read(parent / 'attempts.json', owner, MAX_ATTEMPT_BYTES))
    except FileNotFoundError: return []
    if (not isinstance(value, dict) or set(value) != {'version', 'attempts'}
            or type(value['version']) is not int or value['version'] != 1
            or not isinstance(value['attempts'], list) or len(value['attempts']) > MAX_ATTEMPTS): raise HistoryError()
    return [_attempt(item) for item in value['attempts']]


def record_attempt(directory, status, *, now_ms=None, system_count=0, session_slot=None, pool_size=None,
                   audit=None, history_status=None):
    try:
        item = {'at_ms': _now(now_ms), 'status': status, 'system_count': system_count}
        if session_slot is not None: item['session_slot'] = session_slot
        if pool_size is not None: item['pool_size'] = pool_size
        if history_status is not None: item['history_status'] = history_status
        if isinstance(audit, dict):
            rpc_count = audit.get('rpc_count')
            if type(rpc_count) is int and 0 <= rpc_count <= 5: item['rpc_count'] = rpc_count
            if isinstance(audit.get('stage'), str) and audit['stage'] in AUDIT_STAGES: item['stage'] = audit['stage']
            if isinstance(audit.get('reason'), str) and audit['reason'] in AUDIT_REASONS: item['reason'] = audit['reason']
        _attempt(item)
        parent, owner = _directory(directory, write=True)
        _cleanup_temporaries(parent, owner)
        attempts = [item, *_attempts(parent, owner)][:MAX_ATTEMPTS]
        _atomic(parent / 'attempts.json', owner,
                _encode({'version': 1, 'attempts': attempts}, MAX_ATTEMPT_BYTES))
    except (OSError, ValueError, TypeError, RecursionError):
        raise HistoryError() from None


def read_attempts(directory):
    try:
        if directory is None or directory == '': return []
        try: parent, owner = _directory(directory)
        except FileNotFoundError: return []
        return _attempts(parent, owner)
    except (OSError, ValueError, TypeError, RecursionError):
        raise HistoryError() from None
