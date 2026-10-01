"""Bounded private captured-session bundles, not account/password login.

Only captured authentication, read-only ``get_kill_info`` and the two optional
verified batch identity calls are allowed. Version-1 JSON uses the
Market-compatible ``$binary`` representation.
Keep these replayable secrets outside Git, web and release roots. POSIX files
must be owned by the collector and mode 0600; Windows callers must secure the
parent directory and file with an owner-only ACL before loading or saving.
No capture, DPAPI, workbook, password or account discovery occurs here.
"""

from __future__ import annotations

import base64
import binascii
import copy
import hashlib
import ipaddress
import json
import math
import os
from pathlib import Path
import random
import stat
import tempfile
from typing import Any

import msgpack


MAX_BUNDLE_SIZE = 2 * 1024 * 1024
MAX_DEPTH = 32
MAX_SESSIONS = 201
MAX_KILL_ID = 2**63 - 1
REQUIRED_METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
                    'select_character_id', 'get_kill_info')
OPTIONAL_METHODS = ('get_public_info', 'get_corp_brief')
PROFILE_ROUTES = {'get_public_info': 'char_proxy', 'get_corp_brief': 'corp_rec_proxy'}
MAX_PROFILE_IDS = 512
DEFAULT_CURSOR_FILE = '/var/lib/evem-killboard/session-cursor.json' if os.name == 'posix' else None


class NeedsAuthError(Exception):
    """Private captured session unavailable; safe for discovery stop handling."""

    code = 'unauthorized'


class SessionBundleError(NeedsAuthError):
    """The configured private session is unavailable, unsafe or invalid."""


def _invalid() -> SessionBundleError:
    return SessionBundleError('Private Killboard session is unavailable or invalid; refresh it securely.')


def _binary_tree(value: Any, *, encode: bool, depth: int = 0) -> Any:
    if depth > MAX_DEPTH:
        raise _invalid()
    if encode and isinstance(value, bytes):
        return {'$binary': base64.b64encode(value).decode('ascii')}
    if isinstance(value, dict):
        if not all(isinstance(key, str) for key in value):
            raise _invalid()
        if '$binary' in value:
            if encode or set(value) != {'$binary'} or not isinstance(value['$binary'], str):
                raise _invalid()
            return base64.b64decode(value['$binary'], validate=True)
        return {key: _binary_tree(child, encode=encode, depth=depth + 1)
                for key, child in value.items()}
    if isinstance(value, (list, tuple)):
        return [_binary_tree(child, encode=encode, depth=depth + 1) for child in value]
    if value is None or isinstance(value, (str, bool)) or type(value) is int:
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise _invalid()


