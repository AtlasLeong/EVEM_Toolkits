"""Bounded consecutive-ID discovery for the kill-report RPC."""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, Protocol

from django.db import transaction
from django.utils import timezone

from .parser import KillParseError, parse_kill_blob
from .protocol import KillProtocolError, decode_kill_info_response
from .models import CollectionPolicy, ProbeCursor, ProbeRun
from .services import persist_report


class ProbeStatus(str, Enum):
    REPORT = "report"
    EMPTY = "empty"
    UNAUTHORIZED = "unauthorized"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    MALFORMED = "malformed"


@dataclass(frozen=True)
class ProbeOutcome:
    status: ProbeStatus
    payload: Any = None
    error_code: str = ""


ProbeResult = ProbeOutcome


class ProbeClient(Protocol):
    """Transport abstraction; credentials and sockets stay outside Killboard."""

    def get_kill_info(self, kill_id: int) -> Any:
        ...


class UnauthorizedError(Exception):
    code = ProbeStatus.UNAUTHORIZED.value


class RateLimitedError(Exception):
    code = ProbeStatus.RATE_LIMITED.value


class NetworkError(Exception):
    code = ProbeStatus.NETWORK_ERROR.value


@dataclass(frozen=True)
class DiscoveryConfig:
    start_id: int | None = None
    step: int = 1
    neighbor_reprobe: int = 0
    empty_threshold: int = 3
    max_requests: int = 100

    def __post_init__(self):
        if self.step < 1 or self.neighbor_reprobe < 0:
            raise ValueError("step and neighbor_reprobe must be non-negative, with step >= 1")
        if self.empty_threshold < 1 or self.max_requests < 1:
            raise ValueError("empty_threshold and max_requests must be positive")
        if self.neighbor_reprobe >= self.step and self.step > 1:
            raise ValueError("neighbor_reprobe must be smaller than step")


def _exception_status(exc: BaseException) -> ProbeStatus:
    code = str(getattr(exc, "code", "")).lower()
    if code in {status.value for status in ProbeStatus}:
        return ProbeStatus(code)
    name = type(exc).__name__.lower()
    if "auth" in name or "permission" in name:
        return ProbeStatus.UNAUTHORIZED
    if "rate" in name or "limit" in name or "throttle" in name:
        return ProbeStatus.RATE_LIMITED
    if "network" in name or "timeout" in name or "connection" in name:
        return ProbeStatus.NETWORK_ERROR
    return ProbeStatus.MALFORMED


def _time_value(raw: str | None):
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if timezone.is_naive(value):
        return value.replace(tzinfo=timezone.utc)
    return value


