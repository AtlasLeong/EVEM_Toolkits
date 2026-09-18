"""Independent randomized oracle tests for the weighted route search.

The oracle below deliberately does not call ``RouteGraph._edge`` (or any
other production edge classifier).  It implements the routing rules directly
so that a search regression cannot make its own test pass.
"""

import math
import random
import unittest

from .A_Star import Galaxy, LIGHT_YEAR_METERS, a_star


_SAFE_SECURITY = (0.0, 0.2, 0.49, 0.5, 0.9)
_NEGATIVE_SECURITY = (-0.9, -0.2, -0.01)
_SECURITY_CHOICES = _SAFE_SECURITY + _NEGATIVE_SECURITY


def _system_kind(system):
    """Classify security independently of ``Galaxy.type``."""

    security = float(system.security_status)
    if security < 0:
        return "negative"
    if security < 0.5:
        return "low"
    return "high"


def _is_safe(system):
    return _system_kind(system) in ("high", "low")


def _is_negative(system):
    return _system_kind(system) == "negative"


def _oracle_distance(current, neighbour):
    """Use the same unrounded coordinate expression as production distance()."""

    dx = neighbour.x - current.x
    dy = neighbour.y - current.y
    dz = neighbour.z - current.z
    return math.sqrt(dx ** 2 + dy ** 2 + dz ** 2)


def _oracle_edge(current, neighbour, max_distance, allow_dirt, passed_high_low, gates):
    """Return ``(move_type, cost)`` under the routing specification."""

    if int(current.system_id) == int(neighbour.system_id):
        return None

    actual_distance = _oracle_distance(current, neighbour)
    is_gate = int(neighbour.system_id) in gates.get(int(current.system_id), ())

    if allow_dirt and is_gate:
        if _is_safe(current) and _is_safe(neighbour):
            return "土路", 0.0
        if _is_negative(current) and _is_safe(neighbour) and not passed_high_low:
            return "土路", 0.0
        if _is_negative(current) and _is_negative(neighbour) and actual_distance > 9:
            return "土路", 0.0

    if not math.isfinite(actual_distance) or not 0 < actual_distance <= max_distance:
        return None
    if _is_safe(current) and _is_safe(neighbour):
        return "安全诱导", actual_distance
    return "不安全诱导", actual_distance * 1.5


def _oracle_best_label(nodes, gates, start, goal, max_distance, allow_dirt):
    """Bellman-Ford over ``(system_id, passed_high_low)`` states.

    Labels are ordered by ``(cost, hops)``.  This is intentionally separate
    from the production priority queue and edge implementation.
    """

    by_id = {int(node.system_id): node for node in nodes}
    start_id = int(start.system_id)
    goal_id = int(goal.system_id)
    labels = {(start_id, False): (0.0, 0)}
    state_count = len(by_id) * 2

    for _ in range(max(0, state_count - 1)):
        updated = dict(labels)
        changed = False
        for (current_id, passed_high_low), label in labels.items():
            current = by_id[current_id]
            for neighbour in nodes:
                edge = _oracle_edge(
                    current,
                    neighbour,
                    max_distance,
                    allow_dirt,
                    passed_high_low,
                    gates,
                )
                if edge is None:
                    continue
                _, move_cost = edge
                neighbour_id = int(neighbour.system_id)
                next_state = (
                    neighbour_id,
                    passed_high_low or (_is_safe(current) and _is_negative(neighbour)),
                )
                candidate = (label[0] + move_cost, label[1] + 1)
                if candidate < updated.get(next_state, (math.inf, math.inf)):
                    updated[next_state] = candidate
                    changed = True
        labels = updated
        if not changed:
            break

    goal_labels = [label for (system_id, _), label in labels.items() if system_id == goal_id]
    return min(goal_labels) if goal_labels else None


