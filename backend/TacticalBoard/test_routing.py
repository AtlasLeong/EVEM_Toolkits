import unittest

from .A_Star import Galaxy, a_star


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


if __name__ == "__main__":
    unittest.main()
