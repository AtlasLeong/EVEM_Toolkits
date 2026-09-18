from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from .A_Star import Galaxy, RouteGraph
from .routing_data import RouteSnapshot, SnapshotUnavailable
from .views import AStarLocation


LY = 9.461e15


class RoutingApiTests(SimpleTestCase):
    def setUp(self):
        start = Galaxy(1, "起点", 0, 0, 0, 0.6)
        goal = Galaxy(2, "终点", LY, 0, 0, 0.6)
        self.snapshot = RouteSnapshot(
            graph=RouteGraph([start, goal], {}),
            systems_by_name={"起点": start, "终点": goal},
            systems_by_id={1: start, 2: goal},
            new8_constellations=frozenset(),
            system_constellations={},
            constellation_regions={},
        )
        self.factory = APIRequestFactory()

    def post(self, payload):
        request = self.factory.post("/jumppath", payload, format="json")
        return AStarLocation.as_view()(request)

    def test_invalid_radius_is_a_client_error_before_loading_map(self):
        with patch("TacticalBoard.views.get_route_snapshot") as load:
            response = self.post({"start_system": "起点", "end_system": "终点", "max_distance": "nan"})
        self.assertEqual(response.status_code, 400)
        load.assert_not_called()

    def test_route_response_uses_snapshot_graph(self):
        with patch("TacticalBoard.views.get_route_snapshot", return_value=self.snapshot):
            response = self.post(
                {"start_system": "起点", "end_system": "终点", "max_distance": 5, "dict_road": False}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data[0]["start"]["zh_name"], "起点")
        self.assertEqual(response.data[0]["end"]["zh_name"], "终点")
        self.assertEqual(response.data[0]["distance"], 1.0)

    def test_snapshot_failure_is_not_reported_as_no_path(self):
        with patch(
            "TacticalBoard.views.get_route_snapshot",
            side_effect=SnapshotUnavailable("down"),
        ):
            response = self.post(
                {"start_system": "起点", "end_system": "终点", "max_distance": 5}
            )
        self.assertEqual(response.status_code, 503)

