"""Synthetic-only tests for Windows DPAPI escrow of a remote MySQL backup."""

import hashlib
import importlib.util
import io
import os
from pathlib import Path, PureWindowsPath
import subprocess
import tempfile
import threading
import time
import unittest
from contextlib import redirect_stderr, redirect_stdout
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'market_backup_offhost_encrypt.py'
spec = importlib.util.spec_from_file_location('market_backup_encrypt_under_test', SCRIPT)
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class TransferValidationTests(unittest.TestCase):
    VALID_DUMP = ('/EVEMTK/deploy-backups/market-pre-20260924-123456/'
                  'default-before-market.sql')

    def test_remote_dump_path_must_match_exact_backup_allowlist(self):
        self.assertEqual(backup.validate_remote_dump(self.VALID_DUMP), self.VALID_DUMP)
        for invalid in (
            '/EVEMTK/deploy-backups/other/default-before-market.sql',
            '/EVEMTK/deploy-backups/market-pre-20260924-123456/../../eve_echoes.sql',
            self.VALID_DUMP + ';id',
            self.VALID_DUMP.replace('default-before-market.sql', 'backup.json'),
            '-oProxyCommand=sh',
        ):
            with self.subTest(invalid=invalid), self.assertRaises(backup.TransferError):
                backup.validate_remote_dump(invalid)

    def test_expected_size_and_sha_are_required_and_bounded(self):
        digest = hashlib.sha256(b'synthetic dump').hexdigest()
        self.assertEqual(backup.validate_expected(14, digest), (14, digest))
        for size, checksum in (
            (0, digest), (64 * 1024 * 1024 + 1, digest),
            (True, digest), (14, 'x' * 64), (14, digest + '0'),
        ):
            with self.subTest(size=size, checksum=checksum), self.assertRaises(backup.TransferError):
                backup.validate_expected(size, checksum)

    @unittest.skipUnless(os.name == 'nt', 'Windows local key validation only')
    def test_identity_is_exact_profile_key_and_is_never_opened(self):
        with tempfile.TemporaryDirectory() as temporary:
            profile = Path(temporary)
            ssh_dir = profile / '.ssh'
            ssh_dir.mkdir()
            identity = ssh_dir / 'evem_cloud_admin'
            identity.write_bytes(b'synthetic-key-placeholder')
            with patch.object(Path, 'open', side_effect=AssertionError('key was opened')):
                self.assertEqual(
                    backup.validate_identity_file(identity, user_profile=profile), identity,
                )
            for rejected in (ssh_dir / 'other_key', profile / 'evem_cloud_admin'):
                with self.subTest(rejected=rejected), self.assertRaises(backup.TransferError):
                    backup.validate_identity_file(rejected, user_profile=profile)


class FakeSsh:
    def __init__(self, case, payload, exit_code=0):
        self.case = case
        self.payload = payload
        self.exit_code = exit_code
        self.calls = []
        self.killed = False
        self.stdout = io.BytesIO(payload)

    def __call__(self, args, *, stdin, stdout, stderr, env):
        self.calls.append(args)
        executable = PureWindowsPath(args[0])
        self.case.assertTrue(executable.is_absolute(), 'SSH executable used PATH or CWD')
        self.case.assertEqual(executable.name.lower(), 'ssh.exe')
        self.case.assertEqual(executable.parent.name.lower(), 'openssh')
        self.case.assertEqual(executable.parent.parent.name.lower(), 'system32')
        self.case.assertIn('root@8.134.144.49', args)
        self.case.assertIn('BatchMode=yes', args)
        self.case.assertIn('StrictHostKeyChecking=yes', args)
        self.case.assertIn('IdentitiesOnly=yes', args)
        self.case.assertEqual(args[args.index('-F') + 1], 'none')
        self.case.assertIn('-i', args)
        self.case.assertEqual(args[args.index('-i') + 1], str(self.case.IDENTITY))
        self.case.assertEqual(stdin, subprocess.DEVNULL)
        self.case.assertEqual(stdout, subprocess.PIPE)
        self.case.assertEqual(stderr, subprocess.DEVNULL)
        self.case.assertNotIn('PATH', env, 'SSH child inherited executable search path')
        self.case.assertEqual(env.get('PROGRAMDATA'), os.environ.get('PROGRAMDATA'),
                              'Windows OpenSSH needs ProgramData to load its host configuration')
        self.case.assertFalse('PROVIDER_API_KEY' in env, 'provider secret reached SSH')
        self.case.assertFalse('EVEM_REHEARSAL_DB_PASSWORD' in env,
                              'database password reached SSH')
        return self

    def wait(self, timeout=None):
        return self.exit_code

    def kill(self):
        self.killed = True