def _route_label_and_validate(test_case, path, nodes, gates, max_distance, allow_dirt):
    """Validate every production edge and return its independently computed label."""

    if path is None:
        return None

    test_case.assertGreaterEqual(len(path), 2)
    by_id = {int(node.system_id): node for node in nodes}
    current = path[0][0]
    test_case.assertIs(by_id[int(current.system_id)], current)
    passed_high_low = False
    total_cost = 0.0

    for (current, _), (neighbour, move_type) in zip(path, path[1:]):
        test_case.assertIs(by_id[int(current.system_id)], current)
        test_case.assertIs(by_id[int(neighbour.system_id)], neighbour)
        edge = _oracle_edge(
            current,
            neighbour,
            max_distance,
            allow_dirt,
            passed_high_low,
            gates,
        )
        test_case.assertIsNotNone(
            edge,
            msg=(
                f"production route used an illegal edge "
                f"{current.system_id}->{neighbour.system_id}"
            ),
        )
        expected_move_type, move_cost = edge
        test_case.assertEqual(expected_move_type, move_type)
        total_cost += move_cost
        passed_high_low = passed_high_low or (
            _is_safe(current) and _is_negative(neighbour)
        )

    return total_cost, len(path) - 1


def _has_zero_cost_ring(nodes, gates):
    """Detect a directed cycle consisting only of safe systems and gates."""

    by_id = {int(node.system_id): node for node in nodes}
    safe_ids = {system_id for system_id, node in by_id.items() if _is_safe(node)}
    for start in safe_ids:
        stack = [(start, (start,))]
        while stack:
            current, visited = stack.pop()
            for destination in gates.get(current, ()):
                if destination not in safe_ids:
                    continue
                if destination == start and len(visited) >= 3:
                    return True
                if destination not in visited and len(visited) < len(safe_ids):
                    stack.append((destination, visited + (destination,)))
    return False


def _make_galaxies(case_index, security, coordinates):
    return tuple(
        Galaxy(
            system_id=index + 1,
            zh_name=f"oracle-{case_index}-{index}",
            x=x * LIGHT_YEAR_METERS,
            y=y * LIGHT_YEAR_METERS,
            z=z * LIGHT_YEAR_METERS,
            security_status=security[index],
        )
        for index, (x, y, z) in enumerate(coordinates)
    )


def _make_case(rng, case_index):
    """Create one deterministic integer-coordinate graph.

    A handful of initial cases pin down important boundaries; the remaining
    cases are seeded random graphs that vary node count, security and gates.
    """

    if case_index == 0:
        nodes = _make_galaxies(case_index, (0.6, 0.2, 0.9), ((0, 0, 0), (10, 0, 0), (20, 0, 0)))
        return nodes, {1: {2}, 2: {3}, 3: {1}}, 1.0, True
    if case_index == 1:
        nodes = _make_galaxies(case_index, (-0.2, 0.0, 0.2, -0.9), ((0, 0, 0), (2, 0, 0), (4, 0, 0), (6, 0, 0)))
        return nodes, {1: {2}, 2: {1}, 3: {4}, 4: {3}}, 2.0, False
    if case_index == 2:
        nodes = _make_galaxies(case_index, (-0.2, -0.9, -0.01), ((0, 0, 0), (10, 0, 0), (20, 0, 0)))
        return nodes, {1: {2}, 2: {1, 3}, 3: {2}}, 1.0, True
    if case_index == 3:
        nodes = _make_galaxies(case_index, (-0.2, -0.9, -0.01), ((0, 0, 0), (9, 0, 0), (18, 0, 0)))
        return nodes, {1: {2}, 2: {3}}, 1.0, True
    if case_index == 4:
        nodes = _make_galaxies(case_index, (0.6, -0.2, 0.2), ((0, 0, 0), (10, 0, 0), (20, 0, 0)))
        return nodes, {1: {2}, 2: {3}}, 1.0, True
    if case_index == 5:
        nodes = _make_galaxies(case_index, (-0.2, 0.2, -0.2), ((0, 0, 0), (10, 0, 0), (20, 0, 0)))
        return nodes, {1: {2}, 2: {3}}, 1.0, True
    if case_index == 255:
        nodes = _make_galaxies(case_index, (0.6, -0.2, 0.0), ((0, 0, 0), (30, 0, 0), (60, 0, 0)))
        return nodes, {}, 1.0, False

    node_count = rng.randint(3, 7)
    x_values = sorted(rng.sample(range(0, 31), node_count))
    coordinates = tuple((x, 0, 0) for x in x_values)
    security = [rng.choice(_SECURITY_CHOICES) for _ in range(node_count)]
    if case_index % 7 == 0:
        security[0] = 0.0
    if case_index % 11 == 0:
        security[-1] = -0.2
    nodes = _make_galaxies(case_index, tuple(security), coordinates)

    gates = {index: set() for index in range(1, node_count + 1)}
    for source in range(1, node_count + 1):
        for destination in range(1, node_count + 1):
            if source != destination and rng.random() < 0.22:
                gates[source].add(destination)
    if case_index % 17 == 0:
        gates[1].add(2)
        gates[2].add(1)
    if case_index % 19 == 0:
        gates[1].add(node_count)
    gates = {source: destinations for source, destinations in gates.items() if destinations}
    return nodes, gates, float(rng.randint(1, 14)), bool(case_index % 2 == 0)


