"""Separate read-only anomaly capability bundle. KM validation is unchanged."""
import binascii
import copy
import json
import os
from pathlib import Path
import tempfile

import msgpack
from Killboard import session_bundle as km

MAX_BUNDLE_SIZE = km.MAX_BUNDLE_SIZE
AUTH_METHODS = km.REQUIRED_METHODS[:-1]
HOTSPOT_METHOD = 'get_dungeon_destroy_statistics'
REQUIRED_METHODS = (*AUTH_METHODS, HOTSPOT_METHOD)
SessionBundleError = km.SessionBundleError
NeedsAuthError = km.NeedsAuthError


def _invalid():
    return SessionBundleError('Private anomaly session is unavailable or invalid.')


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
