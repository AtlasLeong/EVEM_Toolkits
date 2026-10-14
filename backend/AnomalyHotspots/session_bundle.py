"""Separate read-only anomaly capability bundle. KM validation is unchanged."""
import binascii
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

import msgpack
from Killboard import session_bundle as km
from GameSessions.coordination import account_lease, CoordinationError
from GameSessions.rotation import round_robin

MAX_BUNDLE_SIZE = km.MAX_BUNDLE_SIZE
MAX_SESSIONS = km.MAX_SESSIONS
MAX_CURSOR_BYTES = 128
AUTH_METHODS = km.REQUIRED_METHODS[:-1]
HOTSPOT_METHOD = 'get_dungeon_destroy_statistics'
REQUIRED_METHODS = (*AUTH_METHODS, HOTSPOT_METHOD)
SessionBundleError = km.SessionBundleError
NeedsAuthError = km.NeedsAuthError


def _invalid():
    return SessionBundleError('Private anomaly session is unavailable or invalid.')


def derive_from_killboard(bundle):
    """Offline capability reduction; retain each account's own captured routing.

    Only the observed char_mgr/-1 envelope is compatible. This does not widen
    either validator, authenticate, persist, or borrow another account's route.
    """
    try:
        source = km.validate_session(bundle)
        meta = copy.deepcopy(source['templates']['get_kill_info'])
        body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
        body[3][0] = msgpack.ExtType(10, msgpack.packb([HOTSPOT_METHOD, [], {}], use_bin_type=True))
        meta['content'] = msgpack.packb(body, use_bin_type=True)
        result = {'endpoint': source['endpoint'], 'hello': source['hello'],
                  'templates': {method: source['templates'][method] for method in AUTH_METHODS}}
        result['templates'][HOTSPOT_METHOD] = meta
        return validate_session(result)
    except (KeyError, TypeError, ValueError, IndexError, RecursionError, msgpack.UnpackException,
            km.SessionBundleError):
        raise _invalid() from None


def validate_session(bundle):
    try:
        if (not isinstance(bundle, dict) or set(bundle) != {'endpoint', 'hello', 'templates'}
                or not isinstance(bundle['templates'], dict)
                or set(bundle['templates']) != set(REQUIRED_METHODS)):
            raise _invalid()
        meta = bundle['templates'][HOTSPOT_METHOD]
        body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
        if (not isinstance(body, list) or len(body) != 4
                or not isinstance(body[2], list) or len(body[2]) < 3
                or body[2][1] != 'char_mgr' or type(body[2][2]) is not int or body[2][2] != -1
                or not isinstance(body[3], list) or len(body[3]) != 1
                or not isinstance(body[3][0], msgpack.ExtType) or body[3][0].code != 10):
            raise _invalid()
        call = msgpack.unpackb(body[3][0].data, raw=False, strict_map_key=False)
        if call != [HOTSPOT_METHOD, [], {}] or len(call) != 3:
            raise _invalid()
        # Validate endpoint, hello, opaque auth trees, envelope and flags using
        # the existing strict validator, with one synthetic read-only KM call.
        synthetic = copy.deepcopy(bundle)
        body[3][0] = msgpack.ExtType(10, msgpack.packb(['get_kill_info', [1], {}], use_bin_type=True))
        synthetic['templates']['get_kill_info'] = {
            **synthetic['templates'].pop(HOTSPOT_METHOD),
            'content': msgpack.packb(body, use_bin_type=True)}
        km.validate_session(synthetic)
        return copy.deepcopy(bundle)
    except (KeyError, TypeError, ValueError, IndexError, RecursionError, msgpack.UnpackException,
            km.SessionBundleError):
        raise _invalid() from None


def encode_session(bundle):
    try:
        value = {'version': 1, **km._binary_tree(validate_session(bundle), encode=True)}
        encoded = json.dumps(value, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(',', ':'))
        if len(encoded.encode('utf-8')) > MAX_BUNDLE_SIZE:
            raise _invalid()
        return encoded
    except (ValueError, TypeError, RecursionError):
        raise _invalid() from None


