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
