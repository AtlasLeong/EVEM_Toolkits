import threading
import unittest
from unittest.mock import patch

from .A_Star import Galaxy, RouteGraph
from .routing_data import (
    RouteSnapshot,
    SnapshotUnavailable,
    build_route_snapshot,
    get_route_snapshot,
    reset_route_snapshots,
)


LY = 9.461e15


def galaxy(system_id, name, x, security=0.6):
    return Galaxy(system_id, name, x * LY, 0, 0, security)


class RoutingSnapshotTests(unittest.TestCase):
    def setUp(self):
        reset_route_snapshots()

    def tearDown(self):
        reset_route_snapshots()

    def snapshot(self):
        start = galaxy(1, "起点", 0)
        goal = galaxy(2, "终点", 1)
        return RouteSnapshot(
            graph=RouteGraph([start, goal], {}),
            systems_by_name={"起点": start, "终点": goal},
            systems_by_id={1: start, 2: goal},
            new8_constellations=frozenset({11, 12}),
            system_constellations={"起点": 11, "终点": 12},
            constellation_regions={11: 10000027, 12: 10000018},
        )

    def test_snapshot_is_reused_until_ttl(self):
        first = self.snapshot()
        calls = []

        with patch("TacticalBoard.routing_data.build_route_snapshot", side_effect=lambda _: calls.append(1) or first):
            self.assertIs(get_route_snapshot(False, ttl=60), first)
            self.assertIs(get_route_snapshot(False, ttl=60), first)

        self.assertEqual(calls, [1])

    def test_expired_refresh_failure_is_not_reported_as_no_path(self):
        with patch("TacticalBoard.routing_data.build_route_snapshot", side_effect=RuntimeError("db down")), \
             patch("TacticalBoard.routing_data.logger.exception"):
            with self.assertRaises(SnapshotUnavailable):
                get_route_snapshot(True, ttl=0)

    def test_cross_new8_only_rejects_mixed_or_different_regions(self):
        snapshot = self.snapshot()
        self.assertTrue(snapshot.crosses_new8("起点", "终点"))
        self.assertFalse(snapshot.crosses_new8("起点", "起点"))

    def test_refreshes_for_high_and_low_modes_can_run_in_parallel(self):
        snapshots = {False: self.snapshot(), True: self.snapshot()}
        barrier = threading.Barrier(2)
        calls = []
        errors = []

        def build(mode):
            calls.append(mode)
            barrier.wait(timeout=2)
            return snapshots[mode]

        def load(mode):
            try:
                self.assertIs(get_route_snapshot(mode, ttl=60), snapshots[mode])
            except BaseException as error:  # surface worker assertion/errors below
                errors.append(error)

        with patch("TacticalBoard.routing_data.build_route_snapshot", side_effect=build):
            threads = [threading.Thread(target=load, args=(mode,)) for mode in (False, True)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join(timeout=3)

        self.assertFalse(any(thread.is_alive() for thread in threads))
        self.assertEqual(sorted(calls), [False, True])
        self.assertEqual(errors, [])

    def test_snapshot_rejects_duplicate_names_even_when_one_is_filtered(self):
        rows = [
            {
                "system_id": 1,
                "zh_name": "重复",
                "x": 0,
                "y": 0,
                "z": 0,
                "security_status": 0.6,
                "constellation_id": 11,
                "rounded_security": 0.6,
            },
            {
                "system_id": 2,
                "zh_name": "重复",
                "x": LY,
                "y": 0,
                "z": 0,
                "security_status": 0.2,
                "constellation_id": 11,
                "rounded_security": 0.2,
            },
        ]
        with patch("TacticalBoard.routing_data._base_system_queryset", return_value=rows), \
             patch("TacticalBoard.routing_data.BoardStargates.objects.values", return_value=[]), \
             patch("TacticalBoard.routing_data.BoardConstellations.objects.values", return_value=[]):
            with self.assertRaises(SnapshotUnavailable):
                build_route_snapshot(False)

    def test_snapshot_rejects_non_finite_coordinates(self):
        rows = [{
            "system_id": 1,
            "zh_name": "坏点",
            "x": float("nan"),
            "y": 0,
            "z": 0,
            "security_status": 0.2,
            "constellation_id": 11,
            "rounded_security": 0.2,
        }]
        with patch("TacticalBoard.routing_data._base_system_queryset", return_value=rows), \
             patch("TacticalBoard.routing_data.BoardStargates.objects.values", return_value=[]), \
             patch("TacticalBoard.routing_data.BoardConstellations.objects.values", return_value=[]):
            with self.assertRaises(SnapshotUnavailable):
                build_route_snapshot(False)


if __name__ == "__main__":
    unittest.main()
