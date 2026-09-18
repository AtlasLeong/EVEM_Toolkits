"""Small reproducible benchmark for the exact route graph.

This is intentionally synthetic and has no database or production settings
dependency.  It compares the indexed candidate lookup with the exact same
search using the full-scan fallback, and checks that both return identical
neighbor sets/routes before reporting timings.
"""

import argparse
import random
import statistics
import sys
import time
from pathlib import Path


BACKEND = Path(__file__).resolve().parents[1] / "backend"
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from TacticalBoard.A_Star import Galaxy, LIGHT_YEAR_METERS, RouteGraph  # noqa: E402


def make_points(count, seed):
    rng = random.Random(seed)
    return [
        Galaxy(
            index,
            f"bench-{index}",
            rng.uniform(-500, 500) * LIGHT_YEAR_METERS,
            rng.uniform(-500, 500) * LIGHT_YEAR_METERS,
            rng.uniform(-500, 500) * LIGHT_YEAR_METERS,
            0.6,
        )
        for index in range(count)
    ]


def median_ms(callback, repeats):
    samples = []
    for _ in range(repeats):
        started = time.perf_counter()
        callback()
        samples.append((time.perf_counter() - started) * 1000)
    return statistics.median(samples)


def run(count, query_count, repeats):
    points = make_points(count, seed=20260919)
    indexed = RouteGraph(points, {})
    full_scan = RouteGraph(points, {})
    full_scan._tree = None
    query_ids = [points[index].system_id for index in random.Random(20260919).sample(range(count), query_count)]
    radius = 5.0

    indexed_sets = [indexed._nearby_ids(system_id, radius) for system_id in query_ids]
    scan_sets = [full_scan._nearby_ids(system_id, radius) for system_id in query_ids]
    if indexed_sets != scan_sets:
        raise AssertionError("indexed and full-scan neighbor sets differ")

    indexed_query_ms = median_ms(
        lambda: [indexed._nearby_ids(system_id, radius) for system_id in query_ids], repeats
    )
    scan_query_ms = median_ms(
        lambda: [full_scan._nearby_ids(system_id, radius) for system_id in query_ids], repeats
    )

    line_points = [
        Galaxy(index, f"line-{index}", index * LIGHT_YEAR_METERS, 0, 0, 0.6)
        for index in range(400)
    ]
    indexed_line = RouteGraph(line_points, {})
    scan_line = RouteGraph(line_points, {})
    scan_line._tree = None
    indexed_path = indexed_line.find_route(line_points[0], line_points[-1], 1.01, allow_dirt=False)
    scan_path = scan_line.find_route(line_points[0], line_points[-1], 1.01, allow_dirt=False)
    if [node.system_id for node, _ in indexed_path] != [node.system_id for node, _ in scan_path]:
        raise AssertionError("indexed and full-scan routes differ")
    indexed_route_ms = median_ms(
        lambda: indexed_line.find_route(line_points[0], line_points[-1], 1.01, allow_dirt=False), repeats
    )
    scan_route_ms = median_ms(
        lambda: scan_line.find_route(line_points[0], line_points[-1], 1.01, allow_dirt=False), repeats
    )

    print(f"points={count} queries={query_count} repeats={repeats}")
    print(f"indexed_build_ms={median_ms(lambda: RouteGraph(points, {}), repeats):.3f}")
    print(f"indexed_neighbor_batch_ms={indexed_query_ms:.3f}")
    print(f"full_scan_neighbor_batch_ms={scan_query_ms:.3f}")
    print(f"neighbor_speedup={scan_query_ms / indexed_query_ms:.2f}x")
    print(f"indexed_line_route_ms={indexed_route_ms:.3f}")
    print(f"full_scan_line_route_ms={scan_route_ms:.3f}")
    print(f"route_speedup={scan_route_ms / indexed_route_ms:.2f}x")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--points", type=int, default=6000)
    parser.add_argument("--queries", type=int, default=256)
    parser.add_argument("--repeats", type=int, default=5)
    args = parser.parse_args()
    run(args.points, args.queries, args.repeats)
