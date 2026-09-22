"""Catalog tests use miniature SQLite fixtures, never a production database."""

import hashlib
import importlib
import json
import sqlite3
import tempfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

from django.db import connection
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.exceptions import APIException, ValidationError

from TacticalBoard.models import BoardConstellations, BoardRegions, BoardSystems


def create_ship_fixture(path):
    with closing(sqlite3.connect(path)) as db, db:
        db.executescript('''
            PRAGMA user_version=218811;
            CREATE TABLE items (id INTEGER PRIMARY KEY, sourceName TEXT, nameKey INTEGER,
                                marketGroupId INTEGER, published INTEGER);
            CREATE TABLE localised_strings (id INTEGER PRIMARY KEY, source TEXT, zhcn TEXT,
                                            zh TEXT, en TEXT);
            CREATE TABLE "groups" (id INTEGER PRIMARY KEY, localisedNameIndex INTEGER,
                                   sourceName TEXT);
            CREATE TABLE market_group (id INTEGER PRIMARY KEY, sourceName TEXT);
        ''')
        db.executemany('INSERT INTO market_group VALUES (?, ?)', [
            (100000002, '护卫舰-复数'), (100001000, '驱逐舰-复数'), (200000000, '其他'),
        ])
        db.executemany('INSERT INTO "groups" VALUES (?, ?, ?)', [
            (10100, 900, '源护卫舰'), (10200, 901, '源驱逐舰'), (20100, 902, '非舰船'),
        ])
        db.executemany('INSERT INTO localised_strings VALUES (?, ?, ?, ?, ?)', [
            (900, '源护卫舰', '护卫舰', '護衛艦', 'Frigate'),
            (901, '源驱逐舰', '驱逐舰', '驅逐艦', 'Destroyer'),
            (902, '非舰船', '非舰船', '非舰船', 'Other'),
        ])
        for index in range(25):
            db.execute('INSERT INTO items VALUES (?, ?, ?, ?, ?)',
                       (10100000000 + index, '源名%d' % index, index, 100000002, 0))
            db.execute('INSERT INTO localised_strings VALUES (?, ?, ?, ?, ?)',
                       (index, '源名%d' % index, '本地护卫%02d' % index,
                        '繁体护卫%02d' % index, 'Frigate Alias %02d' % index))
        db.execute('INSERT INTO localised_strings VALUES (?, ?, ?, ?, ?)',
                   (100, '源驱逐', '本地驱逐', '繁体驱逐', 'Destroyer'))
        db.executemany('INSERT INTO items VALUES (?, ?, ?, ?, ?)', [
            (10200000001, '源驱逐', 100, 100001000, 0),
            (10100000101, '非市场NPC', 0, 0, 0),
            (10100000102, '其他市场', 0, 200000000, 0),
            (10100000103, '不存在市场', 0, 100000099, 0),
            (20100000000, '非舰船类别', 0, 100000002, 0),
        ])
    return hashlib.sha256(path.read_bytes()).hexdigest()


class CatalogImportMixin:
    def load_catalog(self):
        try:
            return importlib.import_module('Starsea.catalog')
        except ModuleNotFoundError as exc:
            if exc.name == 'Starsea.catalog':
                self.fail('The read-only Starsea catalog API has not been implemented.')
            raise


