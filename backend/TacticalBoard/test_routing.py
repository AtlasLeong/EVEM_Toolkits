import math
import unittest

from .A_Star import Galaxy, RouteGraph, a_star, a_star_dirt_only, get_neighbors


LY = 9.461e15


def galaxy(system_id, name, x, security=0.6, y=0):
    return Galaxy(system_id, name, x * LY, y * LY, 0, security)


def names(path):
    return [node.zh_name for node, _ in path] if path else None


class ExactRoutingTests(unittest.TestCase):
    def test_equal_priority_nodes_do_not_crash(self):
        start = galaxy(1, "S", 0)
        left = galaxy(2, "L", 1, y=1)
        right = galaxy(3, "R", 1, y=-1)
        goal = galaxy(4, "G", 2)

        path = a_star(start, goal, 1.5, [start, left, right, goal], False, {})

        self.assertIn(names(path), (["S", "L", "G"], ["S", "R", "G"]))

    def test_weighted_cost_prefers_zero_cost_gate_shortcut(self):
        start = galaxy(1, "S", 0)
        detour = galaxy(2, "A", -1)
        goal = galaxy(3, "T", 4)

        path = a_star(start, goal, 4, [start, detour, goal], True, {2: {3}, 3: {2}})

        self.assertEqual(names(path), ["S", "A", "T"])
        self.assertEqual(path[2][1], "土路")

    def test_non_dirt_gate_edge_still_obeys_induction_range(self):
        start = galaxy(1, "S", 0)
        goal = galaxy(2, "T", 20, security=-0.2)

        path = a_star(start, goal, 5, [start, goal], True, {1: {2}, 2: {1}})

        self.assertIsNone(path)

    def test_search_keeps_both_passed_states(self):
        start = galaxy(1, "S", 0, security=-0.1)
        safe = galaxy(2, "A", -4)
        negative = galaxy(3, "N", -3, security=-0.1)
        goal = galaxy(4, "T", 5)
        gates = {1: {2}, 2: {1}, 3: {4}, 4: {3}}

        path = a_star(start, goal, 9, [start, safe, negative, goal], True, gates)

        self.assertEqual(names(path), ["S", "N", "T"])

    def test_equal_cost_prefers_fewer_hops(self):
        start = galaxy(1, "S", 0)
        one_hop = galaxy(2, "A", 2)
        via = galaxy(3, "B", 1)
        goal = galaxy(4, "T", 4)

        path = a_star(start, goal, 2, [start, one_hop, via, goal], False, {})

        self.assertEqual(names(path), ["S", "A", "T"])

    def test_negative_gate_rule_has_strict_nine_light_year_boundary(self):
        start = galaxy(1, "S", 0, security=-0.1)
        short = galaxy(2, "N", 9, security=-0.1)
        goal = galaxy(3, "T", 18, security=-0.1)
        gates = {1: {2}, 2: {1, 3}, 3: {2}}

        path = a_star(start, goal, 1, [start, short, goal], True, gates)

        self.assertIsNone(path)

    def test_dirt_only_helper_does_not_fall_back_to_induction(self):
        start = galaxy(1, "S", 0)
        gate_target = galaxy(2, "A", 20)
        goal = galaxy(3, "G", 21)
        gates = {1: {2}, 2: {1}}

        path = a_star_dirt_only(start, goal, 2, [start, gate_target, goal], gates)

        self.assertIsNone(path)

    def test_legacy_neighbor_helper_preserves_negative_gateway_state(self):
        negative = galaxy(1, "N", 0, security=-0.1)
        safe_gate = galaxy(2, "S", 20)
        nearby_negative = galaxy(3, "L", 1, security=-0.1)
        galaxies = [negative, safe_gate, nearby_negative]
        gates = {1: {2}, 2: {1}}

        unpassed = get_neighbors(negative, galaxies, 2, gates, False, True)
        passed = get_neighbors(negative, galaxies, 2, gates, True, True)

        self.assertEqual([node.zh_name for node in unpassed], ["S", "L"])
        self.assertEqual([node.zh_name for node in passed], ["L", "S"])

    def test_indexed_radius_includes_exact_boundary(self):
        start = galaxy(1, "S", 0)
        goal = galaxy(2, "G", 1)
        graph = RouteGraph([start, goal], {})

        self.assertEqual(graph._nearby_ids(1, 1), (2,))
        self.assertEqual(graph.find_route(start, goal, 1, allow_dirt=False)[-1][0], goal)

    def test_indexed_radius_handles_squared_distance_rounding(self):
        start = galaxy(1, "S", 26.697938290771432, y=61.27675078951282)
        goal = galaxy(2, "G", -20.95050635202405, y=-83.8078523765718)
        goal.z = -38.00046332910287
        radius = math.sqrt(
            (goal.x - start.x) ** 2
            + (goal.y - start.y) ** 2
            + (goal.z - start.z) ** 2
        )
        graph = RouteGraph([start, goal], {})

        self.assertEqual(graph._nearby_ids(1, radius), (2,))

    def test_allowed_ids_restricts_intermediate_nodes(self):
        start = galaxy(1, "S", 0)
        middle = galaxy(2, "M", 1)
        goal = galaxy(3, "G", 2)
        graph = RouteGraph([start, middle, goal], {})

        route = graph.find_route(start, goal, 1, allow_dirt=False, allowed_ids={1, 3})

        self.assertIsNone(route)


if __name__ == "__main__":
    unittest.main()
