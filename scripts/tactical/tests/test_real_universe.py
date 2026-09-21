"""Local-only static universe ingestion: validate public input before writes."""
import copy
import gzip
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


MODULE = Path(__file__).resolve().parents[1] / 'real_universe.py'


def fixture():
    regions = [{'region_id': 10000001, 'zh_name': '德里克'}]
    constellations = [
        {'constellation_id': 20000001, 'region_id': 10000001, 'zh_name': '姗玛塔尔', 'x': 0, 'y': 1, 'z': 2},
        {'constellation_id': 20000002, 'region_id': 10000070, 'zh_name': None, 'x': 1, 'y': 2, 'z': 3},
    ]
    systems = [{'system_id': 30000001 + index, 'zh_name': f'真实星系{index}',
                'security_status': -.2 if index else 0, 'x': index * 1e15, 'y': 7, 'z': index * -2e15}
               for index in range(5)]
    relations = [{'ss_id': str(row['system_id']), 'ss_title': row['zh_name'],
                  'ss_constellation_id': '20000001', 'ss_constellation_title': '姗玛塔尔',
                  'ss_region_id': '10000001', 'ss_safetylvl': '0.00'} for row in systems]
    gates = [{'stargate_id': 50000001, 'system_id': 30000001,
              'destination_system_id': 30000002, 'destination_stargate_id': 50000002},
             {'stargate_id': 50000002, 'system_id': 30000002,
              'destination_system_id': 30000001, 'destination_stargate_id': 50000001},
             {'stargate_id': 50000003, 'system_id': 30000001,
              'destination_system_id': 30003100, 'destination_stargate_id': 50000004}]
    return regions, constellations, systems, gates, relations