class RoutingOracleTests(unittest.TestCase):
    def test_seeded_small_graphs_match_independent_oracle(self):
        rng = random.Random(0x5EED_2026)
        cases = [_make_case(rng, case_index) for case_index in range(256)]
        self.assertGreaterEqual(len(cases), 200)
        self.assertLessEqual(len(cases), 500)

        saw_zero_security = False
        saw_zero_cost_ring = False
        saw_directed_gate = False
        saw_bidirectional_gate = False
        saw_allow_dirt = set()
        saw_unreachable = False

        for case_index, (nodes, gates, max_distance, allow_dirt) in enumerate(cases):
            saw_allow_dirt.add(allow_dirt)
            saw_zero_security |= any(node.security_status == 0 for node in nodes)
            saw_zero_cost_ring |= _has_zero_cost_ring(nodes, gates)
            for source, destinations in gates.items():
                for destination in destinations:
                    if source in gates.get(destination, set()):
                        saw_bidirectional_gate = True
                    else:
                        saw_directed_gate = True

            start, goal = nodes[0], nodes[-1]
            expected = _oracle_best_label(
                nodes,
                gates,
                start,
                goal,
                max_distance,
                allow_dirt,
            )
            with self.subTest(case=case_index, allow_dirt=allow_dirt, radius=max_distance):
                path = a_star(
                    start,
                    goal,
                    max_distance,
                    nodes,
                    gates if allow_dirt else {},
                    gates,
                )
                actual = _route_label_and_validate(
                    self,
                    path,
                    nodes,
                    gates,
                    max_distance,
                    allow_dirt,
                )

                if expected is None:
                    saw_unreachable = True
                    self.assertIsNone(path)
                else:
                    self.assertIsNotNone(path)
                    self.assertIsNotNone(actual)
                    self.assertEqual(expected[1], actual[1])
                    self.assertTrue(
                        math.isclose(expected[0], actual[0], rel_tol=1e-12, abs_tol=1e-12),
                        msg=f"expected label {expected}, actual {actual}",
                    )

                reversed_path = a_star(
                    start,
                    goal,
                    max_distance,
                    tuple(reversed(nodes)),
                    gates if allow_dirt else {},
                    gates,
                )
                if path is None:
                    self.assertIsNone(reversed_path)
                else:
                    self.assertIsNotNone(reversed_path)
                    self.assertEqual(
                        [int(node.system_id) for node, _ in path],
                        [int(node.system_id) for node, _ in reversed_path],
                    )

        self.assertEqual(saw_allow_dirt, {False, True})
        self.assertTrue(saw_zero_security)
        self.assertTrue(saw_zero_cost_ring)
        self.assertTrue(saw_directed_gate)
        self.assertTrue(saw_bidirectional_gate)
        self.assertTrue(saw_unreachable)


if __name__ == "__main__":
    unittest.main()
