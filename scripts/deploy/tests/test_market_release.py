"""Market deployment gates; all paths and modules are temporary synthetic data."""
from contextlib import nullcontext
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch


SCRIPT = Path(__file__).resolve().parents[1] / 'release.py'
spec = importlib.util.spec_from_file_location('market_release_under_test', SCRIPT)
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class FlockBoundary:
    LOCK_EX, LOCK_NB = 2, 4

    def __init__(self, busy=False):
        self.busy = busy
        self.descriptor = None

    def flock(self, descriptor, flags):
        if flags != self.LOCK_EX | self.LOCK_NB:
            raise AssertionError('Must acquire exclusive, nonblocking lock')
        if self.busy:
            raise BlockingIOError('synthetic collector is busy')
        self.descriptor = descriptor

    def held(self):
        if self.descriptor is None:
            return False
        try:
            os.fstat(self.descriptor)
            return True
        except OSError:
            return False


class MarketReleaseTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name).resolve()
        self.old = {key: {'path': str(self.root / 'old' / key), 'source': '1' * 40, 'sha': 'a' * 40}
                    for key in ('backend', 'frontend')}
        self.new = {key: {'path': str(self.root / 'new' / key), 'source': '2' * 40, 'sha': 'b' * 40}
                    for key in ('backend', 'frontend')}
        for state in (self.old, self.new):
            for item in state.values():
                Path(item['path']).mkdir(parents=True)
        release.atomic_json(self.root / 'state.json', self.old)

    def require_gate(self):
        self.assertTrue(callable(getattr(release, 'market_collector_lock', None)),
                        'Collector deployment lock is not implemented yet')
        self.assertTrue(callable(getattr(release, 'prepare_market', None)),
                        'Collector runtime preflight is not implemented yet')

    def install_marker(self, state):
        marker = Path(state['backend']['path']) / 'Market/management/commands/market_tick.py'
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text('# synthetic capability\n')

    def lock_file(self):
        path = self.root / 'shared/market/collector.lock'
        path.parent.mkdir(parents=True)
        path.touch()
        return path

    def test_old_nonmarket_transaction_needs_no_collector_lock(self):
        events = []
        release.transact(self.root, self.old, self.new, ['backend'], lambda: None,
                         lambda *args: events.append('switch'), lambda: None, lambda state: None)
        self.assertEqual(events, ['switch'])
        self.assertFalse((self.root / 'shared/market').exists())

    def test_marker_forces_lock_even_without_recorded_flag(self):
        self.require_gate()
        self.install_marker(self.old)
        events = []
        with self.assertRaisesRegex(release.ReleaseError, 'collector lock'):
            release.transact(self.root, self.old, self.new, ['backend'], lambda: events.append('prepare'),
                             lambda *args: events.append('switch'), lambda: None, lambda state: None)
        self.assertEqual(events, [])
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)

    def test_first_market_install_also_requires_preprovisioned_lock(self):
        self.require_gate()
        self.install_marker(self.new)
        with self.assertRaisesRegex(release.ReleaseError, 'collector lock'):
            release.transact(self.root, self.old, self.new, ['backend'], lambda: None,
                             lambda *args: self.fail('must not switch'), lambda: None, lambda state: None)

    def test_recorded_capability_requires_lock_if_module_was_removed(self):
        self.require_gate()
        self.old['backend']['market_collector'] = True
        with self.assertRaisesRegex(release.ReleaseError, 'collector lock'):
            release.transact(self.root, self.old, self.new, ['backend'], lambda: None,
                             lambda *args: self.fail('must not switch'), lambda: None, lambda state: None)

    def test_busy_lock_prevents_prepare_journal_switch_and_state_change(self):
        self.require_gate()
        self.install_marker(self.old)
        self.lock_file()
        events = []
        with patch.dict(sys.modules, {'fcntl': FlockBoundary(busy=True)}):
            with self.assertRaisesRegex(release.ReleaseError, 'collector.*busy'):
                release.transact(self.root, self.old, self.new, ['backend'], lambda: events.append('prepare'),
                                 lambda *args: events.append('switch'), lambda: None, lambda state: None)
        self.assertEqual(events, [])
        self.assertFalse((self.root / 'transaction.json').exists())
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)

    def test_lock_covers_prepare_switch_health_recovery_and_commit(self):
        self.require_gate()
        self.install_marker(self.old)
        self.lock_file()
        boundary = FlockBoundary()
        events = []

        def event(name):
            self.assertTrue(boundary.held(), name)
            events.append(name)

        def health(state):
            event('health')
            if state == self.new:
                raise RuntimeError('synthetic failed deployment')

        with patch.dict(sys.modules, {'fcntl': boundary}):
            with self.assertRaisesRegex(release.ReleaseError, 'rolled back'):
                release.transact(self.root, self.old, self.new, ['backend'], lambda: event('prepare'),
                                 lambda *args: event('switch'), lambda: event('restart'), health)
        self.assertEqual(events, ['prepare', 'switch', 'restart', 'health', 'switch', 'restart', 'health'])
        self.assertFalse(boundary.held())
        self.assertEqual(json.loads((self.root / 'state.json').read_text()), self.old)

    def test_explicit_market_option_forces_lock_for_legacy_state(self):
        self.require_gate()
        with self.assertRaisesRegex(release.ReleaseError, 'collector lock'):
            release.transact(self.root, self.old, self.new, ['backend'], lambda: None,
                             lambda *args: None, lambda: None, lambda state: None, market_required=True)

    def test_dependency_probe_uses_candidate_interpreter_fixed_private_runtime_and_captures_output(self):
        self.require_gate()
        self.install_marker(self.new)
        runtime = self.root / 'shared/market-python'
        runtime.mkdir(parents=True)
        backend = Path(self.new['backend']['path'])
        with patch.object(release.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            release.prepare_market(self.root, backend)
        args, kwargs = run.call_args
        self.assertEqual(args[0][0], str(backend / '.venv/bin/python'))
        self.assertEqual(kwargs['cwd'], backend)
        self.assertEqual(kwargs['env']['PYTHONPATH'], str(runtime))
        self.assertEqual(kwargs['env']['PYTHONDONTWRITEBYTECODE'], '1')
        self.assertIn('1.2.2', args[0])
        self.assertTrue(kwargs['capture_output'])
        self.assertLessEqual(kwargs['timeout'], 30)

    def test_dependency_failure_is_sanitized_and_stops_prepare(self):
        self.require_gate()
        self.install_marker(self.new)
        (self.root / 'shared/market-python').mkdir(parents=True)
        failure = subprocess.CalledProcessError(1, ['private'], output='SENSITIVE', stderr='SENSITIVE')
        with patch.object(release.subprocess, 'run', side_effect=failure):
            with self.assertRaises(release.ReleaseError) as caught:
                release.prepare_market(self.root, Path(self.new['backend']['path']))
        self.assertNotIn('SENSITIVE', str(caught.exception))

    def test_legacy_dependency_probe_is_a_noop(self):
        self.require_gate()
        with patch.object(release.subprocess, 'run') as run:
            release.prepare_market(self.root, Path(self.old['backend']['path']))
        run.assert_not_called()

    def test_prepare_backend_invokes_market_gate_before_transaction_switch(self):
        self.require_gate()
        self.install_marker(self.new)
        staged = Path(self.new['backend']['path']).parent
        environment = self.root / 'environment'
        (environment / 'bin').mkdir(parents=True)
        (environment / 'bin/python').touch()
        (self.root / 'shared').mkdir()
        release.atomic_json(self.root / 'shared/environments.json', {'digest': str(environment)})
        config = {}
        for key in ('env_file', 'logs', 'uploads'):
            path = self.root / key
            path.mkdir()
            config[key] = str(path)
        manifest = {'dependencies': 'digest', 'files': {'backend/Market/management/commands/market_tick.py': 'digest'}}
        with patch.object(release, 'link'), patch.object(release, 'command'), patch.object(release, 'prepare_market', side_effect=release.ReleaseError('market gate failed')) as gate:
            with self.assertRaisesRegex(release.ReleaseError, 'market gate failed'):
                release.prepare_backend(self.root, staged, manifest, config)
        gate.assert_called_once()

    def run_probe(self, *, version='1.2.2', session_code=None, runtime_on_path=True):
        self.require_gate()
        backend = Path(self.new['backend']['path'])
        package = backend / 'Market'
        package.mkdir()
        (package / '__init__.py').write_text('')
        (package / 'session_bundle.py').write_text(session_code or 'def load_session(): pass\n')
        (package / 'collector_protocol.py').write_text('class MarketSession: pass\n')
        runtime = self.root / 'shared/market-python'
        runtime.mkdir(parents=True)
        (runtime / 'msgpack.py').write_text(f'__version__ = {version!r}\n')
        private = self.root / 'shared/market'
        private.mkdir()
        environment = dict(os.environ, PYTHONPATH=str(runtime if runtime_on_path else backend), PYTHONDONTWRITEBYTECODE='1')
        return subprocess.run(
            [sys.executable, '-B', '-c', release.MARKET_RUNTIME_PROBE,
             str(backend), '1.2.2', str(runtime), str(private)],
            cwd=backend, env=environment, capture_output=True, text=True, timeout=10,
        )

    def test_actual_probe_imports_synthetic_candidate_and_pinned_runtime(self):
        result = self.run_probe()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout, '')

    def test_actual_probe_rejects_wrong_msgpack_version(self):
        result = self.run_probe(version='0.0.0')
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('dependency mismatch', result.stderr)

    def test_actual_probe_denies_network_audit_before_any_connection(self):
        # Emit a synthetic audit event, never create or connect a real socket.
        result = self.run_probe(session_code="import sys\nsys.audit('socket.connect', None, ('192.0.2.1', 1))\ndef load_session(): pass\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Network access is forbidden', result.stderr)

    def test_actual_probe_denies_credential_read(self):
        result = self.run_probe(session_code="from pathlib import Path\nPath('.env').read_text()\ndef load_session(): pass\n")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('Credential access is forbidden', result.stderr)

    def test_actual_probe_requires_both_session_and_protocol_api(self):
        result = self.run_probe(session_code='synthetic = True\n')
        self.assertNotEqual(result.returncode, 0)

    def test_runtime_pin_matches_the_separately_provisioned_requirement(self):
        self.require_gate()
        requirements = (SCRIPT.parent / 'requirements-market.txt').read_text()
        pins = [line.strip() for line in requirements.splitlines() if line.strip() and not line.startswith('#')]
        self.assertIn('msgpack==' + release.MARKET_MSGPACK_VERSION, pins)

    def test_manual_rollback_uses_target_market_preflight_before_switch(self):
        self.require_gate()
        self.install_marker(self.new)
        release.atomic_json(self.root / 'initialized.json', {'synthetic': True})
        release.atomic_json(self.root / 'config.json', {})
        release.atomic_json(self.root / 'previous.json', self.new)
        real_resolve = Path.resolve
        active = {self.root / 'current' / key: Path(item['path']) for key, item in self.old.items()}

        def resolve(path, *args, **kwargs):
            return active[path] if path in active else real_resolve(path, *args, **kwargs)

        def prepare_only(root, old, new, changed, prepare, switch, restart, health, **kwargs):
            prepare()

        with patch.object(release, 'server_lock', return_value=nullcontext()), \
                patch.object(Path, 'is_symlink', side_effect=lambda: True), \
                patch.object(Path, 'resolve', resolve), patch.object(release, 'transact', side_effect=prepare_only), \
                patch.object(release, 'command'), patch.object(release, 'link') as switch, \
                patch.object(release, 'prepare_market', side_effect=release.ReleaseError('market rollback gate')) as gate:
            with self.assertRaisesRegex(release.ReleaseError, 'market rollback gate'):
                release.publish(self.root, rollback=True)
        gate.assert_called_once_with(self.root, Path(self.new['backend']['path']), required=False)
        switch.assert_not_called()


class MarketServiceUnitTests(unittest.TestCase):
    def test_unit_uses_systemd_219_compatible_read_only_hardening(self):
        unit = (SCRIPT.parent / 'evem-market-collector.service.example').read_text()
        self.assertIn('ProtectSystem=full', unit)
        self.assertIn('ReadOnlyDirectories=/EVEMTK', unit)
        self.assertIn('Environment=PYTHONDONTWRITEBYTECODE=1', unit)
        self.assertNotIn('ProtectSystem=strict', unit)


if __name__ == '__main__':
    unittest.main()
