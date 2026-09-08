import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'release.py'
spec = importlib.util.spec_from_file_location('release', SCRIPT)
release = importlib.util.module_from_spec(spec) if SCRIPT.exists() else None
if release:
    spec.loader.exec_module(release)


def digest(data):
    return hashlib.sha256(data).hexdigest()


class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(release, 'Release publisher is not implemented yet')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)

    def bundle(self, changes=None, extra=None, sources=None):
        files = {'frontend/index.html': b'hello', 'backend/manage.py': b'# app',
                 'backend/requirements.txt': b'Django==4.2.5\n'}
        files.update(changes or {})
        manifest = {'format': 1, 'sha': 'a' * 40,
                    'sources': sources or {'frontend': 'b' * 40, 'backend': 'c' * 40},
                    'dependencies': digest(files['backend/requirements.txt']),
                    'files': {name: digest(data) for name, data in files.items()}}
        archive = self.root / 'release.tar.gz'
        with tarfile.open(archive, 'w:gz') as out:
            for name, data in {**files, **(extra or {}), 'manifest.json': json.dumps(manifest).encode()}.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                out.addfile(info, io.BytesIO(data))
        return archive, manifest

    def test_bundle_validates_and_extracts(self):
        archive, manifest = self.bundle()
        target = release.stage(archive, self.root / 'releases')
        self.assertEqual((target / 'frontend/index.html').read_bytes(), b'hello')
        self.assertEqual(json.loads((target / 'manifest.json').read_text()), manifest)

    def test_tampered_bytes_rejected_without_release(self):
        archive, _ = self.bundle(extra={'frontend/index.html': b'tampered'})
        with self.assertRaisesRegex(release.ReleaseError, 'checksum'):
            release.stage(archive, self.root / 'releases')
        self.assertFalse((self.root / 'releases' / ('a' * 40)).exists())

    def test_unlisted_file_rejected(self):
        archive, _ = self.bundle(extra={'backend/extra.py': b'extra'})
        with self.assertRaisesRegex(release.ReleaseError, 'inventory'):
            release.stage(archive, self.root / 'releases')

    def test_unsafe_paths_and_persistent_data_rejected(self):
        for name in ['../outside', '/absolute', 'backend/../../outside', 'backend\\evil',
                     'backend/.env', 'backend/.venv/bin/python', 'backend/static/uploads/user.png',
                     'backend/logs/dev.log', 'frontend/.env.production', 'backend/id_ed25519']:
            with self.subTest(name=name):
                archive, _ = self.bundle(changes={name: b'secret'})
                with self.assertRaises(release.ReleaseError):
                    release.stage(archive, self.root / 'releases')

    def test_archive_symlink_rejected(self):
        archive = self.root / 'link.tar'
        with tarfile.open(archive, 'w') as out:
            info = tarfile.TarInfo('backend/escape')
            info.type = tarfile.SYMTYPE
            info.linkname = '/etc/passwd'
            out.addfile(info)
        with self.assertRaises(release.ReleaseError):
            release.stage(archive, self.root / 'releases')

    def test_duplicate_member_rejected(self):
        archive = self.root / 'duplicate.tar'
        with tarfile.open(archive, 'w') as out:
            for _ in range(2):
                info = tarfile.TarInfo('manifest.json')
                info.size = 2
                out.addfile(info, io.BytesIO(b'{}'))
        with self.assertRaisesRegex(release.ReleaseError, 'duplicate'):
            release.stage(archive, self.root / 'releases')

    def state(self, frontend='b', backend='c'):
        return {name: {'source': value * 40, 'sha': '0' * 40,
                       'path': str(self.root / 'old' / name)}
                for name, value in [('frontend', frontend), ('backend', backend)]}

    def test_components_compare_last_successful_not_previous_commit(self):
        _, manifest = self.bundle()
        self.assertEqual(release.changed_components(self.state(), manifest), [])
        self.assertEqual(release.changed_components(self.state(frontend='d'), manifest), ['frontend'])
        self.assertEqual(release.changed_components(self.state(backend='e'), manifest), ['backend'])

    def transaction(self, changed, fail=None, rollback_fail=False):
        old = self.state()
        new = {name: {**item, 'sha': 'a' * 40, 'path': str(self.root / 'new' / name)}
               for name, item in old.items()}
        release.atomic_json(self.root / 'state.json', old)
        release.atomic_json(self.root / 'previous.json', {'earlier': True})
        events = []
        def check(state):
            events.append(('health', state))
            if state == new and fail == 'health':
                raise RuntimeError('unhealthy')
            if state == old and rollback_fail:
                raise RuntimeError('recovery failed')
        def preflight():
            events.append(('prepare', None))
            if fail == 'prepare':
                raise RuntimeError('migration pending')
        def switch(component, path):
            events.append(('switch', (component, path)))
            if fail == 'switch' and path == new[component]['path']:
                raise RuntimeError('switch failed')
        return old, new, events, lambda: release.transact(
            self.root, old, new, changed, preflight, switch,
            lambda: events.append(('restart', None)), check)

    def test_frontend_only_never_restarts_backend(self):
        _, new, events, run = self.transaction(['frontend'])
        run()
        self.assertNotIn(('restart', None), events)
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), new)
        self.assertFalse((self.root / 'transaction.json').exists())

    def test_preflight_failure_does_not_switch(self):
        _, _, events, run = self.transaction(['backend'], 'prepare')
        with self.assertRaisesRegex(RuntimeError, 'migration pending'):
            run()
        self.assertEqual(events, [('prepare', None)])
        self.assertFalse((self.root / 'transaction.json').exists())

    def test_health_failure_restores_both_and_checks_recovery(self):
        old, _, events, run = self.transaction(['frontend', 'backend'], 'health')
        with self.assertRaisesRegex(release.ReleaseError, 'rolled back'):
            run()
        self.assertEqual(events.count(('restart', None)), 2)
        self.assertEqual(events[-1], ('health', old))
        self.assertFalse((self.root / 'transaction.json').exists())
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), old)

    def test_partial_switch_failure_also_restores(self):
        old, _, events, run = self.transaction(['frontend', 'backend'], 'switch')
        with self.assertRaisesRegex(release.ReleaseError, 'rolled back'):
            run()
        self.assertIn(('switch', ('frontend', old['frontend']['path'])), events)

    def test_failed_recovery_keeps_journal_and_blocks_next_release(self):
        _, _, events, run = self.transaction(['backend'], 'health', True)
        with self.assertRaisesRegex(release.ReleaseError, 'recovery failed'):
            run()
        self.assertTrue((self.root / 'transaction.json').exists())
        count = len(events)
        with self.assertRaisesRegex(release.ReleaseError, 'unfinished'):
            run()
        self.assertEqual(len(events), count)

    def test_unregistered_dependencies_block_before_runtime_commands(self):
        archive, manifest = self.bundle()
        staged = release.stage(archive, self.root / 'releases')
        with self.assertRaisesRegex(release.ReleaseError, 'dependency environment'):
            release.prepare_backend(self.root, staged, manifest, {})

    def test_same_artifact_can_be_retried_after_failed_preflight(self):
        archive, _ = self.bundle()
        first = release.stage(archive, self.root / 'releases')
        self.assertEqual(release.stage(archive, self.root / 'releases'), first)

    def test_existing_release_is_not_trusted_if_modified(self):
        archive, _ = self.bundle()
        target = release.stage(archive, self.root / 'releases')
        (target / 'backend/manage.py').write_text('modified')
        with self.assertRaisesRegex(release.ReleaseError, 'existing release'):
            release.stage(archive, self.root / 'releases')

    def test_existing_release_rejects_unlisted_source(self):
        archive, _ = self.bundle()
        target = release.stage(archive, self.root / 'releases')
        (target / 'backend/unlisted.py').write_text('unexpected code')
        with self.assertRaisesRegex(release.ReleaseError, 'unlisted'):
            release.stage(archive, self.root / 'releases')

    def test_retry_tolerates_runtime_bytecode_without_packaging_it(self):
        archive, _ = self.bundle()
        target = release.stage(archive, self.root / 'releases')
        cache = target / 'backend/__pycache__'
        cache.mkdir()
        (cache / 'manage.cpython-310.pyc').write_bytes(b'runtime cache')
        self.assertEqual(release.stage(archive, self.root / 'releases'), target)

    def test_assets_are_retained_and_collisions_never_overwritten(self):
        frontend = self.root / 'frontend'
        (frontend / 'assets').mkdir(parents=True)
        asset = frontend / 'assets/app-a.js'
        asset.write_bytes(b'first')
        release.prepare_assets(self.root, frontend)
        saved = self.root / 'shared/assets/app-a.js'
        self.assertEqual(saved.read_bytes(), b'first')
        release.prepare_assets(self.root, frontend)
        asset.write_bytes(b'different bytes, same path')
        with self.assertRaisesRegex(release.ReleaseError, 'asset collision'):
            release.prepare_assets(self.root, frontend)
        self.assertEqual(saved.read_bytes(), b'first')

    def test_path_prefix_collision_rejected_before_extraction(self):
        archive, _ = self.bundle(changes={'backend/a': b'a', 'backend/a/file': b'b'})
        with self.assertRaisesRegex(release.ReleaseError, 'path collision'):
            release.stage(archive, self.root / 'releases')

    def test_interrupt_after_state_commit_restores_metadata_too(self):
        old, new, events, run = self.transaction(['backend'])
        original = release.atomic_json
        def write_then_interrupt(path, value):
            original(path, value)
            if Path(path).name == 'state.json' and value == new:
                raise KeyboardInterrupt('signal after replacement')
        with patch.object(release, 'atomic_json', side_effect=write_then_interrupt):
            with self.assertRaisesRegex(release.ReleaseError, 'rolled back'):
                run()
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), old)
        self.assertEqual(json.loads((self.root / 'previous.json').read_text()), {'earlier': True})
        self.assertFalse((self.root / 'transaction.json').exists())


if __name__ == '__main__':
    unittest.main()
