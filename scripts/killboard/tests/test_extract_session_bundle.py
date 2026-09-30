"""Synthetic packets only: no real credentials or game connection."""

from pathlib import Path
import io
import os
import stat
import socket
import struct
import tempfile
import unittest
from unittest.mock import patch
from contextlib import redirect_stdout, redirect_stderr

import msgpack

from scripts.killboard import extract_session_bundle as extractor


METHODS = ('login_sigma', 'request_start_wait', 'get_newbie_info',
           'select_character_id', 'get_kill_info')


def frame(kind, value):
    packed = msgpack.packb([kind, msgpack.packb(value, use_bin_type=True)], use_bin_type=True)
    return struct.pack('<I', len(packed)) + packed


def rpc(method):
    # Observed request calls have a third, empty keyword-argument dictionary.
    call = msgpack.ExtType(10, msgpack.packb([method, [19748417], {}], use_bin_type=True))
    body = [1, [0, 42, 7], [0, 'char_mgr', -1], [call]]
    return frame(3, {'content': msgpack.packb(body, use_bin_type=True),
                     'flag': 2, 'seq': 6, 'ack': 5, 'trace': 'synthetic'})


def stream(methods=METHODS, *, version=1):
    return frame(1, {'token': 'synthetic-private-token', 'version': version}) + b''.join(rpc(method) for method in methods)


def packet(data, *, sequence=100, source_port=40000, fragment=0, flags=0x18):
    tcp = struct.pack('!HHIIBBHHH', source_port, 15182, sequence, 0, 5 << 4, flags, 65535, 0, 0)
    ip = struct.pack('!BBHHHBBH4s4s', 0x45, 0, 40 + len(data), 1, fragment,
                     64, 6, 0, socket.inet_aton('192.0.2.1'), socket.inet_aton('198.51.100.1'))
    return ip + tcp + data


def capture(path, packets, *, linktype=101):
    result = bytearray(struct.pack('<IHHIIII', 0xA1B2C3D4, 2, 4, 0, 0, 65535, linktype))
    for index, raw in enumerate(packets):
        result.extend(struct.pack('<IIII', index + 1, 0, len(raw), len(raw)))
        result.extend(raw)
    path.write_bytes(result)


