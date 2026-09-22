import importlib.util
from pathlib import Path
import tempfile
import unittest
import json
from urllib.error import HTTPError
from urllib.request import Request

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('starsea_seed', ROOT / 'scripts/starsea/local_seed.py')
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class LocalSafetyTests(unittest.TestCase):
    def test_http_smoke_never_uses_proxies_or_follows_redirects(self):
        module_spec = importlib.util.spec_from_file_location('starsea_smoke', ROOT / 'scripts/starsea/smoke.py')
        module = importlib.util.module_from_spec(module_spec)
        module_spec.loader.exec_module(module)
        opener = module.local_opener()
        self.assertFalse(any(getattr(handler, 'proxies', {}) for handler in opener.handlers))
        handler = next(item for item in opener.handlers if isinstance(item, module.NoRedirect))
        with self.assertRaises(HTTPError):
            handler.redirect_request(Request(module.BASE + '/starsea/mine/', headers={'Authorization': 'Bearer local'}), None, 302, 'Found', {}, 'https://external.invalid/path')

    def test_geography_rejects_self_consistent_but_empty_or_wrong_origin(self):
        spec_geo = importlib.util.spec_from_file_location('starsea_test_geography', ROOT / 'scripts/tactical/real_universe.py')
        geo = importlib.util.module_from_spec(spec_geo)
        spec_geo.loader.exec_module(geo)
        snapshot = {'regions': [], 'constellations': [], 'systems': [], 'stargates': [], 'metadata': {
            'format': geo.FORMAT, 'kind': 'evem-public-static-snapshot', 'source_url': 'https://external.invalid', 'omissions': {}, 'counts': {}}}
        snapshot['metadata']['sha256'] = geo.content_digest(snapshot)
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / 'snapshot.json'
            path.write_text(json.dumps(snapshot), encoding='utf-8')
            with self.assertRaises(ValueError):
                seed.read_geography(path)

    def test_starsea_geography_reads_only_validated_offline_snapshot(self):
        with tempfile.TemporaryDirectory() as name:
            path = Path(name) / 'snapshot.json'
            path.write_text(json.dumps({'metadata': {'format': 'untrusted', 'sha256': 'wrong'}}), encoding='utf-8')
            with self.assertRaises(ValueError):
                seed.read_geography(path)
        real = ROOT / 'backend/.tactical-universe.json'
        if real.exists():
            result = seed.read_geography(real)
            self.assertGreater(len(result['systems']), 5000)
            self.assertTrue(all(row['system_id'] < 99000000 for row in result['systems']))

    def test_accepts_only_separate_local_sqlite(self):
        base = ROOT / 'backend'
        seed.require_local(seed.LOCAL_SETTINGS, {'ENGINE': 'django.db.backends.sqlite3', 'NAME': base / '.starsea-local.sqlite3'}, base)

    def test_rejects_production_settings_mysql_and_tactical_database(self):
        base = ROOT / 'backend'
        good = {'ENGINE': 'django.db.backends.sqlite3', 'NAME': base / '.starsea-local.sqlite3'}
        for settings_name, database in [('EVE_MDjango.settings', good), (seed.LOCAL_SETTINGS, {**good, 'ENGINE': 'django.db.backends.mysql'}), (seed.LOCAL_SETTINGS, {**good, 'NAME': base / '.tactical-local.sqlite3'}), (seed.LOCAL_SETTINGS, {**good, 'NAME': ':memory:'})]:
            with self.subTest(settings=settings_name, db=database), self.assertRaises(ValueError):
                seed.require_local(settings_name, database, base)

    def test_local_settings_never_import_production_or_env(self):
        source = (ROOT / 'backend/EVE_MDjango/starsea_local_settings.py').read_text(encoding='utf-8')
        self.assertNotIn('from .settings', source)
        self.assertNotIn('load_dotenv', source)
        self.assertIn('127.0.0.1', source)
        self.assertNotIn("ALLOWED_HOSTS = ['*']", source)
        self.assertIn('.starsea-local.sqlite3', source)

    def test_rejects_linked_database(self):
        with tempfile.TemporaryDirectory() as name:
            base = Path(name)
            real = base / 'real.sqlite3'
            real.touch()
            link = base / '.starsea-local.sqlite3'
            try:
                link.symlink_to(real)
            except OSError:
                self.skipTest('Windows symlink permission unavailable')
            with self.assertRaises(ValueError):
                seed.require_local(seed.LOCAL_SETTINGS, {'ENGINE': 'django.db.backends.sqlite3', 'NAME': link}, base)


if __name__ == '__main__':
    unittest.main()