class ShipCatalogTests(CatalogImportMixin, SimpleTestCase):
    def setUp(self):
        self.catalog = self.load_catalog()
        self.temp = tempfile.TemporaryDirectory(prefix='starsea-catalog-test-')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'echoes.db'
        digest = create_ship_fixture(self.path)
        self.enterContext(patch.object(self.catalog, 'PINNED_SHA256', digest))
        self.enterContext(override_settings(STARSEA_SHIP_DB=str(self.path)))
        self.catalog._load_catalog.cache_clear()
        self.addCleanup(self.catalog._load_catalog.cache_clear)

    def test_market_ship_filter_and_twenty_row_page(self):
        page = self.catalog.search_ships()
        self.assertEqual(page['count'], 26)
        self.assertEqual(len(page['results']), 20)
        self.assertEqual(page['source_version'], 'SWEET 218811')
        self.assertIn('不代表当前国服完整', page['notice'])
        self.assertEqual(page['results'][0], {
            'id': 10100000000, 'name': '本地护卫00', 'ship_class': '护卫舰',
            'source_version': 'SWEET 218811',
        })

    def test_second_page_and_exhausted_page_are_stable(self):
        self.assertEqual(len(self.catalog.search_ships(page='2')['results']), 6)
        self.assertEqual(self.catalog.search_ships(page=3)['results'], [])

    def test_search_uses_only_sourced_localized_aliases_case_insensitively(self):
        for text in ('本地护卫00', '繁体护卫00', '源名0', 'fRiGaTe aLiAs 00'):
            with self.subTest(text=text):
                self.assertEqual(self.catalog.search_ships(q=text)['results'][0]['id'], 10100000000)

    def test_class_filter_is_exact_and_combines_with_search(self):
        self.assertEqual(self.catalog.search_ships(ship_class='驱逐舰')['count'], 1)
        self.assertEqual(self.catalog.search_ships(q='护卫', ship_class='驱逐舰')['count'], 0)

    def test_search_metacharacters_are_literal(self):
        self.assertEqual(self.catalog.search_ships(q="%' OR 1=1 --")['count'], 0)
        self.assertEqual(self.catalog.search_ships(q='%')['count'], 0)

    def test_resolve_ship_returns_canonical_fresh_snapshot(self):
        row = self.catalog.resolve_ship(10100000000)
        row['name'] = '伪造'
        self.assertEqual(self.catalog.resolve_ship(10100000000)['name'], '本地护卫00')

    def test_unknown_or_excluded_ship_is_bad_request(self):
        for ship_id in (7, 10100000101, 10100000102, 10100000103, 20100000000):
            with self.subTest(ship_id=ship_id), self.assertRaises(ValidationError):
                self.catalog.resolve_ship(ship_id)

    def test_json_ship_id_requires_positive_integer(self):
        for ship_id in (True, None, '10100000000', 1.5, [], -1, 0):
            with self.subTest(ship_id=ship_id), self.assertRaises(ValidationError):
                self.catalog.resolve_ship(ship_id)

    def test_query_and_page_bounds(self):
        invalid_calls = [dict(q='x' * 81), dict(q=[]), dict(ship_class='x' * 81),
                         dict(ship_class={}), dict(page=0), dict(page=-1), dict(page=True),
                         dict(page='1.0'), dict(page=1.5), dict(page=10001)]
        for kwargs in invalid_calls:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                self.catalog.search_ships(**kwargs)

    def test_ship_search_rejects_invalid_unicode_and_controls(self):
        for value in ('\ud800', '\udfff', '\x00', '名字\n伪造', '\x7f'):
            for field in ('q', 'ship_class'):
                with self.subTest(value=ascii(value), field=field), self.assertRaises(ValidationError):
                    self.catalog.search_ships(**{field: value})

    def test_missing_relative_or_remote_source_returns_safe_503(self):
        for value in ('', 'echoes.db', str(self.path.parent / 'missing.db'), '//server/share/echoes.db'):
            with self.subTest(value=value), override_settings(STARSEA_SHIP_DB=value):
                with self.assertRaises(APIException) as raised:
                    self.catalog.search_ships()
                self.assertEqual(raised.exception.status_code, 503)
                self.assertNotIn(str(self.path.parent), str(raised.exception.detail))

    def test_hash_mismatch_is_rejected(self):
        with patch.object(self.catalog, 'PINNED_SHA256', '0' * 64):
            with self.assertRaises(APIException) as raised:
                self.catalog.search_ships()
        self.assertEqual(raised.exception.status_code, 503)

    def test_version_mismatch_is_rejected_even_with_matching_hash(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('PRAGMA user_version=1')
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with patch.object(self.catalog, 'PINNED_SHA256', digest):
            with self.assertRaises(APIException) as raised:
                self.catalog.search_ships()
        self.assertEqual(raised.exception.status_code, 503)

    def test_source_schema_failure_is_safe_503(self):
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute('DROP TABLE items')
        digest = hashlib.sha256(self.path.read_bytes()).hexdigest()
        with patch.object(self.catalog, 'PINNED_SHA256', digest):
            with self.assertRaises(APIException) as raised:
                self.catalog.search_ships()
        self.assertEqual(raised.exception.status_code, 503)

    def test_cached_source_is_revalidated_after_file_changes(self):
        self.catalog.search_ships()
        with closing(sqlite3.connect(self.path)) as db, db:
            db.execute("UPDATE localised_strings SET zhcn='已修改' WHERE id=0")
        with self.assertRaises(APIException) as raised:
            self.catalog.search_ships()
        self.assertEqual(raised.exception.status_code, 503)

    def test_unchanged_source_reuses_catalog_without_rehashing(self):
        self.catalog.search_ships()
        misses = self.catalog._load_catalog.cache_info().misses
        self.catalog.search_ships(q='护卫')
        self.assertEqual(self.catalog._load_catalog.cache_info().misses, misses)

    def test_read_does_not_change_source_or_create_sqlite_sidecars(self):
        before = self.path.read_bytes()
        self.catalog.search_ships()
        self.catalog.resolve_ship(10100000000)
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.iterdir()), [self.path])

    def test_independent_audit_agrees_with_every_api_catalog_record(self):
        script = Path(__file__).resolve().parents[2] / 'scripts' / 'starsea' / 'catalog_audit.py'
        self.assertTrue(script.is_file(), 'The reproducible read-only catalog audit is missing.')
        spec = importlib.util.spec_from_file_location('starsea_catalog_audit', script)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        report = module.audit_catalog(self.path)
        self.assertEqual(report['catalog_count'], 26)
        self.assertEqual(report['api_matches_source'], True)
        self.assertEqual(report['source_unchanged'], True)
        self.assertEqual(report['user_version'], 218811)


