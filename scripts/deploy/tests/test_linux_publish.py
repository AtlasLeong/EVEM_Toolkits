"""Linux integration tests: real CLI, flock, symlinks, files, subprocesses and HTTP.

All data lives in TemporaryDirectory. Fake systemctl/sudo executables intercept every
service operation; no real service, database or production directory is touched.
"""
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / 'release.py'


@unittest.skipUnless(sys.platform.startswith('linux'), 'requires Linux flock and symlinks')
class LinuxPublishTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='evem-publish-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        for name in ('current', 'shared', 'releases/old/frontend', 'releases/old/backend',
                     'env/bin', 'data/uploads', 'data/logs', 'commands'):
            (self.root / name).mkdir(parents=True, exist_ok=True)
        (self.root / 'data/.env').write_text('FAKE_TEST_CONFIGURATION=1')
        (self.root / 'env/bin/python').symlink_to(sys.executable)
        self.env = dict(os.environ, EVEM_TEST_ROOT=str(self.root),
                        PATH=str(self.root / 'commands') + os.pathsep + os.environ['PATH'])
        self.executable('systemctl', '#!/bin/sh\nprintf "%s\\n" "$*" >> "$EVEM_TEST_ROOT/service-events"\n')
        self.executable('sudo', '#!/bin/sh\n[ "$1" = "-n" ] && shift\n'
                        '[ "$1" = "/bin/systemctl" ] || exit 99\nshift\n'
                        'exec "$EVEM_TEST_ROOT/commands/systemctl" "$@"\n')
        self.requirements = b'Django==4.2.5\n'
        self.manage = ("import os,sys\nfrom pathlib import Path\n"
                       "root=Path(os.environ['EVEM_TEST_ROOT'])\n"
                       "with (root/'manage-events').open('a') as f: f.write(' '.join(sys.argv[1:])+'\\n')\n"
                       "sys.exit(1 if 'migrate' in sys.argv and (root/'pending').exists() else 0)\n").encode()
        self.old = {}
        for component, tree in [('frontend', 'd'), ('backend', 'e')]:
            directory = self.root / 'releases/old' / component
            (self.root / 'current' / component).symlink_to(directory)
            self.old[component] = {'path': str(directory), 'sha': '0' * 40, 'source': tree * 40}
        old_backend = self.root / 'releases/old/backend'
        (old_backend / 'manage.py').write_bytes(self.manage)
        (old_backend / '.venv').symlink_to(self.root / 'env')
        (old_backend / '.release-sha').write_text('0' * 40)
        old_frontend = self.root / 'releases/old/frontend'
        (old_frontend / 'index.html').write_text('<html>old</html>')
        (old_frontend / 'deploy-version.json').write_text(json.dumps({'sha': '0' * 40}))
        root = self.root
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                route = self.path.split('?')[0]
                if route == '/api/boardregions':
                    data = b'[]'
                elif route == '/api/deploy-version/':
                    sha = (root / 'current/backend/.release-sha').read_text()
                    if (root / 'bad-health').exists() and sha != '0' * 40:
                        sha = 'wrong-worker-version'
                    data = json.dumps({'sha': sha}).encode()
                elif route.startswith('/assets/'):
                    data = (root / 'shared' / route.lstrip('/')).read_bytes()
                else:
                    name = 'index.html' if route == '/' else route.lstrip('/')
                    data = (root / 'current/frontend' / name).read_bytes()
                self.send_response(200)
                self.end_headers()
                self.wfile.write(data)
        self.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.json('initialized.json', {'test': True})
        self.json('state.json', self.old)
        self.json('previous.json', self.old)
        self.json('config.json', {'origin': 'http://127.0.0.1:' + str(self.server.server_port),
                                  'env_file': str(self.root / 'data/.env'),
                                  'uploads': str(self.root / 'data/uploads'),
                                  'logs': str(self.root / 'data/logs')})
        self.json('shared/environments.json', {
            hashlib.sha256(self.requirements).hexdigest(): str(self.root / 'env')})

    def executable(self, name, code):
        path = self.root / 'commands' / name
        path.write_text(code)
        path.chmod(0o755)

    def json(self, name, value):
        (self.root / name).write_text(json.dumps(value))

    def bundle(self, backend='c'):
        sha = 'a' * 40
        files = {'backend/manage.py': self.manage, 'backend/requirements.txt': self.requirements,
                 'backend/.release-sha': sha.encode(),
                 'frontend/index.html': b'<html><script src="/assets/test-a.js"></script></html>',
                 'frontend/assets/test-a.js': b'console.log("new")',
                 'frontend/deploy-version.json': json.dumps({'sha': sha}).encode()}
        manifest = {'format': 1, 'sha': sha, 'sources': {'frontend': 'b' * 40, 'backend': backend * 40},
                    'dependencies': hashlib.sha256(self.requirements).hexdigest(),
                    'files': {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}}
        files['manifest.json'] = json.dumps(manifest).encode()
        archive = self.root / 'release.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                out.addfile(info, io.BytesIO(data))
        return archive

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPT), *map(str, args), '--root', str(self.root)],
                              env=self.env, capture_output=True, text=True, timeout=45)

    def test_publish_and_manual_rollback_with_real_symlinks(self):
        result = self.run_cli('publish', self.bundle())
        self.assertEqual(result.returncode, 0, result.stderr)
        new = json.loads((self.root / 'state.json').read_text())
        self.assertEqual(new['backend']['sha'], 'a' * 40)
        self.assertEqual((self.root / 'current/backend').resolve(), self.root / 'releases' / ('a' * 40) / 'backend')
        self.assertIn('--database default', (self.root / 'manage-events').read_text())
        self.assertIn('--database license', (self.root / 'manage-events').read_text())
        result = self.run_cli('rollback')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)
        self.assertTrue((self.root / 'shared/assets/test-a.js').exists())

    def test_frontend_release_does_not_restart_or_run_backend_preflight(self):
        result = self.run_cli('publish', self.bundle(backend='e'))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertNotIn('restart', (self.root / 'service-events').read_text())
        self.assertFalse((self.root / 'manage-events').exists())
        self.assertEqual((self.root / 'current/backend').resolve(), self.root / 'releases/old/backend')

    def test_pending_migration_blocks_switch_and_retry_works(self):
        archive = self.bundle()
        (self.root / 'pending').touch()
        result = self.run_cli('publish', archive)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.root / 'service-events').exists())
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)
        (self.root / 'pending').unlink()
        result = self.run_cli('publish', archive)
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_wrong_live_version_restores_previous_release(self):
        (self.root / 'bad-health').touch()
        result = self.run_cli('publish', self.bundle())
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('rolled back and recovery verified', result.stderr)
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)
        self.assertFalse((self.root / 'transaction.json').exists())

    def test_concurrent_publish_fails_before_switch(self):
        import fcntl
        with (self.root / 'publish.lock').open('w') as locked:
            fcntl.flock(locked, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_cli('publish', self.bundle())
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)
        self.assertFalse((self.root / 'service-events').exists())