class HangingStdout:
    """Synthetic pipe that never returns until the process is killed."""

    def __init__(self):
        self.released = threading.Event()
        self.closed = False

    def read(self, size):
        self.released.wait()
        return b''

    def close(self):
        self.closed = True
        self.released.set()


class UnstoppableStdout:
    """Synthetic pipe whose read and close both block until the test releases them."""

    def __init__(self):
        self.released = threading.Event()
        self.close_called = False

    def read(self, size):
        self.released.wait()
        return b''

    def close(self):
        self.close_called = True
        self.released.wait()


class FetchBackupTests(TransferValidationTests):
    IDENTITY = Path('C:/synthetic-profile/.ssh/evem_cloud_admin')

    def setUp(self):
        super().setUp()
        # Stream tests exercise the protocol/timeout path on Linux CI too;
        # resolving the Windows installation is a separate platform check.
        resolver = patch.object(backup, '_system_ssh_executable',
                                return_value=Path('C:/Windows/System32/OpenSSH/ssh.exe'))
        resolver.start()
        self.addCleanup(resolver.stop)

    def test_fetch_streams_authenticated_ssh_stdout_into_memory(self):
        payload = b'-- synthetic only\nCREATE TABLE `x` (`id` int);\n'
        fake = FakeSsh(self, payload)
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY), patch.dict(os.environ, {
            'PROVIDER_API_KEY': 'synthetic-provider-secret',
            'EVEM_REHEARSAL_DB_PASSWORD': 'synthetic-db-secret',
        }):
            actual = backup.fetch_backup(
                self.VALID_DUMP, len(payload), hashlib.sha256(payload).hexdigest(),
                self.IDENTITY, popen=fake,
            )
        self.assertEqual(actual, payload)
        self.assertEqual(len(fake.calls), 1)
        self.assertIn(self.VALID_DUMP, fake.calls[0][-1])
        self.assertTrue(fake.stdout.closed)

    def test_hash_mismatch_and_oversize_abort_without_file_output(self):
        payload = b'synthetic dump data'
        fake = FakeSsh(self, payload)
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY):
            with self.assertRaises(backup.TransferError):
                backup.fetch_backup(self.VALID_DUMP, len(payload), '0' * 64,
                                    self.IDENTITY, popen=fake)
        self.assertTrue(fake.killed)
        fake = FakeSsh(self, payload + b'x')
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY):
            with self.assertRaises(backup.TransferError):
                backup.fetch_backup(
                    self.VALID_DUMP, len(payload), hashlib.sha256(payload).hexdigest(),
                    self.IDENTITY, popen=fake,
                )
        self.assertTrue(fake.killed)

    def test_failed_ssh_exit_rejects_even_matching_stdout(self):
        payload = b'synthetic dump data'
        fake = FakeSsh(self, payload, exit_code=255)
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY):
            with self.assertRaises(backup.TransferError):
                backup.fetch_backup(
                    self.VALID_DUMP, len(payload), hashlib.sha256(payload).hexdigest(),
                    self.IDENTITY, popen=fake,
                )

    def test_hung_stdout_hits_wall_clock_deadline_and_kills_and_closes(self):
        payload = b'synthetic only'
        fake = FakeSsh(self, payload)
        fake.stdout = HangingStdout()
        original_kill = fake.kill

        def release_on_kill():
            original_kill()
            fake.stdout.released.set()

        fake.kill = release_on_kill
        result = []

        def run_fetch():
            try:
                with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY), \
                        patch.object(backup, 'SSH_TRANSFER_TIMEOUT_SECONDS', 0.05, create=True):
                    backup.fetch_backup(self.VALID_DUMP, len(payload),
                                        hashlib.sha256(payload).hexdigest(),
                                        self.IDENTITY, popen=fake)
            except backup.TransferError as error:
                result.append(str(error))

        worker = threading.Thread(target=run_fetch, daemon=True)
        started = time.monotonic()
        worker.start()
        worker.join(timeout=0.5)
        if worker.is_alive():
            fake.kill()  # Test-only release so the old implementation cannot hang the suite.
            worker.join(timeout=1)
            self.fail('Hung stdout was not bounded by the SSH wall-clock deadline.')
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertTrue(fake.killed)
        self.assertTrue(fake.stdout.closed)
        self.assertEqual(len(result), 1)
        self.assertNotIn(payload.decode(), result[0])

    def test_failed_kill_and_stuck_reader_never_block_on_synchronous_close(self):
        payload = b'synthetic only'
        fake = FakeSsh(self, payload)
        fake.stdout = UnstoppableStdout()

        def failed_kill():
            fake.killed = True
            raise OSError('synthetic kill failure')

        fake.kill = failed_kill
        result = []

        def run_fetch():
            try:
                with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY), \
                        patch.object(backup, 'SSH_TRANSFER_TIMEOUT_SECONDS', 0.05), \
                        patch.object(backup, 'SSH_READER_JOIN_TIMEOUT_SECONDS', 0.05,
                                     create=True):
                    backup.fetch_backup(self.VALID_DUMP, len(payload),
                                        hashlib.sha256(payload).hexdigest(),
                                        self.IDENTITY, popen=fake)
            except backup.TransferError as error:
                result.append(str(error))

        worker = threading.Thread(target=run_fetch, daemon=True)
        worker.start()
        worker.join(timeout=0.4)
        still_blocked = worker.is_alive()
        fake.stdout.released.set()  # Always release synthetic threads after observation.
        worker.join(timeout=3)
        self.assertFalse(still_blocked, 'Cleanup blocked on a live reader or its close lock.')
        self.assertTrue(fake.killed)
        self.assertFalse(fake.stdout.close_called)
        self.assertEqual(len(result), 1)
        self.assertNotIn(payload.decode(), result[0])


