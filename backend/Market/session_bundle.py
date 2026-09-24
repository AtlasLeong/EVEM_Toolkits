"""Private, portable captured-session bundles; no password login or DPAPI.

JSON version 1 retains ``endpoint``, ``hello`` and ``templates`` from the
capture importer. Binary values are encoded as {"$binary": "<base64>"}.
These files contain replayable authentication material, NOT public config.
Keep them outside Git/web/release roots with mode 0600 and a private parent.
This module deliberately has no CLI that could print bundle contents.
"""

from __future__ import annotations

import base64
import binascii
import copy
import ipaddress
import json
import math
import os
from pathlib import Path
import stat
import tempfile
from typing import Any

import msgpack


MAX_BUNDLE_SIZE = 2 * 1024 * 1024
MAX_DEPTH = 32
REQUIRED_METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
                    'select_character_id', 'get_super_orders')
OPTIONAL_METHODS = ('get_region_order_types',)


class NeedsAuthError(Exception):
    """No usable private session; operator refresh is required (safe to log)."""

    code = 'needs_auth'


class SessionBundleError(NeedsAuthError):
    """The private session file is missing, unsafe or structurally invalid."""


def _invalid():
    return SessionBundleError('Private market session is unavailable or invalid; refresh it securely.')


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
        return {key: _binary_tree(part, encode=encode, depth=depth + 1)
                for key, part in value.items()}
    if isinstance(value, (list, tuple)):
        return [_binary_tree(part, encode=encode, depth=depth + 1) for part in value]
    if value is None or isinstance(value, (str, bool)) or type(value) is int:
        return value
    if isinstance(value, float) and math.isfinite(value):
        return value
    raise _invalid()


def validate_session(bundle: dict[str, Any]) -> dict[str, Any]:
    """Validate a detached in-memory bundle before any network operation."""
    try:
        if not isinstance(bundle, dict) or set(bundle) != {'endpoint', 'hello', 'templates'}:
            raise _invalid()
        endpoint = bundle['endpoint']
        if (not isinstance(endpoint, (tuple, list)) or len(endpoint) != 2
                or not isinstance(endpoint[0], str) or type(endpoint[1]) is not int
                or not 1 <= endpoint[1] <= 65535):
            raise _invalid()
        # Captures provide literal IPs. Do not turn private bundle fields into
        # arbitrary URLs, DNS resolution, credentials or command execution.
        ipaddress.ip_address(endpoint[0])
        if not isinstance(bundle['hello'], dict) or not bundle['hello']:
            raise _invalid()
        templates = bundle['templates']
        if (not isinstance(templates, dict)
                or not set(REQUIRED_METHODS).issubset(templates)
                or set(templates) - set(REQUIRED_METHODS + OPTIONAL_METHODS)):
            raise _invalid()
        for method, meta in templates.items():
            if (not isinstance(meta, dict) or not isinstance(meta.get('content'), bytes)
                    or set(meta) - {'content', 'flag'}):
                raise _invalid()
            body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
            if (not isinstance(body, list) or len(body) < 4 or body[0] != 1
                    or not isinstance(body[1], list) or len(body[1]) < 3
                    or not isinstance(body[2], list) or len(body[2]) < 3
                    or not isinstance(body[3], list) or not body[3]
                    or not isinstance(body[3][0], msgpack.ExtType)):
                raise _invalid()
            call = msgpack.unpackb(body[3][0].data, raw=False, strict_map_key=False)
            if (not isinstance(call, list) or len(call) < 2 or call[0] != method
                    or not isinstance(call[1], list)):
                raise _invalid()
            if method == 'get_super_orders' and len(call[1]) < 2:
                raise _invalid()
            if method == 'get_region_order_types' and not call[1]:
                raise _invalid()
        # Validate serializability and bound opaque content even for callers
        # that bypass JSON loading, without changing their template objects.
        encoded = json.dumps(_binary_tree(bundle, encode=True), allow_nan=False)
        if len(encoded.encode('utf-8')) > MAX_BUNDLE_SIZE:
            raise _invalid()
        result = copy.deepcopy(bundle)
        result['endpoint'] = list(endpoint)
        return result
    except (ValueError, TypeError, KeyError, IndexError, OverflowError, RecursionError,
            msgpack.UnpackException):
        raise _invalid() from None


def encode_session(bundle: dict[str, Any]) -> str:
    """Return portable JSON for a validated bundle; callers must keep it private."""
    validated = validate_session(bundle)
    document = {'version': 1, **_binary_tree(validated, encode=True)}
    encoded = json.dumps(document, ensure_ascii=True, allow_nan=False, separators=(',', ':'))
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
        if not isinstance(document, dict) or type(document.get('version')) is not int or document.pop('version') != 1:
            raise _invalid()
        return validate_session(_binary_tree(document, encode=False))
    except (ValueError, TypeError, OverflowError, RecursionError, binascii.Error):
        raise _invalid() from None


def _check_file_stat(info) -> None:
    if not stat.S_ISREG(info.st_mode):
        raise _invalid()
    if os.name == 'posix':
        # Root-owned 0600 can only be read by a root collector; a non-root
        # collector must own its session rather than inheriting broad access.
        if stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.geteuid():
            raise _invalid()


def _session_path(path) -> Path:
    configured = path if path is not None else os.environ.get('MARKET_SESSION_FILE')
    if not configured:
        raise _invalid()
    result = Path(configured)
    if not result.is_absolute():
        raise _invalid()
    return result


def load_session(path: str | Path | None = None) -> dict[str, Any]:
    """Read one bounded, regular private file; never search for PCAP or DPAPI."""
    try:
        source = _session_path(path)
        # Inspect before open so a FIFO cannot block; inspect again on the
        # descriptor to reject replacement races. NONBLOCK also covers a FIFO
        # swapped in between lstat and open; NOFOLLOW rejects a swapped symlink.
        _check_file_stat(source.lstat())
        flags = (os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0)
                 | getattr(os, 'O_NONBLOCK', 0))
        descriptor = os.open(source, flags)
        with os.fdopen(descriptor, 'rb') as stream:
            _check_file_stat(os.fstat(stream.fileno()))
            return decode_session(stream.read(MAX_BUNDLE_SIZE + 1))
    except (OSError, ValueError, TypeError):
        raise _invalid() from None


def save_session(bundle: dict[str, Any], path: str | Path) -> Path:
    """Atomically install a private JSON bundle in an existing private directory.

    Windows callers must additionally secure the parent with an owner-only ACL;
    POSIX files are created with 0600. No credential material is ever logged.
    """
    temporary = None
    try:
        destination = _session_path(path)
        if destination.is_symlink():
            raise _invalid()
        encoded = encode_session(bundle).encode('utf-8')
        descriptor, temporary = tempfile.mkstemp(prefix='.market-session-', dir=destination.parent)
        with os.fdopen(descriptor, 'wb') as stream:
            if os.name == 'posix':
                os.fchmod(stream.fileno(), 0o600)
            stream.write(encoded)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, destination)
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
