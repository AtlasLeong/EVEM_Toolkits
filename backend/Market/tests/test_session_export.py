"""Only synthetic data is used by the Windows session export tests."""

import ctypes
from ctypes import wintypes
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import os
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import msgpack


METHODS = (
    'login_sigma', 'request_start_wait', 'get_newbie_info',
    'select_character_id', 'get_super_orders',
)


def synthetic_bundle():
    templates = {}
    for method in METHODS:
        call = msgpack.ExtType(10, msgpack.packb([method, [10000000001, 8]], use_bin_type=True))
        templates[method] = {
            'content': msgpack.packb([1, [0, 41, 9], [0, 0, 2], [call]], use_bin_type=True),
            'flag': 0,
        }
    return {
        'endpoint': ['192.0.2.10', 12345],
        'hello': {'token': '', 'synthetic': b'not-an-account'},
        'templates': templates,
    }


def protect_synthetic(plaintext):
    """Create a DPAPI fixture in memory, never from a captured session."""
    class Blob(ctypes.Structure):
        _fields_ = [('cbData', wintypes.DWORD), ('pbData', ctypes.POINTER(ctypes.c_ubyte))]

    crypt32 = ctypes.WinDLL('crypt32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    crypt32.CryptProtectData.argtypes = [
        ctypes.POINTER(Blob), wintypes.LPCWSTR, ctypes.POINTER(Blob), ctypes.c_void_p,
        ctypes.c_void_p, wintypes.DWORD, ctypes.POINTER(Blob),
    ]
    crypt32.CryptProtectData.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    source = ctypes.create_string_buffer(plaintext)
    input_blob = Blob(len(plaintext), ctypes.cast(source, ctypes.POINTER(ctypes.c_ubyte)))
    output_blob = Blob()
    if not crypt32.CryptProtectData(
        ctypes.byref(input_blob), 'synthetic test only', None, None, None, 1,
        ctypes.byref(output_blob),
    ):
        raise AssertionError('Could not create synthetic DPAPI fixture')
    try:
        return ctypes.string_at(output_blob.pbData, output_blob.cbData)
    finally:
        kernel32.LocalFree(ctypes.cast(output_blob.pbData, ctypes.c_void_p))