@unittest.skipUnless(os.name == 'nt', 'Windows DPAPI only')
class WindowsEncryptionTests(unittest.TestCase):
    def test_current_user_dpapi_round_trip_keeps_plaintext_out_of_ciphertext(self):
        plaintext = b'synthetic-only-MySQL-dump\n' * 200
        ciphertext = backup.protect_current_user(plaintext)
        self.assertNotIn(plaintext[:32], ciphertext)
        self.assertEqual(backup.unprotect_current_user(ciphertext), plaintext)


@unittest.skipUnless(os.name == 'nt', 'Windows private file escrow only')
class WindowsEscrowTests(unittest.TestCase):
    VALID_DUMP = TransferValidationTests.VALID_DUMP
    IDENTITY = FetchBackupTests.IDENTITY

    def setUp(self):
        private_root = Path(os.environ['LOCALAPPDATA'])
        self.temporary = tempfile.TemporaryDirectory(dir=private_root)
        self.addCleanup(self.temporary.cleanup)
        self.output = Path(self.temporary.name) / 'synthetic-backup.dpapi'
        self.payload = b'-- synthetic only\nCREATE TABLE `x` (`id` int);\n'
        self.digest = hashlib.sha256(self.payload).hexdigest()

    def _transfer(self, fake):
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY):
            return backup.transfer_backup(
                self.VALID_DUMP, len(self.payload), self.digest,
                self.IDENTITY, self.output, popen=fake,
            )

    def test_transfer_creates_owner_only_dpapi_file_and_verifies_readback(self):
        from backend.Market.tests.test_session_export import file_security_sddl

        fake = FakeSsh(self, self.payload)
        self._transfer(fake)
        stored = self.output.read_bytes()
        self.assertTrue(stored.startswith(backup.FILE_MAGIC))
        self.assertNotIn(self.payload, stored)
        self.assertEqual(
            backup.unprotect_current_user(stored[len(backup.FILE_MAGIC):]), self.payload,
        )
        sddl = file_security_sddl(self.output)
        self.assertIn('D:P', sddl)
        self.assertIn(f'(A;;FA;;;{backup._current_user_sid()})', sddl)
        self.assertEqual(sddl.count('(A;'), 1)

    def test_existing_output_is_not_overwritten_or_fetched(self):
        self.output.write_bytes(b'synthetic existing sentinel')
        fake = FakeSsh(self, self.payload)
        with self.assertRaises(backup.TransferError):
            self._transfer(fake)
        self.assertEqual(self.output.read_bytes(), b'synthetic existing sentinel')
        self.assertEqual(fake.calls, [])

    def test_hash_mismatch_never_creates_output(self):
        fake = FakeSsh(self, self.payload + b'altered')
        with self.assertRaises(backup.TransferError):
            self._transfer(fake)
        self.assertFalse(self.output.exists())

    def test_output_must_be_inside_current_user_localappdata(self):
        fake = FakeSsh(self, self.payload)
        unsafe = Path(self.temporary.name).anchor + 'outside-market-backup.dpapi'
        with patch.object(backup, 'validate_identity_file', return_value=self.IDENTITY):
            with self.assertRaises(backup.TransferError):
                backup.transfer_backup(
                    self.VALID_DUMP, len(self.payload), self.digest,
                    self.IDENTITY, Path(unsafe), popen=fake,
                )
        self.assertEqual(fake.calls, [])

    def test_failed_readback_removes_only_new_encrypted_output(self):
        fake = FakeSsh(self, self.payload)
        with patch.object(backup, 'unprotect_current_user', return_value=b'incorrect'):
            with self.assertRaises(backup.TransferError):
                self._transfer(fake)
        self.assertFalse(self.output.exists())