class DiscoveryRunner:
    """Run one bounded probe pass while serializing updates to a cursor."""

    def __init__(
        self,
        client: ProbeClient,
        *,
        cursor: ProbeCursor,
        policy: CollectionPolicy | None = None,
        config: DiscoveryConfig | None = None,
        source: str = "kill_api",
    ):
        self.client = client
        self.cursor = cursor
        self.policy = policy
        self.config = config or DiscoveryConfig()
        self.source = source

    def _fetch(self, kill_id: int) -> ProbeOutcome:
        try:
            method = getattr(self.client, "get_kill_info", None) or getattr(self.client, "fetch")
            value = method(kill_id)
        except BaseException as exc:  # transport implementations expose diverse errors
            return ProbeOutcome(_exception_status(exc), error_code=str(getattr(exc, "code", "")))
        if isinstance(value, ProbeOutcome):
            return value
        try:
            # Fake/in-process clients may already return the decoded mapping;
            # network clients return the verified MessagePack envelope.
            decoded = value if isinstance(value, dict) and "kill_blob" in value else decode_kill_info_response(value)
            if decoded is None:
                return ProbeOutcome(ProbeStatus.EMPTY)
            blob = decoded.get("kill_blob") if isinstance(decoded, dict) else None
            if blob is None:
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code="missing_kill_blob")
            parsed = parse_kill_blob(blob)
            if parsed.get("kill_id") != kill_id:
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code="kill_id_mismatch")
            return ProbeOutcome(ProbeStatus.REPORT, payload=parsed)
        except (KillProtocolError, KillParseError, TypeError, ValueError) as exc:
            return ProbeOutcome(ProbeStatus.MALFORMED, error_code=type(exc).__name__)

    def run(self) -> ProbeRun:
        config = self.config
        with transaction.atomic():
            cursor = ProbeCursor.objects.select_for_update().get(pk=self.cursor.pk)
            if ProbeRun.objects.filter(cursor=cursor, status=ProbeRun.Status.RUNNING).exists():
                raise RuntimeError("probe cursor already has a running run")
            run = ProbeRun.objects.create(
                cursor=cursor,
                policy=self.policy,
                status=ProbeRun.Status.RUNNING,
                started_at_ms=int(timezone.now().timestamp() * 1000),
            )
            try:
                self._run_locked(run, cursor)
            except Exception:
                run.status = ProbeRun.Status.FAILED
                run.stop_reason = run.stop_reason or "failed"
                run.finished_at_ms = int(timezone.now().timestamp() * 1000)
                run.save(update_fields=["status", "stop_reason", "finished_at_ms"])
                raise
            return run

    def _run_locked(self, run: ProbeRun, cursor: ProbeCursor) -> None:
        config = self.config
        next_id = cursor.next_probe_id
        if next_id is None and cursor.last_success_id is not None:
            next_id = cursor.last_success_id + 1
        if next_id is None:
            next_id = config.start_id
        if next_id is None:
            run.status = ProbeRun.Status.STOPPED
            run.stop_reason = "missing_start_id"
            run.finished_at_ms = int(timezone.now().timestamp() * 1000)
            run.save(update_fields=["status", "stop_reason", "finished_at_ms"])
            return

        pending: deque[tuple[int, bool]] = deque()
        while run.request_count < config.max_requests:
            if pending:
                probe_id, is_neighbor = pending.popleft()
            else:
                probe_id, is_neighbor = next_id, False
            outcome = self._fetch(probe_id)
            run.request_count += 1
            if outcome.status is ProbeStatus.REPORT:
                parsed = outcome.payload
                report_time = _time_value(parsed.get("kill_time_raw"))
                if cursor.last_success_kill_time and report_time and report_time < cursor.last_success_kill_time:
                    run.stop_reason = "time_reversed"
                    break
                persist_report(parsed, policy=self.policy, source=self.source)
                run.report_count += 1
                cursor.last_success_id = probe_id
                if report_time is not None:
                    cursor.last_success_kill_time = report_time
                cursor.consecutive_empty_count = 0
                next_id = probe_id + config.step
                if config.step > 1 and config.neighbor_reprobe:
                    pending.extend(
                        (candidate, True)
                        for candidate in range(
                            max(probe_id + 1, next_id - config.neighbor_reprobe), next_id
                        )
                    )
                cursor.next_probe_id = next_id
            elif outcome.status is ProbeStatus.EMPTY:
                run.empty_count += 1
                if not is_neighbor:
                    cursor.consecutive_empty_count += 1
                    next_id = max(next_id, probe_id + 1)
                    cursor.next_probe_id = next_id
                    if cursor.consecutive_empty_count >= config.empty_threshold:
                        # Keep the first boundary ID as the safe restart point;
                        # a later run may observe a newly published report there.
                        cursor.next_probe_id = probe_id - (config.empty_threshold - 1)
                        run.stop_reason = "empty_threshold"
                        break
            else:
                run.error_code = outcome.error_code or outcome.status.value
                run.stop_reason = outcome.status.value
                break
            run.save(update_fields=["request_count", "report_count", "empty_count", "error_code", "stop_reason"])
            cursor.updated_at_ms = int(timezone.now().timestamp() * 1000)
            cursor.save(update_fields=[
                "last_success_id", "last_success_kill_time", "consecutive_empty_count", "next_probe_id", "updated_at_ms"
            ])

        if not run.stop_reason:
            run.stop_reason = "max_requests"
        run.status = ProbeRun.Status.STOPPED
        run.finished_at_ms = int(timezone.now().timestamp() * 1000)
        run.save(update_fields=[
            "status", "finished_at_ms", "request_count", "report_count", "empty_count", "stop_reason", "error_code"
        ])
        cursor.updated_at_ms = int(timezone.now().timestamp() * 1000)
        cursor.save(update_fields=[
            "last_success_id", "last_success_kill_time", "consecutive_empty_count", "next_probe_id", "updated_at_ms"
        ])


def discover(*args, **kwargs):
    """Functional entry point retained for management-command callers."""
    return DiscoveryRunner(*args, **kwargs).run()
