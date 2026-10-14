"""Regression tests for the public star-map projection.

The local tactical preview seeds a small synthetic graph with ids in the
99,000,000 range.  Those rows are useful to the tactical-board fixture, but
must never leak into the ordinary ``/api/board*`` map or route snapshot.
"""

import gzip
import json

from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIRequestFactory

from .models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
from .routing_data import build_route_snapshot, reset_route_snapshots
from .views import (
    GetBoardConstellationsCoordinates,
    GetBoardRegionCoordinates,
    GetBoardSystemCoordinates,
    GetStarGateData,
)


class PublicStarMapScopeTests(TestCase):
    """Local-only fixture rows are hidden from the public map projection."""

    coordinate_endpoints = (
        (GetBoardRegionCoordinates, "regions", "region_id", ("region_id", "zh_name")),
        (
            GetBoardConstellationsCoordinates,
            "constellations",
            "constellation_id",
            ("constellation_id", "zh_name", "region_id", "x", "y", "z"),
        ),
        (
            GetBoardSystemCoordinates,
            "systems",
            "system_id",
            ("system_id", "zh_name", "security_status", "x", "y", "z"),
        ),
    )

    @classmethod
    def setUpClass(cls):
        cls.created_tables = []
        existing = connection.introspection.table_names()
        with connection.schema_editor() as editor:
            for model in (BoardRegions, BoardConstellations, BoardSystems, BoardStargates):
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
        cache.clear()
        reset_route_snapshots()
        self.addCleanup(reset_route_snapshots)
        self.factory = APIRequestFactory()

        # One real row and one local tactical-preview row for each static map
        # table.  The reserved ids mirror scripts/tactical/local_seed.py.
        BoardRegions.objects.create(region_id=10000001, name="Real", zh_name="真实星域")
        BoardRegions.objects.create(region_id=99000001, name="Synthetic", zh_name="演习星域")
        BoardConstellations.objects.create(
            constellation_id=20000001,
            region_id=10000001,
            name="Real constellation",
            zh_name="真实星座",
            x=1,
            y=0,
            z=1,
        )
        BoardConstellations.objects.create(
            constellation_id=99000101,
            region_id=99000001,
            name="Synthetic constellation",
            zh_name="演习星座",
            x=99,
            y=0,
            z=99,
        )
        BoardSystems.objects.create(
            system_id=30000001,
            constellation_id=20000001,
            name="Real system",
            zh_name="真实星系",
            x=1,
            y=0,
            z=1,
            security_status=0.6,
        )
        BoardSystems.objects.create(
            system_id=99001001,
            constellation_id=99000101,
            name="Synthetic system",
            zh_name="演习星系",
            x=99,
            y=0,
            z=99,
            security_status=0.6,
        )
        BoardStargates.objects.create(
            stargate_id=40000001,
            system_id=30000001,
            name="real gate",
            destination_system_id=30000001,
        )
        BoardStargates.objects.create(
            stargate_id=99002001,
            system_id=99001001,
            name="synthetic gate",
            destination_system_id=99001001,
        )

    @staticmethod
    def _ids(response, key):
        return {int(row[key]) for row in response.data}

    def _seed_large_coordinate_results(self):
        # Real ORM rows produce responses large enough to exercise gzip_page's
        # size threshold. Keep ids outside the deliberately excluded ranges.
        BoardRegions.objects.bulk_create([
            BoardRegions(
                region_id=10010000 + index,
                name=f"Static region {index}",
                zh_name=f"星图静态测试星域 {index}",
            )
            for index in range(256)
        ])
        BoardConstellations.objects.bulk_create([
            BoardConstellations(
                constellation_id=20010000 + index,
                region_id=10010000 + index,
                name=f"Static constellation {index}",
                zh_name=f"星图静态测试星座 {index}",
                x=(index + 1) * 1e16,
                y=0,
                z=(index + 1) * -1e16,
            )
            for index in range(256)
        ])
        BoardSystems.objects.bulk_create([
            BoardSystems(
                system_id=30010000 + index,
                constellation_id=20010000 + index,
                name=f"Static system {index}",
                zh_name=f"星图静态测试星系 {index}",
                security_status=0.6,
                x=(index + 1) * 1e16,
                y=0,
                z=(index + 1) * -1e16,
            )
            for index in range(256)
        ])

    def _render_coordinate_response(self, view, accept_encoding=None):
        headers = {"HTTP_ACCEPT": "application/json"}
        if accept_encoding is not None:
            headers["HTTP_ACCEPT_ENCODING"] = accept_encoding
        response = view.as_view()(self.factory.get("/api/board", **headers))
        # gzip_page defers middleware processing until a DRF Response is
        # rendered. Reading response.data alone would not exercise compression.
        response.render()
        self.assertEqual(response.status_code, 200)
        return response

    def test_coordinate_endpoints_compress_rendered_json_without_changing_projection(self):
        self._seed_large_coordinate_results()
        for view, _, _, fields in self.coordinate_endpoints:
            with self.subTest(view=view.__name__):
                plain = self._render_coordinate_response(view)
                compressed = self._render_coordinate_response(view, "gzip")

                self.assertEqual(compressed.get("Content-Encoding"), "gzip")
                self.assertIn("Accept-Encoding", compressed["Vary"].split(", "))
                self.assertEqual(gzip.decompress(compressed.content), plain.content)
                self.assertEqual(json.loads(gzip.decompress(compressed.content)), plain.data)
                self.assertEqual(compressed.data, plain.data)
                self.assertGreater(len(plain.data), 250)
                self.assertTrue(all(set(row) == set(fields) for row in compressed.data))
                self.assertLess(len(compressed.content), len(plain.content) / 2)

    def test_coordinate_endpoints_without_gzip_acceptance_return_plain_json(self):
        self._seed_large_coordinate_results()
        for view, _, _, _ in self.coordinate_endpoints:
            with self.subTest(view=view.__name__):
                response = self._render_coordinate_response(view)
                self.assertNotIn("Content-Encoding", response)
                self.assertEqual(json.loads(response.content), response.data)

    def test_gzip_requests_reuse_the_existing_python_list_cache_without_queries(self):
        self._seed_large_coordinate_results()
        for view, cache_name, _, _ in self.coordinate_endpoints:
            with self.subTest(view=view.__name__):
                with self.assertNumQueries(1):
                    plain = self._render_coordinate_response(view)
                cached_data = cache.get(f"board:{cache_name}:production:v1")
                self.assertIsInstance(cached_data, list)
                self.assertEqual(cached_data, plain.data)

                with self.assertNumQueries(0):
                    compressed = self._render_coordinate_response(view, "gzip")
                self.assertEqual(compressed.get("Content-Encoding"), "gzip")
                self.assertEqual(gzip.decompress(compressed.content), plain.content)

    def test_gzip_coordinate_cache_keeps_local_demo_filtering_separate(self):
        self._seed_large_coordinate_results()
        for view, cache_name, id_field, _ in self.coordinate_endpoints:
            with self.subTest(view=view.__name__):
                production = self._render_coordinate_response(view, "gzip")
                self.assertTrue(any(row[id_field] >= 99000000 for row in production.data))

                with override_settings(TACTICAL_LOCAL_DEMO=True):
                    with self.assertNumQueries(1):
                        local = self._render_coordinate_response(view, "gzip")
                    self.assertEqual(local.get("Content-Encoding"), "gzip")
                    self.assertTrue(all(row[id_field] < 99000000 for row in local.data))
                    self.assertEqual(json.loads(gzip.decompress(local.content)), local.data)
                    self.assertEqual(
                        cache.get(f"board:{cache_name}:local:v1"), local.data
                    )
                    with self.assertNumQueries(0):
                        local_cached = self._render_coordinate_response(view, "gzip")
                    self.assertEqual(local_cached.data, local.data)

                with self.assertNumQueries(0):
                    production_cached = self._render_coordinate_response(view, "gzip")
                self.assertEqual(production_cached.data, production.data)

    @override_settings(TACTICAL_LOCAL_DEMO=True)
    def test_public_board_endpoints_hide_reserved_local_rows(self):
        endpoints = (
            (GetBoardRegionCoordinates, "region_id", {10000001}),
            (GetBoardConstellationsCoordinates, "constellation_id", {20000001}),
            (GetBoardSystemCoordinates, "system_id", {30000001}),
        )
        for view, key, expected in endpoints:
            with self.subTest(view=view.__name__):
                response = view.as_view()(self.factory.get("/api/board"))
                self.assertEqual(response.status_code, 200)
                self.assertEqual(self._ids(response, key), expected)

        gate_response = GetStarGateData.as_view()(self.factory.get("/api/boardstargate"))
        gates = json.loads(gzip.decompress(gate_response.content).decode("utf-8"))
        self.assertEqual({int(row["stargate_id"]) for row in gates}, {40000001})

    @override_settings(TACTICAL_LOCAL_DEMO=True)
    def test_route_snapshot_hides_reserved_local_rows(self):
        snapshot = build_route_snapshot(in_high_security=True)
        self.assertEqual(set(snapshot.systems_by_id), {30000001})
        self.assertEqual(set(snapshot.systems_by_name), {"真实星系"})
        self.assertNotIn(99000101, snapshot.constellation_regions)
        self.assertNotIn(99001001, snapshot.graph.stargate_connections)
