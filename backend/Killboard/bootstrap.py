"""Bounded latest-ID *candidate* search, with no database or account handling.

This binary search explicitly assumes reports are a contiguous ID prefix in
the configured interval. Neither one empty response nor the neighbor checks
prove that assumption or global coverage. An unseen hole/island, a different
account's visibility, or a newly published report can invalidate the candidate.
Callers must not promote it to a verified global latest ID or silently advance
a collection cursor past uncollected IDs.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Protocol

from .parser import KillParseError, parse_kill_blob
from .protocol import KillProtocolError, decode_kill_info_response


class ProbeStatus(str, Enum):
    REPORT = "report"
    EMPTY = "empty"
    UNAUTHORIZED = "unauthorized"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    MALFORMED = "malformed"
    BUDGET_EXHAUSTED = "budget_exhausted"
    LEASE_LOST = "lease_lost"


@dataclass(frozen=True)
class ProbeOutcome:
    """Optional transport-neutral result, compatible with discovery outcomes."""

    status: ProbeStatus
    payload: Any = None
    error_code: str = ""


class ProbeClient(Protocol):
    def get_kill_info(self, kill_id: int) -> Any:
        ...


@dataclass(frozen=True)
class BootstrapConfig:
    known_existing_id: int
    upper_id: int = 21_111_111
    assume_contiguous: bool = False
    max_requests: int = 64
    neighbor_radius: int = 2

    MAX_ID = 9_223_372_036_854_775_807
    MAX_REQUESTS = 64
    MAX_NEIGHBOR_RADIUS = 16

    def __post_init__(self):
        if self.assume_contiguous is not True:
            raise ValueError("assume_contiguous=True must explicitly acknowledge the unverified assumption")
        for name in ("known_existing_id", "upper_id", "max_requests", "neighbor_radius"):
            if type(getattr(self, name)) is not int:
                raise ValueError(f"{name} must be an integer")
        if not 1 <= self.known_existing_id < self.upper_id <= self.MAX_ID:
            raise ValueError("require 1 <= known_existing_id < upper_id <= signed 64-bit maximum")
        if not 1 <= self.max_requests <= self.MAX_REQUESTS:
            raise ValueError(f"max_requests must be between 1 and {self.MAX_REQUESTS}")
        if not 1 <= self.neighbor_radius <= self.MAX_NEIGHBOR_RADIUS:
            raise ValueError(f"neighbor_radius must be between 1 and {self.MAX_NEIGHBOR_RADIUS}")


@dataclass(frozen=True)
class ProbeObservation:
    kill_id: int
    status: ProbeStatus
    kill_time_raw: str = ""
    error_code: str = ""


@dataclass(frozen=True)
class BootstrapResult:
    stop_reason: str
    request_count: int
    observations: tuple[ProbeObservation, ...]
    existing_lower_id: int | None = None
    empty_upper_id: int | None = None
    candidate_id: int | None = None
    candidate_kill_time_raw: str = ""
    neighbor_validated: bool = False
    time_order_verified: bool = False
    assumed_contiguous: bool = True
    # This is deliberately never inferred from sparse probes, even on success.
    coverage_verified: bool = False


_ERROR_STATUSES = {
    ProbeStatus.UNAUTHORIZED, ProbeStatus.RATE_LIMITED,
    ProbeStatus.NETWORK_ERROR, ProbeStatus.MALFORMED,
    ProbeStatus.BUDGET_EXHAUSTED, ProbeStatus.LEASE_LOST,
}


def _exception_status(exc: Exception) -> ProbeStatus:
    code = str(getattr(exc, "code", "")).lower()
    for status in _ERROR_STATUSES:
        if code == status.value:
            return status
    name = type(exc).__name__.lower()
    if "auth" in name or "permission" in name:
        return ProbeStatus.UNAUTHORIZED
    if "rate" in name or "limit" in name or "throttle" in name:
        return ProbeStatus.RATE_LIMITED
    if isinstance(exc, OSError) or any(word in name for word in ("network", "timeout", "connection")):
        return ProbeStatus.NETWORK_ERROR
    return ProbeStatus.MALFORMED


def _report_time(payload: dict[str, Any]) -> datetime | None:
    raw = payload.get("kill_time_raw", "")
    if not isinstance(raw, str):
        raise ValueError("invalid report time")
    return datetime.fromisoformat(raw.replace("Z", "+00:00")) if raw else None


class BootstrapRunner:
    """Verify a bracket, bisect it, and reprobe a small clipped neighborhood.

    Every client call counts toward the single hard budget; there are no retries
    or expanding scans. Failures never count as empty evidence. Outcomes from
    the existing discovery module can be passed without importing that module
    (and consequently without configuring Django or touching a database).
    """

    def __init__(self, client: ProbeClient, *, config: BootstrapConfig):
        self.client = client
        self.config = config

    def _fetch(self, kill_id: int) -> ProbeOutcome:
        try:
            method = getattr(self.client, "get_kill_info", None) or getattr(self.client, "fetch")
            value = method(kill_id)
        except Exception as exc:  # cancellation and keyboard interrupts propagate
            status = _exception_status(exc)
            return ProbeOutcome(status, error_code=status.value)
        try:
            status_value = getattr(value, "status", None)
            if status_value is not None:
                status = ProbeStatus(status_value)
                if status in _ERROR_STATUSES:
                    # Never copy arbitrary transport text, IDs or credential data.
                    return ProbeOutcome(status, error_code=status.value)
                if status is ProbeStatus.EMPTY:
                    return ProbeOutcome(status)
                parsed = getattr(value, "payload", None)
            else:
                decoded = value if isinstance(value, dict) and "kill_blob" in value else decode_kill_info_response(value)
                if decoded is None:
                    return ProbeOutcome(ProbeStatus.EMPTY)
                if not isinstance(decoded, dict) or decoded.get("kill_blob") is None:
                    return ProbeOutcome(ProbeStatus.MALFORMED, error_code="missing_kill_blob")
                parsed = parse_kill_blob(decoded["kill_blob"], summary=decoded, identity_map=decoded.get("identity_map"))
            if not isinstance(parsed, dict) or type(parsed.get("kill_id")) is not int or parsed["kill_id"] != kill_id:
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code="kill_id_mismatch")
            _report_time(parsed)  # a non-empty invalid timestamp is a format error
            return ProbeOutcome(ProbeStatus.REPORT, payload=parsed)
        except (KillProtocolError, KillParseError, TypeError, ValueError, AttributeError):
            return ProbeOutcome(ProbeStatus.MALFORMED, error_code="malformed")

    def run(self) -> BootstrapResult:
        config = self.config
        observations: list[ProbeObservation] = []
        seen: dict[int, ProbeOutcome] = {}
        times: dict[int, datetime | None] = {}
        lower: int | None = None
        upper: int | None = None
        stop_reason = ""

        def result(*, candidate: int | None = None) -> BootstrapResult:
            present_times = [value for value in times.values() if value is not None]
            comparable = len(present_times) == len(times) and bool(times)
            comparable = comparable and len({value.utcoffset() is not None for value in present_times}) == 1
            return BootstrapResult(
                stop_reason=stop_reason, request_count=len(observations),
                observations=tuple(observations), existing_lower_id=lower,
                empty_upper_id=upper, candidate_id=candidate,
                candidate_kill_time_raw=seen[candidate].payload.get("kill_time_raw", "") if candidate is not None else "",
                neighbor_validated=candidate is not None,
                time_order_verified=candidate is not None and comparable,
            )

        def probe(kill_id: int) -> ProbeOutcome | None:
            nonlocal stop_reason
            if len(observations) >= config.max_requests:
                stop_reason = "max_requests"
                return None
            outcome = self._fetch(kill_id)
            raw_time = outcome.payload.get("kill_time_raw", "") if outcome.status is ProbeStatus.REPORT else ""
            observations.append(ProbeObservation(kill_id, outcome.status, raw_time, outcome.error_code))
            if outcome.status in _ERROR_STATUSES:
                stop_reason = outcome.status.value
                return None
            previous = seen.get(kill_id)
            if previous is not None and previous.status is not outcome.status:
                stop_reason = "boundary_changed"
                return None
            seen[kill_id] = outcome
            empty_ids = [key for key, item in seen.items() if item.status is ProbeStatus.EMPTY]
            report_ids = [key for key, item in seen.items() if item.status is ProbeStatus.REPORT]
            if empty_ids and report_ids and min(empty_ids) < max(report_ids):
                stop_reason = "continuity_violation"
                return None
            if outcome.status is ProbeStatus.REPORT:
                report_time = _report_time(outcome.payload)
                for other_id, other_time in times.items():
                    if report_time is None or other_time is None:
                        continue
                    # A timezone-less source value has no safely inferred UTC
                    # offset. Compare only like-for-like timestamp categories.
                    if (report_time.utcoffset() is None) != (other_time.utcoffset() is None):
                        continue
                    if (other_id < kill_id and other_time > report_time) or (other_id > kill_id and other_time < report_time):
                        stop_reason = "time_reversed"
                        return None
                times[kill_id] = report_time
            return outcome

        outcome = probe(config.known_existing_id)
        if outcome is None:
            return result()
        if outcome.status is not ProbeStatus.REPORT:
            stop_reason = "lower_not_existing"
            return result()
        lower = config.known_existing_id
        outcome = probe(config.upper_id)
        if outcome is None:
            return result()
        if outcome.status is not ProbeStatus.EMPTY:
            stop_reason = "upper_not_empty"
            return result()
        upper = config.upper_id

        while upper - lower > 1:
            midpoint = lower + (upper - lower) // 2
            outcome = probe(midpoint)
            if outcome is None:
                return result()
            if outcome.status is ProbeStatus.REPORT:
                lower = midpoint
            else:
                upper = midpoint

        # Reprobe, including the candidate and first empty ID. The caller's
        # original bracket is also the scope boundary: never probe outside it.
        first_neighbor = max(config.known_existing_id, lower - config.neighbor_radius)
        last_neighbor = min(config.upper_id, upper + config.neighbor_radius)
        for kill_id in range(first_neighbor, last_neighbor + 1):
            if probe(kill_id) is None:
                return result()
        stop_reason = "candidate_only"
        return result(candidate=lower)
