"""Exact route planning primitives for the tactical board.

The public helpers are kept for compatibility. RouteGraph owns immutable map
data; each search keeps its labels local because the rules depend on whether a
safe-to-negative transition has already happened.
"""

import heapq
import itertools
import math

try:
    import numpy as np
    from scipy.spatial import cKDTree
except ImportError:  # pragma: no cover - the pure-Python fallback is tested separately
    np = None
    cKDTree = None


LIGHT_YEAR_METERS = 9.461e15
SAFE_TYPES = frozenset(("high", "low"))
NEGATIVE_TYPE = "negative"


class Galaxy:
    def __init__(self, system_id, zh_name, x, y, z, security_status):
        self.system_id = system_id
        self.zh_name = zh_name
        self.x = float(x) / LIGHT_YEAR_METERS
        self.y = float(y) / LIGHT_YEAR_METERS
        self.z = float(z) / LIGHT_YEAR_METERS
        self.security_status = float(security_status)
        self.type = self.get_system_type(self.security_status)

    @staticmethod
    def get_system_type(security_status):
        if security_status < 0:
            return NEGATIVE_TYPE
        if security_status < 0.5:
            return "low"
        return "high"

    def __str__(self):
        return (
            f"{self.system_id} ({self.zh_name}): "
            f"({self.x:.2f}, {self.y:.2f}, {self.z:.2f}), "
            f"Security: {self.security_status:.2f}"
        )

    def is_safe(self):
        return self.security_status > 0


def _node(value):
    return value[0] if isinstance(value, tuple) else value


def _system_id(value):
    return int(_node(value).system_id)


def distance(g1, g2):
    g1 = _node(g1)
    g2 = _node(g2)
    return math.sqrt((g2.x - g1.x) ** 2 + (g2.y - g1.y) ** 2 + (g2.z - g1.z) ** 2)


def _normalise_connections(stargate_connections):
    normalised = {}
    for source, destinations in (stargate_connections or {}).items():
        normalised.setdefault(int(source), set()).update(int(destination) for destination in destinations)
    return normalised


def is_gateway(galaxy, stargate_connections, all_galaxies):
    galaxy_id = _system_id(galaxy)
    connected = _normalise_connections(stargate_connections).get(galaxy_id, set())
    return any(int(candidate.system_id) in connected and candidate.type in SAFE_TYPES for candidate in all_galaxies)


