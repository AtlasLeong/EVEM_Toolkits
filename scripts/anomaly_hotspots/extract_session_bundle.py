"""Offline ordered anomaly capture extraction; never prints replayable values.

KM derivation is explicit: captured auth/route/flag with a verified read-only
business substitution. It is NOT a captured KM template and does NOT establish
that the account can query KM. Only a separately authorized live test can do so.
"""
import argparse
from collections import defaultdict
import copy
from pathlib import Path
import sys
import uuid

import msgpack
# Support both module execution and an explicit direct script invocation.
_ROOT = str(Path(__file__).resolve().parents[2])
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
from scripts.killboard import extract_session_bundle as pcap

CaptureError = pcap.CaptureError
_check_private_directory = pcap._check_private_directory
AUTH_METHODS = pcap.AUTH_METHODS
HOTSPOT_METHOD = 'get_dungeon_destroy_statistics'
REQUIRED_METHODS = (*AUTH_METHODS, HOTSPOT_METHOD)


def _invalid():
    return CaptureError('No complete private anomaly session is available.')


def _api():
    backend = str(Path(__file__).resolve().parents[2] / 'backend')
    if backend not in sys.path: sys.path.insert(0, backend)
    from AnomalyHotspots import session_bundle
    return session_bundle


def _decode_flow(stream):
    offset, hello, templates, invalid = 0, None, {}, False
    while offset + 4 <= len(stream):
        decoded = pcap._frame_at(stream, offset)
        if decoded is None:
            if hello is not None or offset >= pcap.MAX_RESYNC_BYTES: break
            offset += 1
            continue
        offset, kind, inner = decoded
        if kind == 1:
            hello, templates, invalid = None, {}, True
            if isinstance(inner, dict) and inner:
                hello = copy.deepcopy(inner)
                hello['token'] = ''
                invalid = False
            continue
        if hello is None or kind != 3: continue
        method = pcap._method(inner)
        if method in AUTH_METHODS and method in templates:
            invalid = True
            continue
        if method not in REQUIRED_METHODS or method in templates or invalid: continue
        if method != REQUIRED_METHODS[len(templates)]:
            invalid = True
            continue
        templates[method] = {key: inner[key] for key in ('content', 'flag') if key in inner}
    if hello is not None and not invalid and set(templates) == set(REQUIRED_METHODS):
        return hello, templates
    return None


def extract_sessions(path):
    try:
        flows, epochs, last_syn, closed = defaultdict(list), defaultdict(int), {}, {}
        for timestamp, raw, linktype in pcap._records(pcap._read_capture(path)):
            parsed = pcap._tcp_payload(raw, linktype)
            if parsed is None: continue
            key, sequence, payload, flags = parsed
            if flags & 2:
                if last_syn.get(key) != sequence or closed.get(key, False): epochs[key] += 1
                last_syn[key], closed[key] = sequence, False
            connection = (*key, epochs[key])
            if payload:
                if connection not in flows and len(flows) >= pcap.MAX_FLOWS: raise _invalid()
                flows[connection].append((sequence + bool(flags & 2), payload, timestamp))
            if flags & 5:
                epochs[key] += 1
                closed[key] = True
        candidates = []
        for key, segments in flows.items():
            for timestamp, stream in pcap._reassemble(segments):
                decoded = _decode_flow(stream)
                if decoded is not None:
                    hello, templates = decoded
                    candidates.append((timestamp, {'endpoint': [key[2], key[3]], 'hello': hello, 'templates': templates}))
        api, result, seen = _api(), [], set()
        for _, candidate in sorted(candidates, key=lambda value: value[0]):
            try:
                candidate = api.validate_session(candidate)
                # Dedup privately; do not expose credential digests or names.
                document = api.encode_session(candidate)
            except api.SessionBundleError: continue
            if document not in seen:
                seen.add(document)
                result.append(candidate)
        if not 1 <= len(result) <= 201: raise _invalid()
        return result
    except Exception:
        raise _invalid() from None


def extract_session(path):
    return extract_sessions(path)[-1]


def derive_km_bundle(hot_bundle, kill_id):
    """Preserve captured auth/route/flag; substitute only verified KM business."""
    try:
        candidate = _api().validate_session(hot_bundle)
        from Killboard.session_bundle import validate_session, MAX_KILL_ID
        if type(kill_id) is not int or not 1 <= kill_id <= MAX_KILL_ID: raise _invalid()
        meta = candidate['templates'].pop(HOTSPOT_METHOD)
        body = msgpack.unpackb(meta['content'], raw=False, strict_map_key=False)
        body[3][0] = msgpack.ExtType(10, msgpack.packb(['get_kill_info', [kill_id], {}], use_bin_type=True))
        candidate['templates']['get_kill_info'] = {**meta, 'content': msgpack.packb(body, use_bin_type=True)}
        return validate_session(candidate)
    except Exception:
        raise _invalid() from None


def export_sessions(bundles, directory):
    try:
        _check_private_directory(directory)
        if not isinstance(bundles, list) or not 1 <= len(bundles) <= 201: raise _invalid()
        api = _api()
        if len({api.encode_session(bundle) for bundle in bundles}) != len(bundles): raise _invalid()
        return [api.save_session(bundle, Path(directory) / ('anomaly-session-' + uuid.uuid4().hex + '.json'))
                for bundle in bundles]
    except Exception:
        raise _invalid() from None


class _QuietParser(argparse.ArgumentParser):
    def error(self, message): raise _invalid()


def main(argv=None):
    try:
        parser = _QuietParser(description='Validate authorized anomaly capture offline.')
        parser.add_argument('--capture', required=True, type=Path)
        parser.add_argument('--private-export-dir', type=Path)
        options = parser.parse_args(argv)
        bundles = extract_sessions(options.capture)
        if options.private_export_dir is not None: export_sessions(bundles, options.private_export_dir)
        print(f'Private anomaly capture validated: {len(bundles)} complete sessions. Live reuse is unverified.')
        return 0
    except Exception:
        print('Private anomaly capture validation failed.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