def validate_session(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return a detached validated bundle before any transport is attempted."""
    try:
        if not isinstance(bundle, dict) or set(bundle) != {'endpoint', 'hello', 'templates'}:
            raise _invalid()
        endpoint = bundle['endpoint']
        if (not isinstance(endpoint, (list, tuple)) or len(endpoint) != 2
                or not isinstance(endpoint[0], str) or type(endpoint[1]) is not int
                or not 1 <= endpoint[1] <= 65535):
            raise _invalid()
        ipaddress.ip_address(endpoint[0])  # Captures use literal IPs, never URLs/DNS.
        if not isinstance(bundle['hello'], dict) or not bundle['hello']:
            raise _invalid()
        templates = bundle['templates']
        if (not isinstance(templates, dict) or not set(REQUIRED_METHODS) <= set(templates)
                or set(templates) - set(REQUIRED_METHODS) - set(OPTIONAL_METHODS)):
            raise _invalid()
        # Bound in-memory callers too, before unpacking any opaque content.
        encoded = json.dumps(_binary_tree(bundle, encode=True), allow_nan=False)
        if len(encoded.encode('utf-8')) > MAX_BUNDLE_SIZE:
            raise _invalid()
        for method, meta in templates.items():
            if (not isinstance(meta, dict) or set(meta) - {'content', 'flag'}
                    or not isinstance(meta.get('content'), bytes)):
                raise _invalid()
            if 'flag' in meta and (type(meta['flag']) is not int or not 0 <= meta['flag'] <= 2**32 - 1):
                raise _invalid()
            body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
            if (not isinstance(body, list) or len(body) != 4 or type(body[0]) is not int or body[0] != 1
                    or not isinstance(body[1], list) or len(body[1]) < 3
                    or not isinstance(body[2], list) or len(body[2]) < 3
                    or not isinstance(body[3], list) or len(body[3]) != 1
                    or not isinstance(body[3][0], msgpack.ExtType) or body[3][0].code != 10):
                raise _invalid()
            call = msgpack.unpackb(body[3][0].data, raw=False, strict_map_key=False)
            if (not isinstance(call, list) or len(call) not in (2, 3) or call[0] != method
                    or not isinstance(call[1], list)):
                raise _invalid()
            # Captured calls have a third, empty kwargs mapping. Retain it
            # unchanged; do not authorize unobserved keyword behavior. The
            # two-element shape is supported for older synthetic callers.
            if len(call) == 3 and (not isinstance(call[2], dict) or call[2]):
                raise _invalid()
            if method == 'get_kill_info' and (
                body[2][1] != 'char_mgr' or len(call[1]) != 1
                or type(call[1][0]) is not int or not 1 <= call[1][0] <= MAX_KILL_ID
            ):
                raise _invalid()
            if method in OPTIONAL_METHODS:
                if (body[2][1] != PROFILE_ROUTES[method] or len(call) != 3
                        or len(call[1]) != 1 or not isinstance(call[1][0], list)
                        or not 1 <= len(call[1][0]) <= MAX_PROFILE_IDS
                        or any(type(identifier) is not int or not 1 <= identifier <= MAX_KILL_ID
                               for identifier in call[1][0])
                        or len(set(call[1][0])) != len(call[1][0])):
                    raise _invalid()
        result = copy.deepcopy(bundle)
        result['endpoint'] = list(endpoint)
        return result
    except (ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError,
            msgpack.UnpackException):
        raise _invalid() from None


def encode_session(bundle: dict[str, Any]) -> str:
    """Serialize a validated private session; do not print or publish the result."""
    document = {'version': 1, **_binary_tree(validate_session(bundle), encode=True)}
    encoded = json.dumps(document, ensure_ascii=True, allow_nan=False, sort_keys=True, separators=(',', ':'))
    if len(encoded.encode('utf-8')) > MAX_BUNDLE_SIZE:
        raise _invalid()
    return encoded


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise _invalid()
        result[key] = value
    return result


def decode_session(encoded: str | bytes) -> dict[str, Any]:
    try:
        size = len(encoded.encode('utf-8')) if isinstance(encoded, str) else len(encoded)
        if size > MAX_BUNDLE_SIZE:
            raise _invalid()
        document = json.loads(encoded, object_pairs_hook=_unique_object)
        if (not isinstance(document, dict) or type(document.get('version')) is not int
                or document.pop('version') != 1):
            raise _invalid()
        return validate_session(_binary_tree(document, encode=False))
    except (ValueError, TypeError, OverflowError, RecursionError, binascii.Error):
        raise _invalid() from None


def _check_file_stat(info) -> None:
    if not stat.S_ISREG(info.st_mode):
        raise _invalid()
    if os.name == 'posix' and (stat.S_IMODE(info.st_mode) != 0o600 or info.st_uid != os.geteuid()):
        raise _invalid()


def _session_path(path) -> Path:
    if not isinstance(path, (str, Path)) or not str(path).strip():
        raise _invalid()
    result = Path(path)
    if not result.is_absolute():
        raise _invalid()
    return result


def _reject_link_components(path: Path) -> None:
    for component in (path, *path.parents):
        if component.is_symlink():
            raise _invalid()
        try:
            info = component.lstat()
        except FileNotFoundError:
            continue
        if getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise _invalid()


def load_session(path: str | Path) -> dict[str, Any]:
    """Read one explicit regular private file with bounded size and race checks."""
    try:
        source = _session_path(path)
        _reject_link_components(source)
        before = source.lstat()
        _check_file_stat(before)
        if before.st_size > MAX_BUNDLE_SIZE:
            raise _invalid()
        flags = (os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
                 | getattr(os, 'O_NONBLOCK', 0))
        descriptor = os.open(source, flags)
        with os.fdopen(descriptor, 'rb') as stream:
            after = os.fstat(stream.fileno())
            _check_file_stat(after)
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise _invalid()
            return decode_session(stream.read(MAX_BUNDLE_SIZE + 1))
    except (OSError, ValueError, TypeError):
        raise _invalid() from None


def _session_paths(paths=None) -> list[Path]:
    if paths is None:
        configured = os.environ.get('KILLBOARD_SESSION_FILES', '')
        paths = configured.split(os.pathsep) if configured.strip() else []
    elif isinstance(paths, (str, Path)):
        paths = [paths]
    if not isinstance(paths, (list, tuple)) or not 1 <= len(paths) <= MAX_SESSIONS:
        raise _invalid()
    result = [_session_path(value) for value in paths]
    if len(set(result)) != len(result):
        raise _invalid()
    return result


def load_session_pool(paths=None) -> list[dict[str, Any]]:
    """Validate the explicit pool; invalid configuration fails closed as a whole."""
    bundles = [load_session(path) for path in _session_paths(paths)]
    fingerprints = {hashlib.sha256(encode_session(bundle).encode('utf-8')).digest() for bundle in bundles}
    if len(fingerprints) != len(bundles):
        raise _invalid()
    return bundles


def load_random_session(paths=None) -> dict[str, Any]:
    """Choose exactly one bundle per run, never an auth/rate-driven fallback."""
    return random.choice(load_session_pool(paths))


def _cursor_path(cursor_path=None) -> Path:
    """Resolve the private round-robin cursor without deriving a secret path."""
    if cursor_path is None:
        cursor_path = os.environ.get('KILLBOARD_SESSION_CURSOR_FILE', '') or DEFAULT_CURSOR_FILE
        if not cursor_path:
            cursor_path = str(Path.home() / '.local' / 'state' / 'evem-killboard' / 'session-cursor.json')
    return _session_path(cursor_path)


def _read_cursor(path: Path, pool_size: int) -> int:
    """Read one bounded integer; absent, invalid or out-of-range means index zero."""
    try:
        _reject_link_components(path)
        info = path.lstat()
        _check_file_stat(info)
        if info.st_size > 128:
            return 0
        encoded = path.read_text(encoding='utf-8')
        value = json.loads(encoded)
        if type(value) is not int or not 0 <= value < pool_size:
            return 0
        return value
    except (FileNotFoundError, OSError, UnicodeError, ValueError, TypeError, json.JSONDecodeError,
            SessionBundleError):
        return 0


def _write_cursor(path: Path, value: int) -> None:
    """Atomically replace the cursor with owner-only permissions."""
    try:
        _reject_link_components(path)
        parent = path.parent
        if not parent.is_dir() or parent.is_symlink():
            raise _invalid()
        descriptor, temporary = tempfile.mkstemp(prefix='.killboard-cursor-', dir=parent)
        try:
            with os.fdopen(descriptor, 'w', encoding='utf-8') as stream:
                if os.name == 'posix':
                    os.fchmod(stream.fileno(), 0o600)
                json.dump(value, stream, separators=(',', ':'))
                stream.write('\n')
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
            temporary = None
            if os.name == 'posix':
                os.chmod(path, 0o600)
        finally:
            if temporary is not None:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
    except (OSError, ValueError, TypeError):
        raise _invalid() from None


def load_round_robin_session(paths=None, cursor_path=None) -> dict[str, Any]:
    """Select one session for this run and atomically advance the next index.

    Cursor corruption is treated as a fresh pool (index zero), while an
    unreadable cursor directory fails closed instead of silently reusing one
    account forever. The selected bundle remains fixed for the caller's run.
    """
    bundles = load_session_pool(paths)
    path = _cursor_path(cursor_path)
    index = _read_cursor(path, len(bundles))
    _write_cursor(path, (index + 1) % len(bundles))
    return bundles[index]


def save_session(bundle: dict[str, Any], path: str | Path) -> Path:
    """Atomically create, never replace, a bundle (0600 POSIX/private Windows parent)."""
    temporary = None
    try:
        destination = _session_path(path)
        _reject_link_components(destination)
        encoded = encode_session(bundle).encode('utf-8')
        descriptor, temporary = tempfile.mkstemp(prefix='.killboard-session-', dir=destination.parent)
        with os.fdopen(descriptor, 'wb') as stream:
            if os.name == 'posix':
                os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        # Same-directory hardlink installs the fully flushed file atomically
        # and fails if *any* destination already exists, including symlinks.
        os.link(temporary, destination)
        os.unlink(temporary)
        temporary = None
        return destination
    except (OSError, ValueError, TypeError):
        raise _invalid() from None
    finally:
        if temporary is not None:
            try:
                os.unlink(temporary)
            except OSError:
                pass