def decode_session(encoded):
    try:
        size = len(encoded.encode('utf-8')) if isinstance(encoded, str) else len(encoded)
        if size > MAX_BUNDLE_SIZE: raise _invalid()
        value = json.loads(encoded, object_pairs_hook=km._unique_object)
        if not isinstance(value, dict) or type(value.get('version')) is not int or value.pop('version') != 1:
            raise _invalid()
        return validate_session(km._binary_tree(value, encode=False))
    except (ValueError, TypeError, RecursionError, binascii.Error, km.SessionBundleError):
        raise _invalid() from None


def load_session(path):
    try:
        source = km._session_path(path)
        km._reject_link_components(source)
        before = source.lstat()
        km._check_file_stat(before)
        if before.st_size > MAX_BUNDLE_SIZE: raise _invalid()
        flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        with os.fdopen(os.open(source, flags), 'rb') as stream:
            opened = os.fstat(stream.fileno())
            km._check_file_stat(opened)
            if (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino): raise _invalid()
            encoded = stream.read(MAX_BUNDLE_SIZE + 1)
            if km._file_generation(opened) != km._file_generation(os.fstat(stream.fileno())): raise _invalid()
        return decode_session(encoded)
    except (OSError, ValueError, TypeError, km.SessionBundleError):
        raise _invalid() from None


def _path_key(path):
    return os.path.normcase(os.path.abspath(os.path.normpath(str(path))))


def _session_paths(paths=None):
    if paths is None:
        configured = os.environ.get('ANOMALY_SESSION_FILES', '')
        singular = os.environ.get('ANOMALY_SESSION_FILE', '')
        paths = configured.split(os.pathsep) if configured.strip() else [singular]
        if configured.strip() and singular.strip():
            raise _invalid()
    elif isinstance(paths, (str, Path)):
        paths = [paths]
    if not isinstance(paths, (list, tuple)) or not 1 <= len(paths) <= MAX_SESSIONS:
        raise _invalid()
    sources = [km._session_path(path) for path in paths]
    if len({_path_key(path) for path in sources}) != len(sources):
        raise _invalid()
    return sources


def load_session_pool(paths=None):
    """Validate all explicit private files before selecting any account."""
    try:
        sources = _session_paths(paths)
        identities, materials, bundles = set(), set(), []
        for path in sources:
            km._reject_link_components(path)
            before = path.lstat()
            value = load_session(path)
            final = path.lstat()
            if km._file_generation(before) != km._file_generation(final):
                raise _invalid()
            identity = (final.st_dev, final.st_ino)
            material = hashlib.sha256(encode_session(value).encode('utf-8')).digest()
            if identity in identities or material in materials:
                raise _invalid()
            identities.add(identity)
            materials.add(material)
            bundles.append(value)
        return bundles
    except (OSError, ValueError, TypeError, km.SessionBundleError):
        raise _invalid() from None


def _cursor_parent(path):
    km._reject_link_components(path)
    info = path.parent.lstat()
    if not stat.S_ISDIR(info.st_mode) or (os.name == 'posix' and (
            info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) & 0o027)):
        raise _invalid()


def _check_cursor(info):
    km._check_file_stat(info)
    if info.st_size > MAX_CURSOR_BYTES or info.st_nlink != 1:
        raise _invalid()


def _read_cursor(path, pool_size):
    """Only benign bounded corruption restarts; insecure files fail closed."""
    _cursor_parent(path)
    try:
        before = path.lstat()
    except FileNotFoundError:
        return 0
    _check_cursor(before)
    flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
    with os.fdopen(os.open(path, flags), 'rb') as stream:
        opened = os.fstat(stream.fileno())
        _check_cursor(opened)
        if km._file_generation(before) != km._file_generation(opened):
            raise _invalid()
        encoded = stream.read(MAX_CURSOR_BYTES + 1)
        if km._file_generation(opened) != km._file_generation(os.fstat(stream.fileno())):
            raise _invalid()
    if len(encoded) > MAX_CURSOR_BYTES:
        raise _invalid()
    try:
        value = json.loads(encoded)
    except (ValueError, UnicodeError, RecursionError):
        return 0
    return value if type(value) is int and 0 <= value < pool_size else 0