class CliTests(unittest.TestCase):
    def test_cli_reports_only_static_status_without_paths_or_credentials(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with patch.object(backup, 'transfer_backup', return_value=None), \
                redirect_stdout(stdout), redirect_stderr(stderr):
            status = backup.main([
                '--remote-dump', TransferValidationTests.VALID_DUMP,
                '--expected-size', '123', '--expected-sha256', '0' * 64,
                '--identity-file', 'C:/synthetic/private-key',
                '--output', 'C:/synthetic/private-backup.dpapi',
            ])
        self.assertEqual(status, 0)
        self.assertIn('same Windows user profile', stdout.getvalue())
        self.assertNotIn('C:/synthetic', stdout.getvalue() + stderr.getvalue())
        self.assertNotIn('CREATE TABLE', stdout.getvalue() + stderr.getvalue())

    def test_invalid_cli_arguments_do_not_echo_untrusted_input(self):
        stdout, stderr = io.StringIO(), io.StringIO()
        with redirect_stdout(stdout), redirect_stderr(stderr):
            status = backup.main(['--remote-dump', 'synthetic-secret-marker'])
        self.assertEqual(status, 1)
        self.assertEqual(stdout.getvalue(), '')
        self.assertNotIn('synthetic-secret-marker', stderr.getvalue())


if __name__ == '__main__':
    unittest.main()