class RealUniverseTests(unittest.TestCase):
    def load(self):
        self.assertTrue(MODULE.exists(), 'real static universe importer is missing')
        spec = importlib.util.spec_from_file_location('tactical_real_universe', MODULE)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def test_normalizes_exact_id_hierarchy_and_records_missing_public_endpoints(self):
        module = self.load()
        result = module.normalize_snapshot(*fixture())
        self.assertEqual(len(result['systems']), 5)
        self.assertEqual(result['systems'][0]['constellation_id'], 20000001)
        self.assertEqual(result['systems'][0]['region_id'], 10000001)
        self.assertEqual(result['systems'][0]['security_status'], 0)
        self.assertEqual(len(result['constellations']), 1)
        self.assertEqual(len(result['stargates']), 2)
        self.assertEqual(result['metadata']['omissions']['missing_gate_system_ids'], [30003100])
        self.assertEqual(result['metadata']['omissions']['excluded_gate_rows'], 1)
        self.assertEqual(result['metadata']['omissions']['excluded_constellation_ids'], [20000002])
        self.assertEqual(result['metadata']['counts']['undirected_gate_pairs'], 1)

    def test_rejects_duplicate_invalid_ids_names_and_nonfinite_coordinates(self):
        module = self.load()
        for key, value in [('system_id', True), ('system_id', '030000001'),
                           ('system_id', -1), ('zh_name', ''), ('zh_name', ' 星系 '),
                           ('x', None), ('x', float('inf')), ('z', float('nan')),
                           ('z', '123'), ('y', False), ('security_status', '0.5')]:
            source = fixture()
            source[2][0][key] = value
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                module.normalize_snapshot(*source)
        for index in range(5):
            source = fixture()
            source[index].append(copy.deepcopy(source[index][0]))
            with self.subTest(duplicate_table=index), self.assertRaises(ValueError):
                module.normalize_snapshot(*source)

    def test_refuses_missing_or_conflicting_id_relationships_instead_of_guessing(self):
        module = self.load()
        for field, value in [('ss_id', '39999999'), ('ss_title', '近似名称'),
                             ('ss_constellation_id', '20000999'), ('ss_region_id', '10000002'),
                             ('ss_constellation_title', '不同星座')]:
            source = fixture()
            source[4][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                module.normalize_snapshot(*source)

    def test_digest_is_stable_under_input_order_and_changes_with_static_content(self):
        module = self.load()
        original = module.normalize_snapshot(*fixture())
        reversed_input = [list(reversed(rows)) for rows in fixture()]
        self.assertEqual(original['metadata']['sha256'], module.normalize_snapshot(*reversed_input)['metadata']['sha256'])
        changed = fixture()
        changed[2][0]['x'] = 1
        self.assertNotEqual(original['metadata']['sha256'], module.normalize_snapshot(*changed)['metadata']['sha256'])
        self.assertEqual(len(original['metadata']['sha256']), 64)

    def test_fetcher_uses_only_fixed_public_get_sources_with_bounded_batches(self):
        module = self.load()
        source = fixture()
        responses = dict(zip(['boardregions', 'boardconstellations', 'boardsystems', 'boardstargate'], source[:4]))
        requests = []

        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'application/json'}

        class Opener:
            def open(self, request, timeout):
                requests.append((request, timeout))
                endpoint = request.full_url.split('/api/')[1]
                data = source[4] if endpoint.startswith('solarsystem?') else responses[endpoint]
                return Response(json.dumps(data).encode())

        with patch.object(module, 'build_opener', return_value=Opener()):
            result = module.fetch_snapshot()
        self.assertTrue(result['metadata']['retrieved_at'].endswith('+00:00'))
        self.assertEqual(result['metadata']['source_url'], 'https://evemtk.com/api')
        self.assertEqual(len(requests), 5)
        for request, timeout in requests:
            self.assertEqual(request.get_method(), 'GET')
            self.assertTrue(request.full_url.startswith('https://evemtk.com/api/'))
            self.assertNotIn('Authorization', request.headers)
            self.assertIsNone(request.data)
            self.assertGreater(timeout, 0)
            self.assertLessEqual(timeout, 30)
        self.assertEqual(module.constellation_batches(list(range(201))), [list(range(100)), list(range(100, 200)), [200]])

    def test_fetcher_refuses_redirects_overlarge_bodies_and_non_json(self):
        module = self.load()
        from urllib.error import HTTPError
        from urllib.request import Request
        with self.assertRaises(HTTPError):
            module.NoRedirect().redirect_request(Request('https://evemtk.com/api/regions'), None, 302, 'redirect', {}, 'http://example.invalid/')
        for data, headers in [(b'[]', {'Content-Type': 'text/html'}),
                              (b'[', {'Content-Type': 'application/json'}),
                              (b'{}', {'Content-Type': 'application/json'}),
                              (b'[]', {'Content-Type': 'application/json', 'Content-Length': str(20 * 1024 * 1024)})]:
            class Response(io.BytesIO):
                status = 200
            response = Response(data)
            response.headers = headers
            class Opener:
                def open(self, *args, **kwargs):
                    return response
            with self.subTest(headers=headers, data=data), self.assertRaises(ValueError):
                module.fetch_rows(Opener(), 'boardsystems')
        with self.assertRaises(ValueError):
            module.fetch_rows(None, 'https://example.invalid')

    def test_snapshot_path_is_fixed_and_rejects_symlinks_before_resolving(self):
        module = self.load()
        with tempfile.TemporaryDirectory() as directory:
            backend = Path(directory)
            target = backend / '.tactical-universe.json'
            self.assertEqual(module.snapshot_path(backend), target)
            with patch.object(Path, 'is_symlink', lambda path: path == target), self.assertRaises(ValueError):
                module.snapshot_path(backend)

    def test_fetcher_decodes_real_gate_endpoint_gzip_with_bounded_expansion(self):
        module = self.load()
        class Response(io.BytesIO):
            status = 200
            headers = {'Content-Type': 'application/json', 'Content-Encoding': 'gzip'}
        class Opener:
            def __init__(self, data):
                self.data = data
            def open(self, *args, **kwargs):
                return Response(self.data)
        gates = fixture()[3]
        try:
            decoded = module.fetch_rows(Opener(gzip.compress(json.dumps(gates).encode())), 'boardstargate')
        except ValueError as error:
            self.fail(f'The public stargate endpoint gzip is not supported: {error}')
        self.assertEqual(decoded, gates)
        # A tiny compressed response must not allocate its full expanded body.
        with patch.object(module, 'MAX_BODY_BYTES', 1024), self.assertRaises(ValueError):
            module.fetch_rows(Opener(gzip.compress(b' ' * 2048 + b'[]')), 'boardstargate')
        with self.assertRaises(ValueError):
            module.fetch_rows(Opener(b'not-gzip'), 'boardstargate')


if __name__ == '__main__':
    unittest.main()