class ExtractSessionTests(unittest.TestCase):
    def extract(self, packets, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.pcap'
            capture(source, packets, **kwargs)
            return extractor.extract_session(source)

    def test_complete_outbound_session_retains_only_required_templates(self):
        bundle = self.extract([packet(stream() + rpc('unrelated_write_method'))])
        self.assertEqual(bundle['endpoint'], ['198.51.100.1', 15182])
        self.assertEqual(bundle['hello']['token'], '')
        self.assertEqual(set(bundle['templates']), set(METHODS))
        self.assertTrue(all(set(meta) == {'content', 'flag'} for meta in bundle['templates'].values()))

    def test_tcp_reassembly_deduplicates_overlap_and_out_of_order_segments(self):
        data = stream()
        bundle = self.extract([packet(data[100:], sequence=200),
                               packet(data[:150]), packet(data[:150])])
        self.assertEqual(set(bundle['templates']), set(METHODS))

    def test_tcp_gap_does_not_join_incomplete_auth_to_later_calls(self):
        data = stream()
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(data[:100]), packet(data[110:], sequence=210)])

    def test_templates_cannot_be_mixed_between_connections(self):
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(stream(METHODS[:3])),
                          packet(stream(METHODS[3:]), source_port=40001)])

    def test_new_hello_resets_auth_even_in_same_flow(self):
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(stream(METHODS[:3]) + stream(METHODS[3:]))])

    def test_duplicate_login_cannot_mix_two_authentication_attempts(self):
        first = stream(METHODS[:1])
        second = b''.join(rpc(method) for method in METHODS)
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(first + second)])

    def test_empty_or_invalid_new_hello_discards_previous_authentication(self):
        for invalid_hello in ({}, None, ['not a handshake']):
            with self.subTest(hello=invalid_hello), self.assertRaises(extractor.CaptureError):
                self.extract([packet(stream(METHODS[:3]) + frame(1, invalid_hello)
                                     + b''.join(rpc(method) for method in METHODS[3:]))])

    def test_same_tcp_tuple_new_syn_cannot_join_previous_authentication(self):
        first = stream(METHODS[:3])
        second = b''.join(rpc(method) for method in METHODS[3:])
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(first), packet(b'', sequence=100 + len(first) - 1, flags=0x02),
                          packet(second, sequence=100 + len(first))])

    def test_fin_or_rst_ends_the_connection_even_without_payload(self):
        first = stream(METHODS[:3])
        second = b''.join(rpc(method) for method in METHODS[3:])
        for flags in (0x01, 0x04):
            with self.subTest(flags=flags), self.assertRaises(extractor.CaptureError):
                self.extract([packet(first), packet(b'', sequence=100 + len(first), flags=flags),
                              packet(second, sequence=100 + len(first))])

    def test_missing_or_wrongly_ordered_auth_is_rejected(self):
        for methods in (METHODS[1:], (METHODS[1], METHODS[0], *METHODS[2:])):
            with self.subTest(methods=methods), self.assertRaises(extractor.CaptureError):
                self.extract([packet(stream(methods))])

    def test_ethernet_ipv4_is_supported_but_fragmented_ip_is_not(self):
        ethernet = b'\0' * 12 + b'\x08\x00'
        self.assertEqual(len(self.extract([ethernet + packet(stream())], linktype=1)['templates']), 5)
        with self.assertRaises(extractor.CaptureError):
            self.extract([packet(stream(), fragment=0x2000)])

    def test_most_recent_complete_flow_is_selected(self):
        bundle = self.extract([packet(stream()), packet(stream(version=2), source_port=40001)])
        self.assertEqual(bundle['hello']['version'], 2)

    def test_extract_sessions_returns_all_distinct_complete_connections_newest_last(self):
        self.assertTrue(hasattr(extractor, 'extract_sessions'), 'all-connections extractor is missing')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.pcap'
            capture(source, [packet(stream()), packet(stream(version=2), source_port=40001),
                             packet(stream(METHODS[:3]), source_port=40002)])
            candidates = extractor.extract_sessions(source)
            self.assertEqual([candidate['hello']['version'] for candidate in candidates], [1, 2])
            self.assertEqual(extractor.extract_session(source), candidates[-1])

    def test_private_export_is_opaque_binary_preserving_and_refuses_overwrites(self):
        self.assertTrue(hasattr(extractor, 'export_sessions'), 'private session exporter is missing')
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'synthetic.pcap'
            destination = Path(directory) / 'private'
            destination.mkdir(mode=0o700)
            capture(source, [packet(stream()), packet(stream(version=2), source_port=40001)])
            bundles = extractor.extract_sessions(source)
            with patch.object(extractor, '_check_private_directory'):
                paths = extractor.export_sessions(bundles, destination)
                self.assertEqual(len(paths), 2)
                self.assertTrue(all(path.name.startswith('session-') and path.suffix == '.json' for path in paths))
                from Killboard.session_bundle import load_session
                self.assertEqual([load_session(path) for path in paths], bundles)
                with self.assertRaises(extractor.CaptureError):
                    extractor.export_sessions(bundles, destination)
                with self.assertRaises(extractor.CaptureError):
                    extractor.export_sessions([bundles[0], bundles[0]], destination)

    def test_export_cli_logs_only_count_and_sanitizes_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'private-account.pcap'
            destination = Path(directory) / 'private'
            destination.mkdir(mode=0o700)
            capture(source, [packet(stream())])
            output, errors = io.StringIO(), io.StringIO()
            with patch.object(extractor, '_check_private_directory', create=True), redirect_stdout(output), redirect_stderr(errors):
                status = extractor.main(['--capture', str(source), '--private-export-dir', str(destination)])
            self.assertEqual(status, 0)
            self.assertIn('1', output.getvalue())
            self.assertNotIn('synthetic-private-token', output.getvalue() + errors.getvalue())
            self.assertNotIn(str(source), output.getvalue() + errors.getvalue())

    def test_private_directory_rejects_symlink_and_posix_nonowner_or_public_mode(self):
        self.assertTrue(hasattr(extractor, '_check_private_directory'), 'private directory checks are missing')
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory)
            with patch.object(Path, 'is_symlink', return_value=True):
                with self.assertRaises(extractor.CaptureError):
                    extractor._check_private_directory(Path(directory))
            with patch.object(extractor, 'Path', type(destination)), patch.object(extractor.os, 'name', 'posix'), patch.object(extractor.os, 'geteuid', return_value=1000, create=True):
                for mode, owner in ((0o755, 1000), (0o700, 1001)):
                    with patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=owner)):
                        with self.assertRaises(extractor.CaptureError):
                            extractor._check_private_directory(destination)

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL subprocess behavior')
    def test_windows_acl_probe_does_not_inherit_an_incompatible_powershell_module_path(self):
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as directory:
            checked = SimpleNamespace(returncode=0, stdout=b'private\r\n', stderr=b'')
            with patch.dict(os.environ, {'PSModulePath': 'synthetic-incompatible-path'}):
                with patch.object(extractor.subprocess, 'run', return_value=checked) as run:
                    extractor._check_private_directory(Path(directory))
            self.assertIn('env', run.call_args.kwargs)
            self.assertFalse(any(key.lower() == 'psmodulepath' for key in run.call_args.kwargs['env']))

    def test_bounded_resync_finds_hello_after_non_protocol_prefix(self):
        self.assertEqual(len(self.extract([packet(b'noise' + stream())])['templates']), 5)

    def test_truncated_or_unsupported_capture_is_rejected_without_path_leak(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'private-synthetic.pcap'
            source.write_bytes(b'not a capture')
            with self.assertRaises(extractor.CaptureError) as raised:
                extractor.extract_session(source)
            self.assertNotIn(str(source), str(raised.exception))
            capture(source, [packet(stream())], linktype=999)
            with self.assertRaises(extractor.CaptureError):
                extractor.extract_session(source)
            capture(source, [packet(stream())])
            source.write_bytes(source.read_bytes()[:-1])
            with self.assertRaises(extractor.CaptureError):
                extractor.extract_session(source)

    def test_record_and_capture_size_budgets_are_enforced(self):
        with patch.object(extractor, 'MAX_RECORDS', 1):
            with self.assertRaises(extractor.CaptureError):
                self.extract([packet(stream()), packet(stream(), source_port=40001)])
        with patch.object(extractor, 'MAX_CAPTURE_BYTES', 16):
            with self.assertRaises(extractor.CaptureError):
                self.extract([packet(stream())])


if __name__ == '__main__':
    unittest.main()
