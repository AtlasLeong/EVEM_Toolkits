import math
from queue import PriorityQueue


class Galaxy:
    def __init__(self, system_id, zh_name, x, y, z, security_status):
        self.system_id = system_id
        self.zh_name = zh_name
        self.x = float(x) / 9.461e15
        self.y = float(y) / 9.461e15
        self.z = float(z) / 9.461e15
        self.security_status = float(security_status)
        self.type = self.get_system_type(security_status)

    @staticmethod
    def get_system_type(security_status):
        if security_status < 0:
            return "negative"
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


def is_gateway(galaxy, stargate_connections, all_galaxies):
    galaxy_id = int(galaxy.system_id)
    if galaxy_id not in stargate_connections:
        return False

    connected_systems = stargate_connections[galaxy_id]
    connected_galaxies = [g for g in all_galaxies if int(g.system_id) in connected_systems]
    return any(g.type in ["high", "low"] for g in connected_galaxies)


def distance(g1, g2):
    if isinstance(g1, tuple):
        g1 = g1[0]
    if isinstance(g2, tuple):
        g2 = g2[0]

    dx = g2.x - g1.x
    dy = g2.y - g1.y
    dz = g2.z - g1.z
    return math.sqrt(dx ** 2 + dy ** 2 + dz ** 2)


def a_star(start, goal, max_distance, galaxies, dict_road, stargate_connections):
    if dict_road:
        dirt_path = a_star_dirt_only(start, goal, max_distance, galaxies, stargate_connections)
        if dirt_path:
            return dirt_path

    return a_star_with_induction(
        start,
        goal,
        max_distance,
        galaxies,
        dict_road,
        stargate_connections,
    )


def a_star_dirt_only(start, goal, max_distance, galaxies, stargate_connections):
    def heuristic(node):
        return distance(node, goal)

    open_set = PriorityQueue()
    open_set.put((0, start))

    came_from = {}
    g_score = {start: 0}
    f_score = {start: heuristic(start)}

    while not open_set.empty():
        current = open_set.get()[1]

        if current == goal:
            path = []
            while current in came_from:
                path.append((current, "土路"))
                current = came_from[current]
            path.append((start, None))
            return path[::-1]

        for neighbor in get_neighbors(
            current,
            galaxies,
            max_distance,
            stargate_connections,
            allow_dirt=True,
        ):
            move_type, move_cost = get_move_type_and_cost(
                current,
                neighbor,
                stargate_connections,
                max_distance,
                allow_dirt=True,
            )

            if move_type != "土路":
                continue

            tentative_g_score = g_score[current] + move_cost
            if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g_score
                f_score[neighbor] = tentative_g_score + heuristic(neighbor)
                open_set.put((f_score[neighbor], neighbor))

    return None


def a_star_with_induction(start, goal, max_distance, galaxies, dict_road, stargate_connections):
    def heuristic(node):
        return distance(node, goal)

    open_set = PriorityQueue()
    open_set.put((0, start))

    came_from = {}
    g_score = {start: 0}
    f_score = {start: heuristic(start)}
    move_types = {start: None}
    passed_high_low = {start: False}

    while not open_set.empty():
        current = open_set.get()[1]

        if current == goal:
            path = []
            moves = []
            while current in came_from:
                path.append(current)
                moves.append(move_types[current])
                current = came_from[current]
            path.append(start)
            moves.append(None)
            return list(zip(path[::-1], moves[::-1]))

        current_galaxy = current[0] if isinstance(current, tuple) else current
        has_passed_high_low = passed_high_low[current]

        for neighbor in get_neighbors(
            current,
            galaxies,
            max_distance,
            stargate_connections,
            has_passed_high_low=has_passed_high_low,
            allow_dirt=dict_road,
        ):
            move_type, move_cost = get_move_type_and_cost(
                current,
                neighbor,
                stargate_connections,
                max_distance,
                has_passed_high_low=has_passed_high_low,
                allow_dirt=dict_road,
            )

            tentative_g_score = g_score[current] + move_cost
            if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g_score
                f_score[neighbor] = tentative_g_score + heuristic(neighbor)
                move_types[neighbor] = move_type

                neighbor_galaxy = neighbor[0] if isinstance(neighbor, tuple) else neighbor
                passed_high_low[neighbor] = (
                    has_passed_high_low
                    or (current_galaxy.type in ["high", "low"] and neighbor_galaxy.type == "negative")
                )

                priority = f_score[neighbor]
                if dict_road and move_type != "土路":
                    priority += 1000

                open_set.put((priority, neighbor))

    return None


def get_neighbors(
    galaxy,
    all_galaxies,
    max_distance,
    stargate_connections,
    has_passed_high_low=False,
    allow_dirt=True,
):
    if isinstance(galaxy, tuple):
        galaxy = galaxy[0]

    neighbors = [g for g in all_galaxies if 0 < distance(galaxy, g) <= max_distance]
    if not allow_dirt:
        if galaxy.type == "negative":
            return neighbors

        safe_neighbors = [g for g in neighbors if g.type in ["high", "low"]]
        unsafe_neighbors = [g for g in neighbors if g.type == "negative"]
        return safe_neighbors + unsafe_neighbors

    current_id = int(galaxy.system_id)
    connected_systems = stargate_connections.get(current_id, set())
    land_route_neighbors = [g for g in all_galaxies if int(g.system_id) in connected_systems]

    if galaxy.type == "negative":
        if not has_passed_high_low and is_gateway(galaxy, stargate_connections, all_galaxies):
            high_low_neighbors = [g for g in land_route_neighbors if g.type in ["high", "low"]]
            return high_low_neighbors + [g for g in neighbors + land_route_neighbors if g not in high_low_neighbors]
        return list(set(neighbors + land_route_neighbors))

    safe_land_route = [g for g in land_route_neighbors if g.type in ["high", "low"]]
    safe_neighbors = [g for g in neighbors if g.type in ["high", "low"] and g not in safe_land_route]
    unsafe_neighbors = [g for g in neighbors + land_route_neighbors if g.type == "negative"]
    return safe_land_route + safe_neighbors + unsafe_neighbors


def get_move_type_and_cost(
    current,
    neighbor,
    stargate_connections,
    max_distance,
    has_passed_high_low=False,
    allow_dirt=True,
):
    del max_distance

    if isinstance(current, tuple):
        current = current[0]
    if isinstance(neighbor, tuple):
        neighbor = neighbor[0]

    current_id = int(current.system_id)
    neighbor_id = int(neighbor.system_id)

    if allow_dirt:
        if current.type == "negative" and neighbor.type == "negative":
            if (
                current_id in stargate_connections
                and neighbor_id in stargate_connections[current_id]
                and distance(current, neighbor) > 9
            ):
                return "土路", 0

        is_current_gateway = (
            not has_passed_high_low
            and current.type == "negative"
            and is_gateway(current, stargate_connections, [neighbor])
        )

        if is_current_gateway and neighbor.type in ["high", "low"]:
            if current_id in stargate_connections and neighbor_id in stargate_connections[current_id]:
                return "土路", 0

        if current.type in ["high", "low"] and neighbor.type in ["high", "low"]:
            if current_id in stargate_connections and neighbor_id in stargate_connections[current_id]:
                return "土路", 0

    if current.type in ["high", "low"] and neighbor.type in ["high", "low"]:
        return "安全诱导", distance(current, neighbor)

    return "不安全诱导", distance(current, neighbor) * 1.5