class LocationCatalogTests(CatalogImportMixin, TestCase):
    @classmethod
    def setUpClass(cls):
        cls.created_tables = []
        existing = connection.introspection.table_names()
        with connection.schema_editor() as editor:
            for model in (BoardRegions, BoardConstellations, BoardSystems):
                if model._meta.db_table not in existing:
                    editor.create_model(model)
                    cls.created_tables.append(model)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            for model in reversed(cls.created_tables):
                editor.delete_model(model)

    def setUp(self):
        self.catalog = self.load_catalog()
        for index in (1, 2):
            BoardRegions.objects.create(region_id=index, name='Region %d' % index, zh_name='星域%d' % index)
            BoardConstellations.objects.create(constellation_id=index * 10, region_id=index,
                                               name='Constellation %d' % index, zh_name='星座%d' % index)
            BoardSystems.objects.create(system_id=index * 100, constellation_id=index * 10,
                                        name='System %d' % index, zh_name='星系%d' % index, security_status=0.5)

    def test_parent_scoped_catalog_uses_canonical_names_and_security(self):
        self.assertEqual(self.catalog.search_locations('regions')['results'][0],
                         {'id': 1, 'name': '星域1', 'security': None})
        self.assertEqual(self.catalog.search_locations('constellations', parent_id='1')['results'],
                         [{'id': 10, 'name': '星座1', 'security': None}])
        self.assertEqual(self.catalog.search_locations('systems', parent_id=10)['results'],
                         [{'id': 100, 'name': '星系1', 'security': 0.5}])

    def test_location_search_covers_source_and_localized_names(self):
        self.assertEqual(len(self.catalog.search_locations('regions', q='Region 1')['results']), 1)
        self.assertEqual(len(self.catalog.search_locations('regions', q='星域1')['results']), 1)

    def test_child_catalog_requires_known_parent(self):
        for kind, parent in (('constellations', None), ('systems', None), ('systems', 999),
                             ('constellations', 999), ('regions', 1)):
            with self.subTest(kind=kind, parent=parent), self.assertRaises(ValidationError):
                self.catalog.search_locations(kind, parent_id=parent)

    def test_region_only_snapshot_is_allowed_without_invented_security(self):
        self.assertEqual(self.catalog.resolve_location({'region_id': 1}), {
            'region_id': 1, 'region_name': '星域1', 'constellation_id': None,
            'constellation_name': None, 'solarsystem_id': None, 'solarsystem_name': None,
            'security': None,
        })

    def test_complete_snapshot_is_independent_of_future_source_name_changes(self):
        result = self.catalog.resolve_location({'region_id': 1, 'constellation_id': 10, 'solarsystem_id': 100})
        BoardSystems.objects.filter(pk=100).update(zh_name='后来改名')
        self.assertEqual(result['solarsystem_name'], '星系1')
        self.assertEqual(result['security'], 0.5)

    def test_constellation_only_and_missing_location_are_supported(self):
        result = self.catalog.resolve_location({'region_id': 1, 'constellation_id': 10})
        self.assertIsNone(result['solarsystem_id'])
        self.assertEqual(result['constellation_name'], '星座1')
        self.assertIsNone(self.catalog.resolve_location(None))

    def test_invalid_location_hierarchy_ids_and_unknown_keys_rejected(self):
        invalid = [[], {}, {'region_id': True}, {'region_id': '1'}, {'region_id': 999},
                   {'region_id': 1, 'constellation_id': 20},
                   {'region_id': 1, 'constellation_id': 10, 'solarsystem_id': 200},
                   {'region_id': 1, 'solarsystem_id': 100}, {'constellation_id': 10},
                   {'region_id': 1, 'region_name': '伪造'}]
        for ids in invalid:
            with self.subTest(ids=ids), self.assertRaises(ValidationError):
                self.catalog.resolve_location(ids)

    def test_nonfinite_security_becomes_null_in_results_and_snapshot(self):
        BoardSystems.objects.filter(pk=100).update(security_status=float('inf'))
        result = self.catalog.search_locations('systems', parent_id=10)
        self.assertIsNone(result['results'][0]['security'])
        snap = self.catalog.resolve_location({'region_id': 1, 'constellation_id': 10, 'solarsystem_id': 100})
        self.assertIsNone(snap['security'])
        json.dumps(snap, allow_nan=False)

    def test_blank_localization_falls_back_to_sourced_name(self):
        BoardSystems.objects.filter(pk=100).update(zh_name='')
        self.assertEqual(self.catalog.search_locations('systems', parent_id=10)['results'][0]['name'], 'System 1')

    def test_child_results_are_bounded(self):
        BoardSystems.objects.bulk_create([
            BoardSystems(system_id=1000 + index, constellation_id=10, name='S%d' % index)
            for index in range(110)
        ])
        self.assertEqual(len(self.catalog.search_locations('systems', parent_id=10)['results']), 100)

    def test_invalid_location_query_bounds_are_bad_request(self):
        for kwargs in (dict(kind='bogus'), dict(kind=[]), dict(kind='regions', q='x' * 81),
                       dict(kind='systems', parent_id=True), dict(kind='regions', q=[])):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValidationError):
                self.catalog.search_locations(**kwargs)

    def test_location_search_rejects_invalid_unicode_and_controls(self):
        for value in ('\ud800', '\udfff', '\x00', '星域\n伪造', '\x7f'):
            with self.subTest(value=ascii(value)), self.assertRaises(ValidationError):
                self.catalog.search_locations('regions', q=value)

    def test_missing_geography_tables_returns_safe_503(self):
        from django.db.utils import OperationalError
        with patch.object(BoardRegions.objects, 'all', side_effect=OperationalError('private database path')):
            with self.assertRaises(APIException) as raised:
                self.catalog.search_locations('regions')
        self.assertEqual(raised.exception.status_code, 503)
        self.assertNotIn('private database path', str(raised.exception.detail))

    def test_uninitialized_geography_is_unavailable_not_fake_empty_success(self):
        BoardSystems.objects.all().delete()
        BoardConstellations.objects.all().delete()
        BoardRegions.objects.all().delete()
        with self.assertRaises(APIException) as raised:
            self.catalog.search_locations('regions')
        self.assertEqual(raised.exception.status_code, 503)