class RouteGraph:
    """Read-only map data and exact route search."""

    def __init__(self, galaxies, stargate_connections=None):
        self.galaxies = tuple(_node(galaxy) for galaxy in galaxies)
        self.by_id = {int(galaxy.system_id): galaxy for galaxy in self.galaxies}
        if len(self.by_id) != len(self.galaxies):
            raise ValueError("duplicate system_id in route graph")
        self.stargate_connections = _normalise_connections(stargate_connections)
        self._index_by_id = {system_id: index for index, system_id in enumerate(self.by_id)}
        self._tree = None
        if cKDTree is not None and self.galaxies:
            coordinates = np.asarray(
                [(galaxy.x, galaxy.y, galaxy.z) for galaxy in self.galaxies], dtype=float
            )
            self._tree = cKDTree(coordinates, copy_data=True)

    def _nearby_ids(self, galaxy_id, max_distance, cache=None):
        max_distance = float(max_distance)
        if not math.isfinite(max_distance) or max_distance <= 0:
            return ()
        cache_key = (galaxy_id, float(max_distance))
        cached = cache.get(cache_key) if cache is not None else None
        if cached is not None:
            return cached
        current = self.by_id[galaxy_id]
        if self._tree is not None:
            index = self._index_by_id[galaxy_id]
            # cKDTree compares squared distances internally.  Query a tiny
            # conservative superset, then apply the authoritative distance
            # check below so points exactly on the radius are never lost to
            # floating-point rounding at the tree boundary.
            query_radius = math.nextafter(max_distance, math.inf)
            candidate_indexes = self._tree.query_ball_point(
                self._tree.data[index], query_radius, eps=0, workers=1
            )
            candidates = (self.galaxies[index] for index in candidate_indexes)
        else:
            candidates = self.galaxies
        nearby = tuple(
            sorted(
                int(candidate.system_id)
                for candidate in candidates
                if int(candidate.system_id) != galaxy_id
                and 0 < distance(current, candidate) <= max_distance
            )
        )
        if cache is not None:
            cache[cache_key] = nearby
        return nearby

    def _candidate_ids(self, galaxy_id, max_distance, allow_dirt, cache=None):
        candidate_ids = set(self._nearby_ids(galaxy_id, max_distance, cache))
        if allow_dirt:
            candidate_ids.update(self.stargate_connections.get(galaxy_id, ()))
        return tuple(sorted(system_id for system_id in candidate_ids if system_id in self.by_id))

    def _edge(self, current, neighbour, max_distance, allow_dirt, passed_high_low):
        current = _node(current)
        neighbour = _node(neighbour)
        current_id = int(current.system_id)
        neighbour_id = int(neighbour.system_id)
        actual_distance = distance(current, neighbour)
        gate = neighbour_id in self.stargate_connections.get(current_id, ())

        if allow_dirt and gate:
            if current.type in SAFE_TYPES and neighbour.type in SAFE_TYPES:
                return "土路", 0.0
            if current.type == NEGATIVE_TYPE and neighbour.type in SAFE_TYPES and not passed_high_low:
                return "土路", 0.0
            if current.type == NEGATIVE_TYPE and neighbour.type == NEGATIVE_TYPE and actual_distance > 9:
                return "土路", 0.0

        if not math.isfinite(actual_distance) or not 0 < actual_distance <= max_distance:
            return None
        if current.type in SAFE_TYPES and neighbour.type in SAFE_TYPES:
            return "安全诱导", actual_distance
        return "不安全诱导", actual_distance * 1.5

    def neighbours(self, galaxy, max_distance, allow_dirt=True, cache=None):
        galaxy_id = _system_id(galaxy)
        return tuple(self.by_id[system_id] for system_id in self._candidate_ids(galaxy_id, max_distance, allow_dirt, cache))

    def find_route(
        self,
        start,
        goal,
        max_distance,
        allow_dirt=True,
        dirt_only=False,
        allowed_ids=None,
    ):
        start = _node(start)
        goal = _node(goal)
        start_id = int(start.system_id)
        goal_id = int(goal.system_id)
        if start_id not in self.by_id or goal_id not in self.by_id:
            return None
        try:
            max_distance = float(max_distance)
        except (TypeError, ValueError):
            return None
        if not math.isfinite(max_distance) or max_distance <= 0:
            return None
        allowed_ids = None if allowed_ids is None else {int(system_id) for system_id in allowed_ids}
        if allowed_ids is not None:
            allowed_ids.update((start_id, goal_id))
        if start_id == goal_id:
            return [(self.by_id[start_id], None)]

        counter = itertools.count()
        neighbour_cache = {}
        start_state = (start_id, False)
        best = {start_state: (0.0, 0)}
        came_from = {}
        heap = [(0.0, 0, next(counter), start_state)]
        while heap:
            cost, hops, _, state = heapq.heappop(heap)
            if best.get(state) != (cost, hops):
                continue
            current_id, passed_high_low = state
            if current_id == goal_id:
                return self._reconstruct(came_from, state)
            current = self.by_id[current_id]
            for neighbour in self.neighbours(current, max_distance, allow_dirt, neighbour_cache):
                neighbour_id = int(neighbour.system_id)
                if allowed_ids is not None and neighbour_id not in allowed_ids:
                    continue
                edge = self._edge(current, neighbour, max_distance, allow_dirt, passed_high_low)
                if edge is None:
                    continue
                move_type, move_cost = edge
                if dirt_only and move_type != "土路":
                    continue
                next_state = (
                    neighbour_id,
                    passed_high_low or (current.type in SAFE_TYPES and neighbour.type == NEGATIVE_TYPE),
                )
                candidate_label = (cost + move_cost, hops + 1)
                if candidate_label >= best.get(next_state, (math.inf, math.inf)):
                    continue
                best[next_state] = candidate_label
                came_from[next_state] = (state, move_type)
                heapq.heappush(heap, (candidate_label[0], candidate_label[1], next(counter), next_state))
        return None

    def _reconstruct(self, came_from, state):
        path = []
        while state in came_from:
            previous, move_type = came_from[state]
            path.append((self.by_id[state[0]], move_type))
            state = previous
        path.append((self.by_id[state[0]], None))
        return list(reversed(path))


