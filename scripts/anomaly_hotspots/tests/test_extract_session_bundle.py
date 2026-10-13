"""Offline synthetic captures only; derived KM is explicitly not captured."""
import copy
import importlib
import importlib.util
import io
from contextlib import redirect_stdout, redirect_stderr
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import msgpack
from scripts.killboard.tests.test_extract_session_bundle import frame, packet, capture

METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
           'select_character_id', 'get_dungeon_destroy_statistics')


def rpc(method):
    call = msgpack.ExtType(10, msgpack.packb([method, [] if method == METHODS[-1] else [42], {}], use_bin_type=True))
    return frame(3, {'content': msgpack.packb([1, [0, 42, 7], [0, 'char_mgr', -1], [call]], use_bin_type=True), 'flag': 2})


def stream(methods=METHODS):
    return frame(1, {'token': 'synthetic-private-token', 'version': 1}) + b''.join(rpc(method) for method in methods)


class ExtractTests(unittest.TestCase):
    def api(self):
        self.assertIsNotNone(importlib.util.find_spec('scripts.anomaly_hotspots.extract_session_bundle'), 'extractor missing')
        return importlib.import_module('scripts.anomaly_hotspots.extract_session_bundle')

    def extract(self, api, packets):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'synthetic.pcap'
            capture(path, packets)
            return api.extract_session(path)

    def test_ordered_auth_and_hotspot_one_context_derived_km_changes_business_only(self):
        api = self.api()
        original = self.extract(api, [packet(stream() + rpc('unrelated_mutation'))])
        self.assertEqual(set(original['templates']), set(METHODS))
        self.assertEqual(original['hello']['token'], '')
        untouched = copy.deepcopy(original)
        derived = api.derive_km_bundle(original, 20051112)
        self.assertEqual(original, untouched)
        self.assertEqual(derived['endpoint'], original['endpoint'])
        self.assertEqual(derived['hello'], original['hello'])
        for method in METHODS[:-1]: self.assertEqual(derived['templates'][method], original['templates'][method])
        old_body = msgpack.unpackb(original['templates'][METHODS[-1]]['content'], raw=False)
        new_body = msgpack.unpackb(derived['templates']['get_kill_info']['content'], raw=False)
        self.assertEqual(old_body[:3], new_body[:3])
        self.assertEqual(msgpack.unpackb(new_body[3][0].data, raw=False), ['get_kill_info', [20051112], {}])
        from Killboard.session_bundle import validate_session
        self.assertEqual(validate_session(derived), derived)
        for bad in (True, 0, -1, 2**63):
            with self.assertRaises(api.CaptureError): api.derive_km_bundle(original, bad)

    def test_gaps_handshakes_missing_auth_syn_epochs_and_duplicate_login_rejected(self):
        api = self.api()
        data = stream()
        first = stream(METHODS[:3])
        cases = [[packet(data[:100]), packet(data[110:], sequence=210)],
                 [packet(stream(METHODS[1:]))],
                 [packet(first + stream(METHODS[3:]))],
                 [packet(first), packet(stream(METHODS[3:]), source_port=40001)],
                 [packet(stream(METHODS[:1]) + b''.join(rpc(m) for m in METHODS))],
                 [packet(first), packet(b'', sequence=100+len(first)-1, flags=0x02),
                  packet(b''.join(rpc(m) for m in METHODS[3:]), sequence=100+len(first))]]
        for packets in cases:
            with self.assertRaises(api.CaptureError): self.extract(api, packets)

    def test_cli_private_export_no_tokens_paths_or_hashes(self):
        api = self.api()
        with tempfile.TemporaryDirectory() as directory:
            path, out = Path(directory) / 'private.pcap', Path(directory) / 'private'
            out.mkdir(mode=0o700)
            capture(path, [packet(stream())])
            stdout, stderr = io.StringIO(), io.StringIO()
            with patch.object(api, '_check_private_directory'), redirect_stdout(stdout), redirect_stderr(stderr):
                self.assertEqual(api.main(['--capture', str(path), '--private-export-dir', str(out)]), 0)
            self.assertNotIn('synthetic-private-token', stdout.getvalue()+stderr.getvalue())
            self.assertNotIn(str(path), stdout.getvalue()+stderr.getvalue())
            self.assertEqual(len(list(out.glob('*.json'))), 1)
