import math
from queue import PriorityQueue
from decimal import Decimal, getcontext

# 设置 Decimal 的精度
getcontext().prec = 30


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
        elif security_status < 0.5:
            return "low"
        else:
            return "high"

    def __str__(self):
        return f"{self.system_id} ({self.zh_name}): ({self.x:.2f}, {self.y:.2f}, {self.z:.2f}), Security: {self.security_status:.2f}"

    def is_safe(self):
        return self.security_status > 0


def is_gateway(galaxy, stargate_connections, all_galaxies):
    galaxy_id = int(galaxy.system_id)
    if galaxy_id in stargate_connections:
        connected_systems = stargate_connections[galaxy_id]
        connected_galaxies = [g for g in all_galaxies if int(g.system_id) in connected_systems]
        return any(g.type in ["high", "low"] for g in connected_galaxies)
    return False


def distance(g1, g2):
    if isinstance(g1, tuple):
        g1 = g1[0]
    if isinstance(g2, tuple):
        g2 = g2[0]
    dx = g2.x - g1.x
    dy = g2.y - g1.y
    dz = g2.z - g1.z
    dist = math.sqrt(dx ** 2 + dy ** 2 + dz ** 2)

    return dist


def a_star(start, goal, max_distance, galaxies, dict_road, stargate_connections):
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
                path.append((current, "土路"))  # 添加移动类型
                current = came_from[current]
            path.append((start, None))  # 起点没有移动类型
            return path[::-1]

        for neighbor in get_neighbors(current, galaxies, max_distance, stargate_connections):
            move_type, move_cost = get_move_type_and_cost(current, neighbor, stargate_connections, max_distance)

            # 只考虑土路移动
            if move_type != "土路":
                continue

            tentative_g_score = g_score[current] + move_cost

            if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g_score
                f_score[neighbor] = g_score[neighbor] + heuristic(neighbor)
                open_set.put((f_score[neighbor], neighbor))

    # 如果只使用土路无法到达目的地，则尝试包含诱导的路径
    return a_star_with_induction(start, goal, max_distance, galaxies, dict_road, stargate_connections)


def a_star_with_induction(start, goal, max_distance, galaxies, dict_road, stargate_connections):
    def heuristic(node):
        return distance(node, goal)

    open_set = PriorityQueue()
    open_set.put((0, start))

    came_from = {}
    g_score = {start: 0}
    f_score = {start: heuristic(start)}
    move_types = {start: None}
    passed_high_low = {start: False}  # 新增：标记是否已经穿过高低安

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

        for neighbor in get_neighbors(current, galaxies, max_distance, stargate_connections, has_passed_high_low):
            move_type, move_cost = get_move_type_and_cost(current, neighbor, stargate_connections, max_distance,
                                                          has_passed_high_low)

            tentative_g_score = g_score[current] + move_cost

            if neighbor not in g_score or tentative_g_score < g_score[neighbor]:
                came_from[neighbor] = current
                g_score[neighbor] = tentative_g_score
                f_score[neighbor] = g_score[neighbor] + heuristic(neighbor)
                move_types[neighbor] = move_type

                # 更新passed_high_low状态
                neighbor_galaxy = neighbor[0] if isinstance(neighbor, tuple) else neighbor
                passed_high_low[neighbor] = (has_passed_high_low or
                                             (current_galaxy.type in ["high",
                                                                      "low"] and neighbor_galaxy.type == "negative"))

                # 优先考虑土路
                priority = f_score[neighbor]
                if move_type != "土路":
                    priority += 1000  # 增加非土路移动的优先级，使其less被考虑

                open_set.put((priority, neighbor))

    return None


def get_neighbors(galaxy, all_galaxies, max_distance, stargate_connections, has_passed_high_low=False):
    if isinstance(galaxy, tuple):
        galaxy = galaxy[0]

    neighbors = [g for g in all_galaxies if 0 < distance(galaxy, g) <= max_distance]
    current_id = int(galaxy.system_id)
    connected_systems = stargate_connections.get(current_id, set())

    # 添加通过土路连接的星系（包括不安全星系）
    land_route_neighbors = [g for g in all_galaxies if int(g.system_id) in connected_systems]

    if galaxy.type == "negative":
        if not has_passed_high_low and is_gateway(galaxy, stargate_connections, all_galaxies):
            high_low_neighbors = [g for g in land_route_neighbors if g.type in ["high", "low"]]
            return high_low_neighbors + [g for g in neighbors + land_route_neighbors if g not in high_low_neighbors]
        else:
            return list(set(neighbors + land_route_neighbors))  # 使用set去重
    else:
        safe_land_route = [g for g in land_route_neighbors if g.type in ["high", "low"]]
        safe_neighbors = [g for g in neighbors if g.type in ["high", "low"] and g not in safe_land_route]
        unsafe_neighbors = [g for g in neighbors + land_route_neighbors if g.type == "negative"]

        return safe_land_route + safe_neighbors + unsafe_neighbors


def get_move_type_and_cost(current, neighbor, stargate_connections, max_distance, has_passed_high_low=False):
    if isinstance(current, tuple):
        current = current[0]
    if isinstance(neighbor, tuple):
        neighbor = neighbor[0]

    current_id = int(current.system_id)
    neighbor_id = int(neighbor.system_id)

    # 1. 优先考虑两个不安全negative星系间的土路
    if current.type == "negative" and neighbor.type == "negative":
        if (current_id in stargate_connections and
                neighbor_id in stargate_connections[current_id] and
                distance(current, neighbor) > 9):
            return "土路", 0

    # 2. 检查是否为门户星系（仅在未穿过高低安时考虑）
    is_current_gateway = not has_passed_high_low and current.type == "negative" and is_gateway(current,
                                                                                               stargate_connections,
                                                                                               [neighbor])

    # 3. 门户星系到高安或低安星系使用土路
    if is_current_gateway and neighbor.type in ["high", "low"]:
        if current_id in stargate_connections and neighbor_id in stargate_connections[current_id]:
            return "土路", 0

    # 4. 高安与低安星系之间优先使用土路
    if current.type in ["high", "low"] and neighbor.type in ["high", "low"]:
        if current_id in stargate_connections and neighbor_id in stargate_connections[current_id]:
            return "土路", 0

    # 5. 高安和低安星系之间的诱导
    if current.type in ["high", "low"] and neighbor.type in ["high", "low"]:
        return "安全诱导", distance(current, neighbor)

    # 6. 其他情况使用普通诱导
    return "不安全诱导", distance(current, neighbor) * 1.5  # 增加不安全诱导的代价