def get_neighbors(galaxy, all_galaxies, max_distance, stargate_connections,
                  has_passed_high_low=False, allow_dirt=True):
    graph = RouteGraph(all_galaxies, stargate_connections)
    current = _node(galaxy)
    nearby = [graph.by_id[system_id] for system_id in graph._nearby_ids(
        _system_id(current), max_distance
    )]
    if not allow_dirt:
        if current.type == NEGATIVE_TYPE:
            return nearby
        return (
            [candidate for candidate in nearby if candidate.type in SAFE_TYPES]
            + [candidate for candidate in nearby if candidate.type == NEGATIVE_TYPE]
        )

    connected_ids = graph.stargate_connections.get(_system_id(current), set())
    gate_neighbors = [
        candidate
        for candidate in graph.galaxies
        if int(candidate.system_id) in connected_ids
    ]

    def unique(candidates):
        seen = set()
        result = []
        for candidate in candidates:
            candidate_id = int(candidate.system_id)
            if candidate_id not in seen:
                seen.add(candidate_id)
                result.append(candidate)
        return result

    if current.type == NEGATIVE_TYPE:
        if not has_passed_high_low and is_gateway(current, graph.stargate_connections, graph.galaxies):
            safe_gates = [candidate for candidate in gate_neighbors if candidate.type in SAFE_TYPES]
            return unique(safe_gates + nearby + gate_neighbors)
        return unique(nearby + gate_neighbors)

    safe_gate_neighbors = [candidate for candidate in gate_neighbors if candidate.type in SAFE_TYPES]
    safe_nearby = [
        candidate
        for candidate in nearby
        if candidate.type in SAFE_TYPES and int(candidate.system_id) not in connected_ids
    ]
    unsafe_neighbors = [
        candidate
        for candidate in nearby + gate_neighbors
        if candidate.type == NEGATIVE_TYPE
    ]
    return unique(safe_gate_neighbors + safe_nearby + unsafe_neighbors)


def get_move_type_and_cost(current, neighbor, stargate_connections, max_distance,
                           has_passed_high_low=False, allow_dirt=True):
    graph = RouteGraph([_node(current), _node(neighbor)], stargate_connections)
    result = graph._edge(_node(current), _node(neighbor), max_distance, allow_dirt, has_passed_high_low)
    return result if result is not None else (None, math.inf)


def a_star(start, goal, max_distance, galaxies, dict_road, stargate_connections):
    graph = RouteGraph(galaxies, stargate_connections)
    return graph.find_route(start, goal, max_distance, allow_dirt=bool(dict_road))


def a_star_dirt_only(start, goal, max_distance, galaxies, stargate_connections):
    graph = RouteGraph(galaxies, stargate_connections)
    return graph.find_route(
        start,
        goal,
        max_distance,
        allow_dirt=True,
        dirt_only=True,
    )


def a_star_with_induction(start, goal, max_distance, galaxies, dict_road, stargate_connections):
    return a_star(start, goal, max_distance, galaxies, dict_road, stargate_connections)
