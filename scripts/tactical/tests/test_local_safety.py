import importlib.util
import asyncio
from pathlib import Path
import unittest
from unittest.mock import patch

MODULE = Path(__file__).resolve().parents[1] / 'local_seed.py'


class LocalSeedSafetyTests(unittest.TestCase):
    def load(self):
        self.assertTrue(MODULE.exists(), 'local seed safety module missing')
        spec = importlib.util.spec_from_file_location('tactical_local_seed', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_refuses_production_settings_and_nonlocal_database(self):
        module = self.load()
        backend = MODULE.parents[2] / 'backend'
        valid = {'ENGINE': 'django.db.backends.sqlite3', 'NAME': backend / '.tactical-local.sqlite3'}
        module.require_local('EVE_MDjango.tactical_local_settings', valid, backend)
        for settings_name, config in [('EVE_MDjango.settings', valid),
                                     ('EVE_MDjango.tactical_local_settings', {**valid, 'NAME': 'production.sqlite3'}),
                                     ('EVE_MDjango.tactical_local_settings', {'ENGINE': 'django.db.backends.mysql', 'NAME': 'business'})]:
            with self.assertRaises(ValueError):
                module.require_local(settings_name, config, backend)

    def test_graph_is_explicitly_synthetic_and_has_border_connections(self):
        module = self.load()
        regions, systems, gates = module.demo_graph()
        self.assertGreaterEqual(len(regions), 2)
        self.assertGreaterEqual(len(systems), 12)
        self.assertTrue(all('演习' in item['name'] for item in regions))
        mapping = {row['system_id']: row['region_id'] for row in systems}
        self.assertTrue(any(mapping[left] != mapping[right] for left, right in gates))

    def test_refuses_database_symlink_before_resolving_target(self):
        module = self.load()
        backend = MODULE.parents[2] / 'backend'
        database = backend / '.tactical-local.sqlite3'
        external_target = backend.parent / 'not-a-demo.sqlite3'
        original_resolve = Path.resolve
        # Model an OS symlink without requiring Windows symlink privileges.
        def resolve(path, *args, **kwargs):
            return external_target if path == database else original_resolve(path, *args, **kwargs)
        with patch.object(Path, 'resolve', resolve), patch.object(Path, 'is_symlink', lambda path: path == database):
            with self.assertRaises(ValueError):
                module.require_local(module.LOCAL_SETTINGS, {'ENGINE': 'django.db.backends.sqlite3', 'NAME': database}, backend)

    def test_load_target_rejects_remote_hosts_and_credentials(self):
        path = MODULE.parent / 'load_board.py'
        self.assertTrue(path.exists(), 'safe load tool missing')
        spec = importlib.util.spec_from_file_location('tactical_load', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.validate_target('http://127.0.0.1:8001')
        for value in ['https://evemtk.com', 'http://127.0.0.1.attacker.invalid', 'http://user:pass@127.0.0.1:8001', 'http://127.0.0.1:8001/api', 'http://localhost:8001']:
            with self.assertRaises(ValueError):
                module.validate_target(value)

    def test_load_final_update_waits_for_snapshot_delivery(self):
        spec = importlib.util.spec_from_file_location('tactical_load_drain', MODULE.parent / 'load_board.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        async def exercise():
            observations = {}
            async def delayed_snapshot():
                await asyncio.sleep(.02)
                observations[0, 'last'] = .02
            task = asyncio.create_task(delayed_snapshot())
            self.assertTrue(await module.drain_observations(observations, 'last', 1, timeout=.2))
            await task
            self.assertFalse(await module.drain_observations(observations, 'missing', 1, timeout=.01))
        asyncio.run(exercise())
