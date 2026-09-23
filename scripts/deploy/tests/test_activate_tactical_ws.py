"""Activation/rollback contract without touching host services or network."""
from contextlib import ExitStack
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'activate_tactical_ws.py'
spec = importlib.util.spec_from_file_location('activate_tactical_ws', SCRIPT)
activation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(activation)


class TacticalActivationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.paths = {
            'NGINX': self.root / 'etc/nginx/evemtk.conf',
            'UNIT': self.root / 'etc/systemd/evem-tactical-asgi.service',
            'PUBLISHER': self.root / 'lib/evem-deploy/release.py',
            'SUDOERS': self.root / 'etc/sudoers/evem-deploy',
            'CONFIG': self.root / 'deploy/config.json',
            'STATE': self.root / 'deploy/state.json',
            'BACKEND': self.root / 'deploy/current/backend',
            'RUNTIME': self.root / 'deploy/shared/tactical-python',
            'BACKUP_ROOT': self.root / 'backups',
        }
        self.bundle = self.root / 'bundle'
        self.bundle.mkdir()
        self.paths['BACKUP_ROOT'].mkdir()
        self.paths['RUNTIME'].mkdir(parents=True)
        self.sha = 'a' * 40
        files = {
            self.paths['NGINX']: b'    location /api/ {\n    }\n',
            self.paths['PUBLISHER']: b'# old publisher\n',
            self.paths['SUDOERS']: b'evem-deploy ALL=(root) NOPASSWD: /bin/systemctl restart evem-backend.service\n',
            self.paths['CONFIG']: json.dumps({'origin': 'https://evemtk.com'}).encode(),
            self.paths['STATE']: b'{}',
            self.paths['BACKEND'] / '.release-sha': self.sha.encode(),
            self.paths['BACKEND'] / 'requirements-tactical-runtime.txt': b'channels==4.2.0\n',
        }
        for path, data in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)
        self.original = {path: path.read_bytes() for path in (
            self.paths['NGINX'], self.paths['PUBLISHER'], self.paths['SUDOERS'], self.paths['CONFIG'])}
        for name in ('evem-tactical-asgi.service.example', 'tactical-nginx-location.example.conf', 'release.py'):
            (self.bundle / name).write_text('    location ^~ /ws/tactical/ {}\n' if 'nginx' in name else '# new\n')

    def activate(self, interrupt=False):
        commands = []

        def fake_run(*command, **kwargs):
            commands.append(command)
            if interrupt and len(command) >= 3 and command[1] == '-c' and 'release.health(' in command[2]:
                raise KeyboardInterrupt()

        def fake_replace(path, data):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(data)

        with ExitStack() as stack:
            for name, path in self.paths.items():
                stack.enter_context(patch.object(activation, name, path))
            stack.enter_context(patch.object(activation.os, 'geteuid', return_value=0, create=True))
            stack.enter_context(patch.object(activation, 'run', side_effect=fake_run))
            stack.enter_context(patch.object(activation, 'replace_file', side_effect=fake_replace))
            stack.enter_context(patch.object(activation, 'probe_loopback'))
            if interrupt:
                with self.assertRaises(KeyboardInterrupt):
                    activation.activate(self.bundle, self.sha)
            else:
                activation.activate(self.bundle, self.sha)
        return commands

    def test_success_enables_sidecar_only_after_public_health(self):
        commands = self.activate()
        self.assertTrue(json.loads(self.paths['CONFIG'].read_text())['tactical_ws'])
        self.assertTrue(self.paths['UNIT'].is_file())
        self.assertIn('location ^~ /ws/tactical/', self.paths['NGINX'].read_text())
        self.assertTrue(any(len(command) >= 3 and 'release.health(' in command[2] for command in commands))

    def test_interrupt_restores_every_config_and_disables_sidecar(self):
        commands = self.activate(interrupt=True)
        for path, data in self.original.items():
            self.assertEqual(path.read_bytes(), data)
        self.assertFalse(self.paths['UNIT'].exists())
        self.assertIn(('systemctl', 'disable', '--now', 'evem-tactical-asgi.service'), commands)
        self.assertIn(('systemctl', 'daemon-reload'), commands)