def file_security_sddl(path):
    """Inspect the synthetic file ACL with Win32, independent of the exporter."""
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    advapi32.GetFileSecurityW.argtypes = [
        wintypes.LPCWSTR, wintypes.DWORD, ctypes.c_void_p, wintypes.DWORD,
        ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.GetFileSecurityW.restype = wintypes.BOOL
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.argtypes = [
        ctypes.c_void_p, wintypes.DWORD, wintypes.DWORD,
        ctypes.POINTER(ctypes.c_wchar_p), ctypes.POINTER(wintypes.DWORD),
    ]
    advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    needed = wintypes.DWORD()
    advapi32.GetFileSecurityW(str(path), 5, None, 0, ctypes.byref(needed))
    if not needed.value:
        raise AssertionError('Could not size synthetic file security descriptor')
    descriptor = ctypes.create_string_buffer(needed.value)
    if not advapi32.GetFileSecurityW(str(path), 5, descriptor, needed, ctypes.byref(needed)):
        raise AssertionError('Could not inspect synthetic file security descriptor')
    sddl = ctypes.c_wchar_p()
    if not advapi32.ConvertSecurityDescriptorToStringSecurityDescriptorW(
        descriptor, 1, 5, ctypes.byref(sddl), None,
    ):
        raise AssertionError('Could not format synthetic file security descriptor')
    try:
        return sddl.value
    finally:
        kernel32.LocalFree(ctypes.cast(sddl, ctypes.c_void_p))


class SessionExportTests(unittest.TestCase):
    def setUp(self):
        try:
            script = Path(__file__).resolve().parents[3] / 'scripts' / 'market' / 'export_session_bundle.py'
            spec = importlib.util.spec_from_file_location('market_session_export_under_test', script)
            if spec is None or spec.loader is None:
                raise FileNotFoundError()
            self.exporter = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.exporter)
        except (FileNotFoundError, ModuleNotFoundError):
            self.fail('Market session exporter is missing')

    def test_decodes_synthetic_collector_format_to_portable_json(self):
        from Market.session_bundle import decode_session

        bundle = synthetic_bundle()
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            source.write_bytes(b'EVEMDP1\0' + b'not-real-ciphertext')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(bundle, use_bin_type=True)):
                portable = self.exporter.decode_collector_source(source)
        self.assertEqual(decode_session(portable), bundle)

    def test_invalid_magic_or_oversized_source_never_reaches_dpapi(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            for contents in (b'BADMAGIC-not-ciphertext', b'x' * (4 * 1024 * 1024 + 1)):
                with self.subTest(size=len(contents)):
                    source.write_bytes(contents)
                    with patch.object(self.exporter, '_unprotect') as decrypt:
                        with self.assertRaises(self.exporter.ExportError):
                            self.exporter.decode_collector_source(source)
                        decrypt.assert_not_called()

    def test_source_replacement_between_lstat_and_open_never_reaches_dpapi(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            actual = source.lstat()
            replaced = SimpleNamespace(
                st_mode=actual.st_mode, st_size=actual.st_size,
                st_dev=actual.st_dev, st_ino=actual.st_ino + 1,
            )
            with patch.object(Path, 'lstat', return_value=replaced):
                with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)) as decrypt:
                    with self.assertRaises(self.exporter.ExportError):
                        self.exporter.decode_collector_source(source)
                    decrypt.assert_not_called()

    def test_invalid_template_fails_with_no_secret_or_path_in_error(self):
        candidate = synthetic_bundle()
        del candidate['templates']['login_sigma']
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic-sensitive-name.dpapi'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(candidate, use_bin_type=True)):
                with self.assertRaises(self.exporter.ExportError) as caught:
                    self.exporter.decode_collector_source(source)
        self.assertNotIn('synthetic-sensitive-name', str(caught.exception))
        self.assertNotIn('not-an-account', str(caught.exception))

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI only')
    def test_unprotect_round_trips_only_synthetic_dpapi_material(self):
        plaintext = b'synthetic-DPAPI-payload-only'
        encrypted = protect_synthetic(plaintext)
        self.assertNotIn(plaintext, encrypted)
        try:
            recovered = self.exporter._unprotect(encrypted)
        except self.exporter.ExportError:
            self.fail('Synthetic Windows DPAPI fixture was not decrypted')
        self.assertEqual(recovered, plaintext)

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL creation only')
    def test_export_creates_a_new_portable_file(self):
        from Market.session_bundle import decode_session

        bundle = synthetic_bundle()
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            output = Path(temporary) / 'portable.json'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            self.assertTrue(hasattr(self.exporter, 'export_session'))
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(bundle, use_bin_type=True)):
                self.exporter.export_session(source, output)
            self.assertEqual(decode_session(output.read_bytes()), bundle)

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL creation only')
    def test_export_never_overwrites_existing_output(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            output = Path(temporary) / 'portable.json'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            output.write_bytes(b'existing-data-stays')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                with self.assertRaises(self.exporter.ExportError):
                    self.exporter.export_session(source, output)
            self.assertEqual(output.read_bytes(), b'existing-data-stays')

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL creation only')
    def test_write_failure_removes_only_the_new_synthetic_output(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            output = Path(temporary) / 'portable.json'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                with patch.object(self.exporter.os, 'fsync', side_effect=OSError('synthetic failure')):
                    with self.assertRaises(self.exporter.ExportError):
                        self.exporter.export_session(source, output)
            self.assertFalse(output.exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows ACL creation only')
    def test_synthetic_output_has_one_protected_owner_only_ace(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            output = Path(temporary) / 'portable.json'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                self.exporter.export_session(source, output)
            security = file_security_sddl(output)
            self.assertIn('O:' + self.exporter._current_user_sid(), security)
            dacl = security.split('D:', 1)[1].split('S:', 1)[0]
            self.assertTrue(dacl.startswith('P('), dacl)
            self.assertEqual(dacl.count('('), 1, dacl)
            self.assertIn(self.exporter._current_user_sid(), dacl)

    @unittest.skipUnless(os.name == 'nt', 'Windows export CLI only')
    def test_cli_success_and_failure_never_print_paths_or_bundle_content(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic-sensitive-source.dpapi'
            output = Path(temporary) / 'synthetic-sensitive-output.json'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            stdout, stderr = io.StringIO(), io.StringIO()
            self.assertTrue(hasattr(self.exporter, 'main'))
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                with redirect_stdout(stdout), redirect_stderr(stderr):
                    code = self.exporter.main(['--source', str(source), '--output', str(output)])
            self.assertEqual(code, 0)
            self.assertTrue(output.is_file())
            output.unlink()
            source.write_bytes(b'invalid-sensitive-ciphertext')
            with redirect_stdout(stdout), redirect_stderr(stderr):
                code = self.exporter.main(['--source', str(source), '--output', str(output)])
            self.assertNotEqual(code, 0)
            self.assertFalse(output.exists())
            text = stdout.getvalue() + stderr.getvalue()
            for forbidden in ('synthetic-sensitive-source', 'synthetic-sensitive-output',
                              'not-an-account', 'invalid-sensitive-ciphertext'):
                self.assertNotIn(forbidden, text)

    @unittest.skipUnless(os.name == 'nt', 'Windows path rules only')
    def test_rejects_alternate_data_stream_destination_before_create(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            output = Path(temporary) / 'other-file.txt:portable.json'
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                with patch.object(self.exporter, '_create_owner_only_file') as create:
                    with self.assertRaises(self.exporter.ExportError):
                        self.exporter.export_session(source, output)
                    create.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows path rules only')
    def test_rejects_reserved_device_or_normalized_destination_names(self):
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            source.write_bytes(b'EVEMDP1\0not-real-ciphertext')
            with patch.object(self.exporter, '_unprotect', return_value=msgpack.packb(synthetic_bundle(), use_bin_type=True)):
                for filename in ('PRN.txt', 'CON', 'LPT1.json', 'report.', 'report '):
                    with self.subTest(filename=filename):
                        with patch.object(self.exporter, '_create_owner_only_file') as create:
                            with self.assertRaises(self.exporter.ExportError):
                                self.exporter.export_session(source, Path(temporary) / filename)
                            create.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows DPAPI/ACL export only')
    def test_synthetic_dpapi_file_exports_end_to_end_without_stubs(self):
        from Market.session_bundle import decode_session

        bundle = synthetic_bundle()
        encrypted = protect_synthetic(msgpack.packb(bundle, use_bin_type=True))
        with TemporaryDirectory() as temporary:
            source = Path(temporary) / 'synthetic.dpapi'
            output = Path(temporary) / 'portable.json'
            source.write_bytes(b'EVEMDP1\0' + encrypted)
            self.exporter.export_session(source, output)
            self.assertEqual(decode_session(output.read_bytes()), bundle)

    def test_cli_help_and_bad_arguments_do_not_echo_input(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            with self.assertRaises(SystemExit) as caught:
                self.exporter.main(['--help'])
            bad_code = self.exporter.main(['--source', 'private-source-marker', '--bad', 'private-output-marker'])
        self.assertEqual(caught.exception.code, 0)
        self.assertNotEqual(bad_code, 0)
        self.assertIn('--source', stdout.getvalue())
        self.assertIn('--output', stdout.getvalue())
        for forbidden in ('private-source-marker', 'private-output-marker'):
            self.assertNotIn(forbidden, stdout.getvalue() + stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
