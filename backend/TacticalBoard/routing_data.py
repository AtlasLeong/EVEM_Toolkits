"""Worker-local immutable route graph snapshots."""

from dataclasses import dataclass
import logging
import math
import threading
import time

from django.db.models import F
from django.db.models.functions import Round

from .A_Star import Galaxy, RouteGraph
from .models import BoardConstellations, BoardStargates, BoardSystems


logger = logging.getLogger(__name__)
SNAPSHOT_TTL_SECONDS = 300
SNAPSHOT_FAILURE_BACKOFF_SECONDS = 5
NEW8_REGIONS = frozenset(
    (10000027, 10000018, 10000013, 10000021, 10000053, 10000034, 10000040, 10000066)
)
_snapshot_lock = threading.Lock()
_snapshot_refresh_locks = {}
_snapshots = {}
_failure_until = {}
_snapshot_generation = 0


class SnapshotUnavailable(RuntimeError):
    """Static route data could not be loaded or validated."""


@dataclass(frozen=True)
class RouteSnapshot:
    graph: RouteGraph
    systems_by_name: dict
    systems_by_id: dict
    new8_constellations: frozenset
    system_constellations: dict
    constellation_regions: dict

    def crosses_new8(self, start_name, end_name):
        start_constellation = self.system_constellations.get(start_name)
        end_constellation = self.system_constellations.get(end_name)
        if start_constellation is None or end_constellation is None:
            return False
        start_in_new8 = start_constellation in self.new8_constellations
        end_in_new8 = end_constellation in self.new8_constellations
        if start_in_new8 != end_in_new8:
            return True
        if not start_in_new8:
            return False
        return self.constellation_regions.get(start_constellation) != self.constellation_regions.get(end_constellation)


def _base_system_queryset():
    return (
        BoardSystems.objects.exclude(system_id__contains="3100")
        .exclude(system_id__contains="3200")
        .exclude(system_id__contains="3400")
        .annotate(rounded_security=Round(F("security_status"), 1))
        .values(
            "system_id",
            "zh_name",
            "x",
            "y",
            "z",
            "security_status",
            "constellation_id",
            "rounded_security",
        )
    )


def build_route_snapshot(in_high_security):
    """Load and validate one internally consistent graph snapshot."""
    try:
        all_rows = list(_base_system_queryset())
        all_names = [row["zh_name"] for row in all_rows if row["zh_name"] is not None]
        if len(set(all_names)) != len(all_names):
            raise SnapshotUnavailable("duplicate route system names")
        selected_rows = (
            all_rows
            if in_high_security
            else [row for row in all_rows if row["rounded_security"] is not None and row["rounded_security"] < 0.5]
        )
        galaxies = []
        for row in selected_rows:
            if any(row[field] is None for field in ("x", "y", "z", "security_status", "zh_name")):
                raise SnapshotUnavailable(f"invalid route system data: {row.get('system_id')}")
            try:
                numeric_values = [
                    float(row["x"]),
                    float(row["y"]),
                    float(row["z"]),
                    float(row["security_status"]),
                ]
            except (TypeError, ValueError):
                raise SnapshotUnavailable(f"invalid route system data: {row.get('system_id')}")
            if not all(math.isfinite(value) for value in numeric_values):
                raise SnapshotUnavailable(f"invalid route system data: {row.get('system_id')}")
            galaxy = Galaxy(
                row["system_id"], row["zh_name"], row["x"], row["y"], row["z"], row["security_status"]
            )
            galaxies.append(galaxy)

        names = [galaxy.zh_name for galaxy in galaxies]
        if len(set(names)) != len(names):
            raise SnapshotUnavailable("duplicate route system names")

        stargates = BoardStargates.objects.values(
            "system_id", "destination_system_id"
        )
        connections = {}
        for gate in stargates:
            if gate["system_id"] is None or gate["destination_system_id"] is None:
                continue
            source = int(gate["system_id"])
            destination = int(gate["destination_system_id"])
            connections.setdefault(source, set()).add(destination)
            connections.setdefault(destination, set()).add(source)

        constellation_rows = BoardConstellations.objects.values("constellation_id", "region_id")
        constellation_regions = {int(row["constellation_id"]): int(row["region_id"]) for row in constellation_rows}
        new8_constellations = frozenset(
            constellation_id
            for constellation_id, region_id in constellation_regions.items()
            if region_id in NEW8_REGIONS
        )
        system_constellations = {}
        for row in all_rows:
            if row["zh_name"] is None or row["constellation_id"] is None:
                continue
            name = row["zh_name"]
            constellation_id = int(row["constellation_id"])
            if name in system_constellations and system_constellations[name] != constellation_id:
                raise SnapshotUnavailable("duplicate route system names")
            system_constellations[name] = constellation_id
        systems_by_id = {int(galaxy.system_id): galaxy for galaxy in galaxies}
        systems_by_name = {galaxy.zh_name: galaxy for galaxy in galaxies}
        return RouteSnapshot(
            graph=RouteGraph(galaxies, connections),
            systems_by_name=systems_by_name,
            systems_by_id=systems_by_id,
            new8_constellations=new8_constellations,
            system_constellations=system_constellations,
            constellation_regions=constellation_regions,
        )
    except SnapshotUnavailable:
        raise
    except Exception as error:
        logger.exception("route snapshot load failed")
        raise SnapshotUnavailable("route data is temporarily unavailable") from error


def get_route_snapshot(in_high_security, ttl=SNAPSHOT_TTL_SECONDS):
    key = bool(in_high_security)
    now = time.monotonic()
    with _snapshot_lock:
        entry = _snapshots.get(key)
        if entry is not None and entry[1] > now:
            return entry[0]
        if _failure_until.get(key, 0) > now:
            raise SnapshotUnavailable("route data is temporarily unavailable")
        refresh_lock = _snapshot_refresh_locks.setdefault(key, threading.Lock())
        generation = _snapshot_generation

    # Serialize refreshes for one mode only.  The database work and KDTree
    # construction happen outside the state lock, so a high-security refresh
    # cannot block low-security requests (and hot-cache reads stay cheap).
    with refresh_lock:
        now = time.monotonic()
        with _snapshot_lock:
            entry = _snapshots.get(key)
            if entry is not None and entry[1] > now:
                return entry[0]
            if _failure_until.get(key, 0) > now:
                raise SnapshotUnavailable("route data is temporarily unavailable")
        try:
            snapshot = build_route_snapshot(key)
        except Exception as error:
            if not isinstance(error, SnapshotUnavailable):
                logger.exception("route snapshot refresh failed")
                error = SnapshotUnavailable("route data is temporarily unavailable")
            with _snapshot_lock:
                if generation == _snapshot_generation:
                    _failure_until[key] = time.monotonic() + SNAPSHOT_FAILURE_BACKOFF_SECONDS
            raise error
        with _snapshot_lock:
            if generation == _snapshot_generation:
                _snapshots[key] = (snapshot, time.monotonic() + float(ttl))
                _failure_until.pop(key, None)
        return snapshot


def reset_route_snapshots():
    global _snapshot_generation
    with _snapshot_lock:
        _snapshot_generation += 1
        _snapshots.clear()
        _failure_until.clear()