def _write_cursor(path, value):
    temporary = None
    try:
        _cursor_parent(path)
        try:
            _check_cursor(path.lstat())
        except FileNotFoundError:
            pass
        descriptor, temporary = tempfile.mkstemp(prefix='.anomaly-cursor-', dir=path.parent)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
            if os.name == 'posix': os.fchmod(stream.fileno(), 0o600)
            stream.write(str(value) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        km._reject_link_components(path)
        os.replace(temporary, path)
        temporary = None
        if os.name == 'posix':
            descriptor = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
            try: os.fsync(descriptor)
            finally: os.close(descriptor)
    finally:
        if temporary is not None:
            try: os.unlink(temporary)
            except OSError: pass


def _check_cursor_collisions(path, sources):
    """Never overwrite configured source material or the independent KM state."""
    forbidden = list(sources)
    for name in ('KILLBOARD_SESSION_FILES', 'KILLBOARD_SESSION_FILE'):
        configured = os.environ.get(name, '')
        if configured.strip():
            forbidden.extend(km._session_path(value) for value in configured.split(os.pathsep))
    configured = os.environ.get('KILLBOARD_SESSION_CURSOR_FILE', '')
    for candidate in (configured, km.DEFAULT_CURSOR_FILE):
        if candidate:
            forbidden.append(km._session_path(candidate))
    for candidate in forbidden:
        if _path_key(path) == _path_key(candidate):
            raise _invalid()
        try:
            if path.exists() and candidate.exists() and path.samefile(candidate):
                raise _invalid()
        except FileNotFoundError:
            pass


def load_round_robin_session(paths=None, cursor_path=None):
    """One fixed (bundle, safe slot, index, size) per shared-locked worker pass.

    Multi-session pools need an explicit independent cursor. There is no
    discovery, default secret path, fallback on rejection, or network activity.
    The deployment's shared flock serializes selection and the complete pass.
    """
    try:
        sources = _session_paths(paths)
        bundles = load_session_pool(sources)
        # Validate explicit aliases before advancing the cursor; this creates
        # no lease transaction/socket. Offline callers can omit coordination,
        # while HotspotSession still requires it before connecting.
        account_lease('ANOMALY', 0, len(bundles))
        configured = os.environ.get('ANOMALY_SESSION_CURSOR_FILE', '') if cursor_path is None else cursor_path
        if not configured:
            if len(bundles) != 1:
                raise _invalid()
            return bundles[0], 'A', 0, 1
        path = km._session_path(configured)
        _check_cursor_collisions(path, sources)
        index, next_index = round_robin(len(bundles), _read_cursor(path, len(bundles)))
        _write_cursor(path, next_index)
        ordinal, slot = index + 1, ''
        while ordinal:
            ordinal, remainder = divmod(ordinal - 1, 26)
            slot = chr(65 + remainder) + slot
        return bundles[index], slot, index, len(bundles)
    except (OSError, ValueError, TypeError, km.SessionBundleError, CoordinationError):
        raise _invalid() from None


def save_session(bundle, path):
    temporary = None
    try:
        destination = km._session_path(path)
        km._reject_link_components(destination)
        encoded = encode_session(bundle).encode('utf-8')
        descriptor, temporary = tempfile.mkstemp(prefix='.anomaly-session-', dir=destination.parent)
        with os.fdopen(descriptor, 'wb') as stream:
            if os.name == 'posix': os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, destination)
        return destination
    except (OSError, ValueError, TypeError, km.SessionBundleError):
        raise _invalid() from None
    finally:
        if temporary is not None:
            try: os.unlink(temporary)
            except OSError: pass
