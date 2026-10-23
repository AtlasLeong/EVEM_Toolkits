"""Offline contracts for the narrowly scoped, operator-only gzip activation."""
from contextlib import ExitStack, nullcontext
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'public_gzip.py'
ASSETS = '''    location /assets/ {
        alias /EVEMTK/deploy/shared/assets/;
        add_header Cache-Control "public, max-age=31536000, immutable";
    }
'''
PREFIX = '''server {
    listen 443 ssl http2;
    ssl_certificate /public/certificate.pem;
    ssl_certificate_key /private/certificate.key;
    root /EVEMTK/deploy/current/frontend;
    location / {
        try_files $uri $uri/ /index.html;
        add_header Cache-Control "no-cache" always;
    }
'''
SUFFIX = '''    # Private feedback attachments: unchanged.
    location /api/feedback/ { proxy_pass http://127.0.0.1:8000; }
    location ^~ /ws/tactical/ { proxy_pass http://127.0.0.1:8001; }
    location /api/ { proxy_pass http://127.0.0.1:8000; }
    location /admin/ { proxy_pass http://127.0.0.1:8000; }
    location /static/uploads/ { alias /private/uploads/; }
}
'''
SITE = (PREFIX + ASSETS + SUFFIX).encode()
MAIN = b'http { include /etc/nginx/conf.d/*.conf; }\n'


def digest(data):
    return hashlib.sha256(data).hexdigest()


class PublicGzipTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.is_file(), 'public-only gzip helper is not implemented')
        spec = importlib.util.spec_from_file_location('public_gzip', SCRIPT)
        self.helper = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.helper)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.site = self.root / 'evemtk.conf'
        self.main = self.root / 'nginx.conf'
        self.backups = self.root / 'backups'
        self.site.write_bytes(SITE)
        self.main.write_bytes(MAIN)
        self.site.chmod(0o644)
        self.main.chmod(0o644)
        self.commands = []

    def scope(self):
        stack = ExitStack()
        stack.enter_context(patch.object(self.helper, 'NGINX_SITE', self.site))
        stack.enter_context(patch.object(self.helper, 'NGINX_MAIN', self.main))
        stack.enter_context(patch.object(self.helper, 'BACKUP_ROOT', self.backups))
        stack.enter_context(patch.object(self.helper, '_require_root'))
        stack.enter_context(patch.object(self.helper, '_release_guard', return_value=nullcontext()))
        # Real file reads/replacements are retained. Only privileged host policy
        # is isolated; metadata refusal is independently checked below.
        stack.enter_context(patch.object(self.helper, '_validate_metadata'))
        stack.enter_context(patch.object(self.helper, '_check_trusted_directory'))
        stack.enter_context(patch.object(self.helper, '_check_private_directory'))
        return stack

    def run_command(self, *command):
        self.commands.append((command, self.site.read_bytes()))

    def activate(self, runner=None, verify=None):
        with self.scope():
            return self.helper.apply(digest(SITE), digest(MAIN),
                                     runner=runner or self.run_command,
                                     verify=verify or (lambda: None))

    def test_preparation_changes_only_the_two_public_locations(self):
        candidate = self.helper.prepare(SITE)
        self.assertTrue(candidate.startswith(PREFIX.encode()))
        self.assertTrue(candidate.endswith(SUFFIX.encode()))
        text = candidate.decode()
        self.assertEqual(text.count('gzip on;'), 2)
        self.assertEqual(text.count('gzip_min_length 1024;'), 2)
        self.assertEqual(text.count('gzip_comp_level 5;'), 2)
        self.assertEqual(text.count('gzip_vary on;'), 2)
        self.assertEqual(text.count('gzip_types text/css application/javascript text/javascript application/json;'), 2)
        self.assertIn('location = /industry/manufacturing-scope.json {\n        try_files $uri =404;', text)
        self.assertIn('add_header Cache-Control "no-cache" always;', text)
        self.assertEqual(text.count('add_header Cache-Control "public, max-age=31536000, immutable";'), 1)

    def test_refuses_ambiguous_or_already_changed_layouts(self):
        variants = [
            SITE.replace(ASSETS.encode(), b''),
            SITE + ASSETS.encode(),
            SITE.replace(b'alias /EVEMTK/deploy/shared/assets/;', b'alias /another/path/;'),
            SITE.replace(b'location /assets/', b'location ^~ /assets/'),
            SITE + b'location = /industry/manufacturing-scope.json {}\n',
            SITE + b'gzip on;\n',
            SITE.replace(b'root /EVEMTK/deploy/current/frontend;', b'root /another/path;'),
        ]
        for source in variants:
            with self.subTest(source_hash=digest(source)):
                with self.assertRaises(self.helper.PublicGzipError):
                    self.helper.prepare(source)
        with self.assertRaises(self.helper.PublicGzipError):
            self.helper.prepare(self.helper.prepare(SITE))

    def test_default_cli_is_read_only_and_prints_only_a_receipt(self):
        output = io.StringIO()
        with self.scope(), patch('sys.stdout', output), patch.object(self.helper, 'apply') as apply:
            self.assertEqual(self.helper.main([]), 0)
        apply.assert_not_called()
        receipt = json.loads(output.getvalue())
        self.assertEqual(receipt['status'], 'dry_run')
        self.assertEqual(receipt['site_sha_before'], digest(SITE))
        self.assertEqual(receipt['main_sha'], digest(MAIN))
        self.assertNotIn('ssl_certificate', output.getvalue())
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.main.read_bytes(), MAIN)

    def test_apply_requires_both_expected_digests(self):
        for arguments in (['--apply'], ['--apply', '--expected-site-sha', digest(SITE)]):
            with self.scope(), patch('sys.stdout', io.StringIO()), patch.object(self.helper, 'apply') as apply:
                self.assertEqual(self.helper.main(arguments), 1)
            apply.assert_not_called()

    def test_mismatched_digest_refuses_before_backup_or_commands(self):
        with self.scope(), self.assertRaises(self.helper.PublicGzipError):
            self.helper.apply('f' * 64, digest(MAIN), runner=self.run_command)
        self.assertEqual(self.commands, [])
        self.assertFalse(self.backups.exists())
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_success_keeps_main_and_unrelated_files_exact_and_backup_private(self):
        unrelated = self.root / 'private-material.json'
        unrelated.write_bytes(b'do not touch')
        receipt = self.activate()
        self.assertEqual(receipt['status'], 'applied')
        self.assertEqual(self.site.read_bytes(), self.helper.prepare(SITE))
        self.assertEqual(self.main.read_bytes(), MAIN)
        self.assertEqual(unrelated.read_bytes(), b'do not touch')
        backup = Path(receipt['backup'])
        self.assertEqual((backup / 'evemtk.conf').read_bytes(), SITE)
        self.assertEqual(receipt['site_sha_after'], digest(self.helper.prepare(SITE)))
        self.assertEqual([entry[0] for entry in self.commands], [
            ('nginx', '-t'), ('systemctl', 'reload', 'nginx'), ('systemctl', 'is-active', '--quiet', 'nginx')])
        if os.name == 'posix':
            self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((backup / 'evemtk.conf').stat().st_mode), 0o600)
            self.assertEqual(stat.S_IMODE(self.site.stat().st_mode), 0o644)

    def test_repeated_apply_does_not_create_or_overwrite_backup(self):
        receipt = self.activate()
        before = {p: p.read_bytes() for p in Path(receipt['backup']).iterdir() if p.is_file()}
        command_count = len(self.commands)
        with self.assertRaises(self.helper.PublicGzipError):
            self.activate()
        self.assertEqual(len(self.commands), command_count)
        self.assertEqual(len(list(self.backups.iterdir())), 1)
        for path, data in before.items():
            self.assertEqual(path.read_bytes(), data)

    def test_validation_failure_restores_before_old_validation_and_reload(self):
        def runner(*command):
            self.run_command(*command)
            if len(self.commands) == 1:
                raise RuntimeError('new nginx syntax rejected')
        with self.assertRaisesRegex(self.helper.PublicGzipError, 'restored'):
            self.activate(runner=runner)
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.main.read_bytes(), MAIN)
        self.assertEqual([entry[0] for entry in self.commands], [
            ('nginx', '-t'), ('nginx', '-t'), ('systemctl', 'reload', 'nginx'),
            ('systemctl', 'is-active', '--quiet', 'nginx')])
        self.assertTrue(all(data == SITE for _, data in self.commands[1:]))

    def test_reload_failure_restores_exact_original(self):
        def runner(*command):
            self.run_command(*command)
            if len(self.commands) == 2:
                raise RuntimeError('reload rejected')
        with self.assertRaisesRegex(self.helper.PublicGzipError, 'restored'):
            self.activate(runner=runner)
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertTrue(all(data == SITE for _, data in self.commands[2:]))

    def test_failed_health_callback_rolls_back_without_exposing_exception(self):
        def failed_health():
            raise RuntimeError('PRIVATE BODY MUST NOT BE PRINTED')
        with self.assertRaises(self.helper.PublicGzipError) as caught:
            self.activate(verify=failed_health)
        self.assertIn('restored', str(caught.exception))
        self.assertNotIn('PRIVATE', str(caught.exception))
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_interrupt_restores_original(self):
        with self.assertRaisesRegex(self.helper.PublicGzipError, 'restored'):
            self.activate(verify=lambda: (_ for _ in ()).throw(KeyboardInterrupt()))
        self.assertEqual(self.site.read_bytes(), SITE)

    def test_failed_recovery_is_distinguished_and_preserves_backup(self):
        def runner(*command):
            self.run_command(*command)
            raise RuntimeError('nginx unavailable')
        with self.assertRaises(self.helper.RollbackError) as caught:
            self.activate(runner=runner)
        self.assertNotIn('restored', str(caught.exception))
        self.assertEqual((Path(caught.exception.backup) / 'evemtk.conf').read_bytes(), SITE)

    def test_metadata_refuses_symlinks_nonroot_and_writable_config(self):
        good = dict(st_mode=stat.S_IFREG | 0o644, st_uid=0, st_gid=0, st_nlink=1)
        self.helper._validate_metadata(SimpleNamespace(**good))
        for changes in ({'st_mode': stat.S_IFLNK | 0o777}, {'st_uid': 123},
                        {'st_mode': stat.S_IFREG | 0o664}, {'st_nlink': 2}):
            with self.subTest(changes=changes), self.assertRaises(self.helper.PublicGzipError):
                self.helper._validate_metadata(SimpleNamespace(**{**good, **changes}))

    def test_example_tracks_the_same_two_location_policy(self):
        example = (SCRIPT.parent / 'nginx-locations.conf.example').read_text()
        self.assertEqual(example.count('gzip on;'), 2)
        self.assertIn('location = /industry/manufacturing-scope.json {', example)
        for name in ('gzip_comp_level 5;', 'gzip_min_length 1024;', 'gzip_vary on;'):
            self.assertEqual(example.count(name), 2)

    def test_main_digest_and_invalid_digests_are_checked_before_backup(self):
        for site_sha, main_sha in ((digest(SITE), 'f' * 64), ('INVALID', digest(MAIN))):
            with self.scope(), self.assertRaises(self.helper.PublicGzipError):
                self.helper.apply(site_sha, main_sha, runner=self.run_command)
        self.assertEqual(self.commands, [])
        self.assertFalse(self.backups.exists())

    def test_checked_read_rejects_a_symlink_before_opening_it(self):
        symlink = SimpleNamespace(st_mode=stat.S_IFLNK | 0o777, st_uid=0, st_gid=0, st_nlink=1)
        with patch.object(Path, 'lstat', return_value=symlink), patch.object(self.helper.os, 'open') as opened:
            with self.assertRaises(self.helper.PublicGzipError):
                self.helper._checked_read(self.site)
        opened.assert_not_called()

    def test_backup_directory_must_be_root_private_and_not_a_symlink(self):
        good = dict(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
        for changes in ({'st_mode': stat.S_IFLNK | 0o700}, {'st_mode': stat.S_IFDIR | 0o755}, {'st_uid': 123}):
            with patch.object(Path, 'lstat', return_value=SimpleNamespace(**{**good, **changes})):
                with self.assertRaises(self.helper.PublicGzipError):
                    self.helper._check_private_directory(self.backups)

    def test_backup_accepts_trusted_parent_modes_without_relaxing_backup_privacy(self):
        original_lstat = Path.lstat
        for mode in (0o550, 0o700, 0o755):
            def inspected(path, *args, **kwargs):
                if path == self.root:
                    return SimpleNamespace(st_mode=stat.S_IFDIR | mode, st_uid=0)
                if path == self.backups:
                    return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
                return original_lstat(path, *args, **kwargs)

            with self.subTest(parent_mode=oct(mode)), patch.object(self.helper, 'BACKUP_ROOT', self.backups), \
                    patch.object(Path, 'lstat', inspected):
                backup = self.helper._backup(SITE, self.site.stat(), {'status': 'test'})
                self.assertEqual(backup.parent, self.backups)
                self.assertEqual((backup / 'evemtk.conf').read_bytes(), SITE)
                self.assertEqual(json.loads((backup / 'receipt.json').read_text())['status'], 'test')
                if os.name == 'posix':
                    self.assertEqual(stat.S_IMODE(self.backups.stat().st_mode), 0o700)
                    self.assertEqual(stat.S_IMODE(backup.stat().st_mode), 0o700)
                    for name in ('evemtk.conf', 'receipt.json'):
                        self.assertEqual(stat.S_IMODE((backup / name).stat().st_mode), 0o600)
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.commands, [])

    def test_backup_refuses_untrusted_parent_before_creating_backup_root(self):
        good = dict(st_mode=stat.S_IFDIR | 0o550, st_uid=0)
        for changes in ({'st_mode': stat.S_IFDIR | 0o775}, {'st_mode': stat.S_IFDIR | 0o757},
                        {'st_mode': stat.S_IFLNK | 0o700}, {'st_mode': stat.S_IFREG | 0o700},
                        {'st_uid': 123}):
            with self.subTest(changes=changes), patch.object(self.helper, 'BACKUP_ROOT', self.backups), \
                    patch.object(Path, 'lstat', return_value=SimpleNamespace(**{**good, **changes})):
                with self.assertRaises(self.helper.PublicGzipError):
                    self.helper._backup(SITE, self.site.stat(), {})
            self.assertFalse(self.backups.exists())
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.commands, [])

    def test_backup_refuses_existing_nonprivate_backup_root_under_trusted_parent(self):
        self.backups.mkdir(mode=0o755)
        original_lstat = Path.lstat

        def inspected(path, *args, **kwargs):
            if path == self.root:
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o700, st_uid=0)
            if path == self.backups:
                return SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_uid=0)
            return original_lstat(path, *args, **kwargs)

        with patch.object(self.helper, 'BACKUP_ROOT', self.backups), patch.object(Path, 'lstat', inspected):
            with self.assertRaises(self.helper.PublicGzipError):
                self.helper._backup(SITE, self.site.stat(), {})
        self.assertEqual(list(self.backups.iterdir()), [])
        self.assertEqual(self.site.read_bytes(), SITE)
        self.assertEqual(self.commands, [])

    @unittest.skipUnless(os.name == 'posix', 'real flock is a Linux/Unix apply-only boundary')
    def test_release_guard_uses_existing_lock_and_refuses_unfinished_transaction(self):
        lock = self.root / 'publish.lock'
        journal = self.root / 'transaction.json'
        lock.write_bytes(b'')
        before = lock.stat()
        with patch.object(self.helper, 'PUBLISH_LOCK', lock), patch.object(self.helper, 'TRANSACTION', journal):
            with self.helper._release_guard():
                pass
            self.assertEqual(lock.stat().st_ino, before.st_ino)
            journal.write_bytes(b'{}')
            with self.assertRaises(self.helper.PublicGzipError):
                with self.helper._release_guard():
                    self.fail('unfinished transaction accepted')
            lock.unlink()
            with self.assertRaises(OSError):
                with self.helper._release_guard():
                    self.fail('missing provisioned lock accepted')
            self.assertFalse(lock.exists())


if __name__ == '__main__':
    unittest.main()
