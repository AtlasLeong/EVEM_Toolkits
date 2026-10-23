"""Fresh web processes must not need or import game-worker dependencies."""
import os
from pathlib import Path
import subprocess
import sys
import textwrap
import unittest


WEB_PROCESS = textwrap.dedent(r'''
    import importlib.abc
    import json
    import os
    from pathlib import Path
    import sys
    import tempfile
    from unittest.mock import patch

    blocked = ('msgpack', 'AnomalyHotspots.protocol', 'AnomalyHotspots.collector',
               'AnomalyHotspots.session_bundle', 'Killboard.session_bundle')
    class NoWorkerDependencies(importlib.abc.MetaPathFinder):
        def find_spec(self, fullname, path=None, target=None):
            if any(fullname == name or fullname.startswith(name + '.') for name in blocked):
                raise ImportError('Forbidden worker dependency: ' + fullname)
    sys.meta_path.insert(0, NoWorkerDependencies())

    from django.conf import settings
    from EVE_MDjango import public_access_test_settings as base
    configured = {name: getattr(base, name) for name in dir(base) if name.isupper()}
    configured['INSTALLED_APPS'] = [*configured['INSTALLED_APPS'],
        'django.contrib.admin', 'django.contrib.sessions', 'django.contrib.messages',
        'django.contrib.staticfiles', 'AnomalyHotspots']
    configured['ROOT_URLCONF'] = 'EVE_MDjango.urls'
    configured['MIDDLEWARE'] = []
    configured['REST_FRAMEWORK'] = {**configured['REST_FRAMEWORK'],
        'DEFAULT_THROTTLE_RATES': {'anomaly_hotspots': '120/hour'}}
    settings.configure(**configured)
    import django
    django.setup()
    from django.test import Client, override_settings
    from django.urls import resolve
    # Resolve the real production URL tree, not a stand-in snapshot-only view.
    assert resolve('/api/anomaly-hotspots/').url_name == 'anomaly_hotspots'
    from AnomalyHotspots.snapshot import (read_snapshot, write_success,
        SnapshotError, MAX_SNAPSHOT_BYTES)

    with tempfile.TemporaryDirectory() as directory:
        parent = Path(directory)
        if os.name == 'posix': parent.chmod(0o750)
        snapshot = parent / 'snapshot.json'
        with override_settings(ANOMALY_SNAPSHOT_FILE=str(snapshot)):
            client = Client()
            response = client.get('/api/anomaly-hotspots/')
            assert response.status_code == 200
            assert response.json()['status'] == 'unavailable'
            assert response['Cache-Control'] == 'no-store'
            write_success(snapshot, [{'solar_system_id': 30001211, 'destroy_num': 5}], now_ms=1000)
            response = client.get('/api/anomaly-hotspots/')
            assert response.status_code == 200
            payload = response.json()
            assert payload['collected_at_ms'] == 1000
            assert payload['systems'] == [{'solar_system_id': 30001211, 'destroy_num': 5,
                'system_name': None, 'region_id': None, 'region_name': None}]
            assert payload['version'] == 2
            assert payload['metric'] == {'kind': 'activity_level', 'range_version': 1}
            assert payload['statistics_window'] is None
            assert client.head('/api/anomaly-hotspots/').status_code == 200
        assert read_snapshot('relative-snapshot.json')['status'] == 'unavailable'
        with patch.object(Path, 'is_symlink', return_value=True):
            assert read_snapshot(snapshot)['status'] == 'unavailable'
            try:
                write_success(snapshot, [], now_ms=2000)
            except SnapshotError:
                pass
            else:
                raise AssertionError('Symlink paths must not be written')
        snapshot.write_bytes(b'x' * (MAX_SNAPSHOT_BYTES + 1))
        assert read_snapshot(snapshot)['status'] == 'unavailable'
        if os.name == 'posix':
            # A parent-directory link is rejected as well as a leaf link.
            linked = parent / 'linked'
            linked.symlink_to(parent, target_is_directory=True)
            assert read_snapshot(linked / 'snapshot.json')['status'] == 'unavailable'
    assert not any(name in sys.modules for name in blocked)
    print(json.dumps({'web_runtime': 'ok', 'worker_dependencies_imported': False}))
''')


class WebRuntimeTests(unittest.TestCase):
    def test_production_urls_and_snapshot_get_do_not_import_worker_dependencies(self):
        backend = Path(__file__).resolve().parents[2]
        environment = {name: value for name, value in os.environ.items()
                       if name not in {'DJANGO_SETTINGS_MODULE', 'PYTHONPATH'}}
        result = subprocess.run([sys.executable, '-c', WEB_PROCESS], cwd=backend,
                                env=environment, capture_output=True, text=True,
                                timeout=30, check=False)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertIn('"worker_dependencies_imported": false', result.stdout)
