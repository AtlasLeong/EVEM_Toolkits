import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

DIRECTORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(DIRECTORY))
spec = importlib.util.spec_from_file_location('pack', DIRECTORY / 'pack.py')
pack = importlib.util.module_from_spec(spec) if (DIRECTORY / 'pack.py').exists() else None
if pack:
    spec.loader.exec_module(pack)


class PackTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(pack, 'Artifact packer is not implemented yet')
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        (self.root / 'backend').mkdir()
        (self.root / 'front-codex').mkdir()
        (self.root / 'backend/manage.py').write_text('# app')
        (self.root / 'backend/requirements.txt').write_text('Django==4.2.5\n')
        (self.root / 'front-codex/package.json').write_text('{}')
        self.git('init', '-q')
        self.git('add', '.')
        self.git('-c', 'user.name=CI', '-c', 'user.email=ci@example.invalid', 'commit', '-qm', 'fixture')
        self.sha = self.git('rev-parse', 'HEAD').strip()
        self.dist = self.root / 'dist'
        self.dist.mkdir()
        (self.dist / 'index.html').write_text('<html>built</html>')
        self.output = self.root / 'bundle.tar.gz'

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, text=True)

    def test_packages_commit_and_dist_but_never_untracked_secrets(self):
        (self.root / 'backend/.env').write_text('SECRET=do-not-package')
        pack.build(self.root, self.dist, self.output)
        with tarfile.open(self.output) as archive:
            self.assertNotIn('backend/.env', archive.getnames())
            manifest = json.load(archive.extractfile('manifest.json'))
            self.assertEqual(manifest['sha'], self.sha)
            self.assertEqual(archive.extractfile('backend/.release-sha').read().decode(), self.sha)
            self.assertEqual(json.load(archive.extractfile('frontend/deploy-version.json')), {'sha': self.sha})

    def test_dirty_source_rejected_instead_of_mislabeled_commit(self):
        (self.root / 'backend/manage.py').write_text('changed')
        with self.assertRaisesRegex(pack.ReleaseError, 'dirty'):
            pack.build(self.root, self.dist, self.output)
        self.assertFalse(self.output.exists())

    def test_missing_built_entry_rejected(self):
        (self.dist / 'index.html').unlink()
        with self.assertRaisesRegex(pack.ReleaseError, 'index.html'):
            pack.build(self.root, self.dist, self.output)

    def test_secret_in_frontend_build_rejected(self):
        (self.dist / '.env').write_text('SECRET=oops')
        with self.assertRaises(pack.ReleaseError):
            pack.build(self.root, self.dist, self.output)


if __name__ == '__main__':
    unittest.main()
