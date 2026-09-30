"""Offline extraction from an owner's capture; never connects or prints tokens.

Each bundle comes from one complete outbound TCP connection: handshake, four
captured authentication/character-entry calls and get_kill_info, with optional
verified read-only batch profiles. This is session reuse, not password login.
Callers must validate and store the result privately.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import copy
import hashlib
import os
from pathlib import Path
import socket
import stat
import struct
import subprocess
import sys

import msgpack


MAX_CAPTURE_BYTES = 50 * 1024 * 1024
MAX_RECORDS = 100_000
MAX_FLOWS = 4096
MAX_FRAME_SIZE = 10_000_000
MAX_RESYNC_BYTES = 65536
AUTH_METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info', 'select_character_id')
REQUIRED_METHODS = (*AUTH_METHODS, 'get_kill_info')
OPTIONAL_METHODS = ('get_public_info', 'get_corp_brief')


class CaptureError(Exception):
    """Sanitized failure: raw network/authentication values never enter logs."""


def _invalid():
    return CaptureError('No complete, structurally valid private KM session is available.')


def _read_capture(path):
    try:
        source = Path(path)
        if not source.is_absolute():
            raise _invalid()
        before = source.lstat()
        if not stat.S_ISREG(before.st_mode) or not 24 <= before.st_size <= MAX_CAPTURE_BYTES:
            raise _invalid()
        flags = os.O_RDONLY | getattr(os, 'O_BINARY', 0) | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_NONBLOCK', 0)
        with os.fdopen(os.open(source, flags), 'rb') as capture:
            opened = os.fstat(capture.fileno())
            if (not stat.S_ISREG(opened.st_mode) or not before.st_ino
                    or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)):
                raise _invalid()
            data = capture.read(MAX_CAPTURE_BYTES + 1)
        if len(data) > MAX_CAPTURE_BYTES:
            raise _invalid()
        return data
    except (OSError, TypeError, ValueError):
        raise _invalid() from None


def _records(data):
    formats = {b'\xd4\xc3\xb2\xa1': ('<', 1_000_000),
               b'\xa1\xb2\xc3\xd4': ('>', 1_000_000),
               b'\x4d\x3c\xb2\xa1': ('<', 1_000_000_000),
               b'\xa1\xb2\x3c\x4d': ('>', 1_000_000_000)}
    try:
        endian, scale = formats[data[:4]]
        major, minor, _zone, _accuracy, snaplen, linktype = struct.unpack_from(endian + 'HHIIII', data, 4)
        if (major, minor) != (2, 4) or not 1 <= snaplen <= MAX_CAPTURE_BYTES or linktype not in (1, 101, 12):
            raise _invalid()
        offset = 24
        count = 0
        while offset < len(data):
            count += 1
            if count > MAX_RECORDS or offset + 16 > len(data):
                raise _invalid()
            second, subsecond, captured, original = struct.unpack_from(endian + 'IIII', data, offset)
            offset += 16
            if subsecond >= scale or captured > snaplen or captured > original or offset + captured > len(data):
                raise _invalid()
            raw = data[offset:offset + captured]
            offset += captured
            yield second + subsecond / scale, raw, linktype
    except (KeyError, struct.error):
        raise _invalid() from None


def _tcp_payload(raw, linktype):
    offset = 0
    if linktype == 1:
        if len(raw) < 14 or raw[12:14] != b'\x08\x00':
            return None
        offset = 14
    if len(raw) < offset + 20 or raw[offset] >> 4 != 4:
        return None
    header = (raw[offset] & 15) * 4
    total = struct.unpack_from('!H', raw, offset + 2)[0]
    fragment = struct.unpack_from('!H', raw, offset + 6)[0]
    if header < 20 or total < header + 20 or len(raw) < offset + total or fragment & 0x3FFF or raw[offset + 9] != 6:
        return None
    tcp = offset + header
    source_port, destination_port, sequence = struct.unpack_from('!HHI', raw, tcp)
    tcp_header = (raw[tcp + 12] >> 4) * 4
    if tcp_header < 20 or header + tcp_header > total:
        return None
    payload = raw[tcp + tcp_header:offset + total]
    key = (socket.inet_ntoa(raw[offset + 12:offset + 16]), source_port,
           socket.inet_ntoa(raw[offset + 16:offset + 20]), destination_port)
    return key, sequence, payload, raw[tcp + 13]


def _reassemble(segments):
    """Keep separate contiguous regions; never join across a missing TCP byte."""
    chunks = []
    current = bytearray()
    start = end = None
    first_timestamp = None
    for sequence, payload, timestamp in sorted(segments, key=lambda value: value[0]):
        if end is None or sequence > end:
            if current:
                chunks.append((first_timestamp, bytes(current)))
            current = bytearray()
            start = end = sequence
            first_timestamp = timestamp
        if sequence < end:
            overlap = min(end - sequence, len(payload))
            if bytes(current[sequence - start:sequence - start + overlap]) != payload[:overlap]:
                return []  # ambiguous conflicting retransmission
            payload = payload[overlap:]
        current.extend(payload)
        end += len(payload)
    if current:
        chunks.append((first_timestamp, bytes(current)))
    return chunks


def _frame_at(stream, offset):
    if offset + 4 > len(stream):
        return None
    size = struct.unpack_from('<I', stream, offset)[0]
    if not 0 < size <= MAX_FRAME_SIZE or offset + 4 + size > len(stream):
        return None
    try:
        outer = msgpack.unpackb(stream[offset + 4:offset + 4 + size], raw=False, strict_map_key=False)
        if (not isinstance(outer, list) or len(outer) != 2 or type(outer[0]) is not int
                or not isinstance(outer[1], bytes)):
            return None
        inner = msgpack.unpackb(outer[1], raw=False, strict_map_key=False)
        return offset + 4 + size, outer[0], inner
    except (TypeError, ValueError, RecursionError, msgpack.UnpackException):
        return None


def _method(meta):
    try:
        if not isinstance(meta, dict) or not isinstance(meta.get('content'), bytes):
            return None
        body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
        if not isinstance(body, list) or len(body) < 4 or body[0] != 1:
            return None
        extension = body[3][0]
        if not isinstance(extension, msgpack.ExtType) or extension.code != 10:
            return None
        call = msgpack.unpackb(extension.data, raw=False, strict_map_key=False)
        if not isinstance(call, list) or len(call) < 2 or not isinstance(call[0], str) or not isinstance(call[1], list):
            return None
        if call[0] == 'get_kill_info' and (len(call[1]) != 1 or type(call[1][0]) is not int
                                         or call[1][0] <= 0 or body[2][1] != 'char_mgr'):
            return None
        return call[0]
    except (IndexError, KeyError, TypeError, ValueError, RecursionError, msgpack.UnpackException):
        return None


def _decode_flow(stream):
    offset = 0
    hello = None
    templates = {}
    optional = {}
    invalid_order = False
    while offset + 4 <= len(stream):
        decoded = _frame_at(stream, offset)
        if decoded is None:
            # Resync is only permitted before a handshake. Never skip missing
            # frames in a session and silently reuse its auth material.
            if hello is not None or offset >= MAX_RESYNC_BYTES:
                break
            offset += 1
            continue
        offset, kind, inner = decoded
        if kind == 1:
            # Any new handshake invalidates the old authentication context,
            # including malformed/empty handshakes. Do not salvage old auth.
            hello = None
            templates = {}
            optional = {}
            invalid_order = True
            if isinstance(inner, dict) and inner:
                hello = copy.deepcopy(inner)
                hello['token'] = ''
                invalid_order = False
            continue
        if hello is None or kind != 3:
            continue
        method = _method(inner)
        if method in OPTIONAL_METHODS and not invalid_order and len(templates) >= len(AUTH_METHODS):
            if method not in optional:
                meta = {key: inner[key] for key in ('content', 'flag') if key in inner}
                # Capture only the observed bounded batch form. Scalar forms
                # and missing-ID batches are deliberately not replayed.
                try:
                    body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
                    call = msgpack.unpackb(body[3][0].data, raw=False, strict_map_key=False)
                    ids = call[1][0]
                    route = 'char_proxy' if method == 'get_public_info' else 'corp_rec_proxy'
                    if (len(call) == 3 and call[2] == {} and body[2][1] == route
                            and isinstance(ids, list) and 1 <= len(ids) <= 512
                            and all(type(value) is int and 1 <= value < 2**63 for value in ids)
                            and len(set(ids)) == len(ids)):
                        optional[method] = meta
                except (IndexError, KeyError, TypeError, ValueError, msgpack.UnpackException):
                    pass
            continue
        if method in AUTH_METHODS and method in templates:
            invalid_order = True  # two login attempts are not one valid session
            continue
        if method not in REQUIRED_METHODS or method in templates or invalid_order:
            continue
        expected = REQUIRED_METHODS[len(templates)]
        if method != expected:
            invalid_order = True
            continue
        meta = {'content': inner['content']}
        if 'flag' in inner:
            meta['flag'] = inner['flag']
        templates[method] = meta
    if hello is not None and not invalid_order and set(templates) == set(REQUIRED_METHODS):
        return hello, {**templates, **optional}
    return None


def _bundle_api():
    root = Path(__file__).resolve().parents[2]
    backend = str(root / 'backend')
    if backend not in sys.path:
        sys.path.insert(0, backend)
    from Killboard import session_bundle
    return session_bundle


def extract_sessions(path):
    """Return all distinct complete connections oldest first, entirely offline."""
    flows = defaultdict(list)
    epochs = defaultdict(int)
    last_syn = {}
    closed = {}
    for timestamp, raw, linktype in _records(_read_capture(path)):
        parsed = _tcp_payload(raw, linktype)
        if parsed is None:
            continue
        key, sequence, payload, flags = parsed
        if flags & 0x02:  # SYN (including a retransmitted initial SYN)
            if last_syn.get(key) != sequence or closed.get(key, False):
                epochs[key] += 1
            last_syn[key] = sequence
            closed[key] = False
        connection = (*key, epochs[key])
        if payload:
            if connection not in flows and len(flows) >= MAX_FLOWS:
                raise _invalid()
            flows[connection].append((sequence + bool(flags & 0x02), payload, timestamp))
        if flags & 0x05:  # FIN/RST delimit even an empty control packet
            epochs[key] += 1
            closed[key] = True
    candidates = []
    for key, segments in flows.items():
        for timestamp, stream in _reassemble(segments):
            decoded = _decode_flow(stream)
            if decoded is not None:
                hello, templates = decoded
                candidates.append((timestamp, {'endpoint': [key[2], key[3]],
                                               'hello': hello, 'templates': templates}))
    if not candidates:
        raise _invalid()
    api = _bundle_api()
    result = []
    seen = set()
    for _, candidate in sorted(candidates, key=lambda value: value[0]):
        try:
            validated = api.validate_session(candidate)
            signature = hashlib.sha256(api.encode_session(validated).encode('utf-8')).digest()
        except api.SessionBundleError:
            continue
        if signature not in seen:
            seen.add(signature)
            result.append(validated)
    if not result or len(result) > api.MAX_SESSIONS:
        raise _invalid()
    return result


def extract_session(path):
    """Backward-compatible newest complete bundle; never logs capture values."""
    return extract_sessions(path)[-1]


def _check_private_directory(path):
    """Require an existing owner-only export directory outside the repository."""
    destination = Path(path)
    if not destination.is_absolute():
        raise _invalid()
    root = Path(__file__).resolve().parents[2]
    if destination.resolve() == root or root in destination.resolve().parents:
        raise _invalid()
    for component in (destination, *destination.parents):
        if component.is_symlink():
            raise _invalid()
        info = component.lstat()
        if getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise _invalid()
    info = destination.lstat()
    if not stat.S_ISDIR(info.st_mode):
        raise _invalid()
    if os.name == 'posix':
        if stat.S_IMODE(info.st_mode) != 0o700 or info.st_uid != os.geteuid():
            raise _invalid()
    elif os.name == 'nt':
        literal = str(destination).replace("'", "''")
        command = ("$ErrorActionPreference='Stop';"
                   "$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User;"
                   f"$acl=Get-Acl -LiteralPath '{literal}';"
                   "$valid=$acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Equals($sid);"
                   "$rules=$acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]);"
                   "foreach($rule in $rules){if($rule.AccessControlType -eq 'Allow' -and "
                   "-not $rule.IdentityReference.Equals($sid)){$valid=$false}};"
                   "if($valid -and $rules.Count -gt 0){Write-Output 'private'}else{exit 1}")
        checked = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
                                 capture_output=True, timeout=10, check=False,
                                 # A PowerShell 7 parent sets its own module
                                 # path; Windows PowerShell must discover its
                                 # native Security/ACL module independently.
                                 env={key: value for key, value in os.environ.items()
                                      if key.lower() != 'psmodulepath'})
        if checked.returncode != 0 or checked.stdout.strip() != b'private':
            raise _invalid()
    else:
        raise _invalid()


def export_sessions(bundles, directory):
    """Explicit private export; opaque deterministic names and no overwrite."""
    try:
        destination = Path(directory)
        _check_private_directory(destination)
        api = _bundle_api()
        if not isinstance(bundles, list) or not 1 <= len(bundles) <= api.MAX_SESSIONS:
            raise _invalid()
        documents = [api.encode_session(bundle) for bundle in bundles]
        names = ['session-' + hashlib.sha256(document.encode('utf-8')).hexdigest() + '.json'
                 for document in documents]
        if len(set(names)) != len(names):
            raise _invalid()
        paths = [destination / name for name in names]
        if any(path.exists() or path.is_symlink() for path in paths):
            raise _invalid()
        return [api.save_session(bundle, path) for bundle, path in zip(bundles, paths)]
    except Exception:
        raise _invalid() from None


class _QuietParser(argparse.ArgumentParser):
    def error(self, message):
        raise _invalid()


def main(argv=None):
    parser = _QuietParser(description='Validate an authorized private KM capture offline.')
    parser.add_argument('--capture', required=True, type=Path)
    parser.add_argument('--private-export-dir', type=Path,
                        help='Explicit existing owner-only directory outside the repository; never overwrites.')
    try:
        options = parser.parse_args(argv)
        bundles = extract_sessions(options.capture)
        if options.private_export_dir is not None:
            export_sessions(bundles, options.private_export_dir)
    except Exception:
        print('Private KM capture validation failed.', file=sys.stderr)
        return 1
    if options.private_export_dir is not None:
        print(f'Private KM sessions exported: {len(bundles)}. Server reuse is unverified.')
    else:
        print(f'Private KM capture validated: {len(bundles)} complete sessions; handshake + 4 authentication calls + KM query.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
