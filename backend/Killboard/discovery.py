"""Bounded consecutive-ID discovery for the kill-report RPC."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone as dt_timezone
from enum import Enum
from typing import Any, Protocol
import uuid
import re
import inspect

from django.conf import settings
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from .parser import KillParseError, parse_kill_blob
from .protocol import KillProtocolError, decode_kill_info_response
from .models import CollectionPolicy, ProbeCursor, ProbeEvent, ProbeRun
from .services import persist_report, disposition_for
from .collector_transport import BaseReportResult, AUDIT_STAGES, AUDIT_ERROR_CODES
from .session_bundle import REQUIRED_METHODS, OPTIONAL_METHODS
from .worker import LeaseLostError, paused_reason


RUN_LEASE_MS = 90 * 1000


class ProbeStatus(str, Enum):
    REPORT = "report"
    EMPTY = "empty"
    UNAUTHORIZED = "unauthorized"
    RATE_LIMITED = "rate_limited"
    NETWORK_ERROR = "network_error"
    MALFORMED = "malformed"
    BUDGET_EXHAUSTED = "budget_exhausted"
    LEASE_LOST = "lease_lost"
    CONFIGURATION_ERROR = "configuration_error"


@dataclass(frozen=True)
class ProbeOutcome:
    status: ProbeStatus
    payload: Any = None
    error_code: str = ""
    deferred_stop_code: str = ""


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

    MAX_REQUESTS = 10_000
    MAX_ID = 9_223_372_036_854_775_807

    def __post_init__(self):
        # The first implementation deliberately probes every ID.  Jumping over
        # IDs is not safe until a separate, hole-aware bootstrap index exists.
        if self.step != 1 or self.neighbor_reprobe:
            raise ValueError("discovery currently requires step=1 and no neighbor reprobe")
        if self.empty_threshold < 1 or self.max_requests < 1:
            raise ValueError("empty_threshold and max_requests must be positive")
        if self.max_requests > self.MAX_REQUESTS:
            raise ValueError(f"max_requests must be <= {self.MAX_REQUESTS}")
        if self.start_id is not None and not 1 <= self.start_id <= self.MAX_ID:
            raise ValueError("start_id is outside the signed 64-bit kill-id range")


def _exception_status(exc: Exception) -> ProbeStatus:
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


def _safe_error_code(value: str | None) -> str:
    """Keep audit rows to stable classifier codes, never exception text."""
    value = str(value or '').strip().lower()
    return value[:64] if re.fullmatch(r'[a-z0-9_.-]{1,64}', value) else ''


def safe_audit_snapshot(client):
    """Allowlist only ordinal session and local transport classifiers."""
    method = getattr(client, 'audit_snapshot', None)
    if not callable(method):
        return {}
    try:
        raw = method()
    except Exception:
        return {}
    if not isinstance(raw, dict):
        return {}
    result = {}
    slot = raw.get('session_slot')
    if isinstance(slot, str) and re.fullmatch(r'[A-Z]{1,2}', slot):
        result['session_slot'] = slot
    count = raw.get('rpc_count')
    if type(count) is int and 0 <= count <= 10000:
        result['rpc_count'] = count
    for key in ('last_rpc_method', 'failure_rpc_method'):
        if raw.get(key) in (*REQUIRED_METHODS, *OPTIONAL_METHODS):
            result[key] = raw[key]
    if raw.get('stage') in AUDIT_STAGES:
        result['stage'] = raw['stage']
    if raw.get('error_code') in AUDIT_ERROR_CODES:
        result['error_code'] = raw['error_code']
    return result


def record_diagnostics(run, client, disposition='', enrichment_deferred=False):
    """Merge safe transport state and actual persistence counters into a run.

    The caller owns its transaction and persists the modified run. Return the
    event snapshot independently so later RPCs cannot rewrite old attribution.
    """
    counters = ('created_count', 'updated_count', 'filtered_value_count',
                'filtered_npc_count', 'filtered_policy_count', 'parsed_count',
                'enrichment_deferred_count')
    diagnostics = dict(run.diagnostics) if isinstance(run.diagnostics, dict) else {}
    for key in counters:
        if type(diagnostics.get(key)) is not int or diagnostics[key] < 0:
            diagnostics[key] = 0
    event = safe_audit_snapshot(client)
    diagnostics.update(event)
    if disposition in ('created', 'updated', 'filtered_value', 'filtered_npc', 'filtered_policy', 'parsed'):
        diagnostics[disposition + '_count'] += 1
        event['disposition'] = disposition
    if enrichment_deferred:
        diagnostics['enrichment_deferred_count'] += 1
        event['enrichment_deferred'] = True
    run.diagnostics = diagnostics
    return event


def _time_value(raw: str | None):
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if timezone.is_naive(value):
        return value.replace(tzinfo=dt_timezone.utc) if settings.USE_TZ else value
    return value if settings.USE_TZ else timezone.make_naive(value, dt_timezone.utc)


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
        client_factory=None,
    ):
        self.client = client
        self.cursor = cursor
        self.policy = policy
        self.config = config or DiscoveryConfig()
        self.source = source
        self.active_run = None
        self.client_factory = client_factory
        self.first_empty = None
        self.pending_id = None

    def heartbeat(self):
        run = self.active_run
        if run is not None and not ProbeRun.objects.filter(
            pk=run.pk, status=ProbeRun.Status.RUNNING, lease_owner=run.lease_owner,
        ).update(lease_expires_at_ms=int(timezone.now().timestamp()*1000) + RUN_LEASE_MS):
            raise LeaseLostError()

    @staticmethod
    def pause(cursor, reason):
        if reason in ('rate_limited', 'unauthorized', 'configuration_error'):
            cursor.failure_count += 1
            cursor.pause_reason = reason
            cursor.cooldown_until_ms = (
                int(timezone.now().timestamp()*1000) + min(60, 15 * 2**min(cursor.failure_count-1, 2))*60*1000
                if reason == 'rate_limited' else None
            )

    @staticmethod
    def paused_reason(cursor):
        return paused_reason(cursor)

    def _fetch(self, kill_id: int, *, enrich=None) -> ProbeOutcome:
        try:
            method = getattr(self.client, "get_kill_info", None) or getattr(self.client, "fetch")
            accepts_override = enrich is not None and 'enrich' in inspect.signature(method).parameters
            value = method(kill_id, enrich=enrich) if accepts_override else method(kill_id)
        except Exception as exc:  # do not swallow cancellation/keyboard interrupts
            status = _exception_status(exc)
            if status is ProbeStatus.MALFORMED:
                raise
            return ProbeOutcome(status, error_code=str(getattr(exc, "code", "")))
        if isinstance(value, ProbeOutcome):
            return value
        deferred_stop = ''
        if isinstance(value, BaseReportResult):
            if value.stop_code not in ('rate_limited', 'unauthorized', 'network_error', 'budget_exhausted', 'malformed'):
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code='invalid_deferred_stop')
            deferred_stop, value = value.stop_code, value.decoded
        try:
            # Fake/in-process clients may already return the decoded mapping;
            # network clients return the verified MessagePack envelope.
            decoded = value if isinstance(value, dict) and "kill_blob" in value else decode_kill_info_response(value)
            if decoded is None:
                return ProbeOutcome(ProbeStatus.EMPTY)
            blob = decoded.get("kill_blob") if isinstance(decoded, dict) else None
            if blob is None:
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code="missing_kill_blob")
            # The captured forest only carries attackers/items/other. Identity,
            # timestamp and final-blow fields live in the verified outer map.
            # Pass that map through so reports such as those with no attacker
            # section still retain the victim and last-hit summary.
            # Some transports collect the game's character/corporation proxy
            # responses alongside the kill response.  Keep that enrichment
            # explicit and optional; the compact kill blob remains valid with
            # IDs only when no identity map is available.
            identity_map = decoded.get("identity_map") if isinstance(decoded, dict) else None
            parsed = parse_kill_blob(blob, summary=decoded, identity_map=identity_map)
            if parsed.get("kill_id") != kill_id:
                return ProbeOutcome(ProbeStatus.MALFORMED, error_code="kill_id_mismatch")
            return ProbeOutcome(ProbeStatus.REPORT, payload=parsed, deferred_stop_code=deferred_stop)
        except (KillProtocolError, KillParseError, TypeError, ValueError) as exc:
            return ProbeOutcome(ProbeStatus.MALFORMED, error_code=type(exc).__name__)

    def run(self, *, dry_run: bool = False, resume: bool = False) -> ProbeRun:
        """Claim a run in a short transaction, then do network I/O outside it.

        ``dry_run`` intentionally uses one rollback-only transaction so callers
        can exercise the full path without leaving policy, cursor, report, or
        run rows behind.
        """
        now_ms = int(timezone.now().timestamp() * 1000)
        if dry_run:
            with transaction.atomic():
                cursor = ProbeCursor.objects.select_for_update().get(pk=self.cursor.pk)
                self._recover_orphaned_runs(cursor, now_ms)
                self._assert_no_running(cursor)
                if resume:
                    self._resume(cursor)
                run = self._create_run(cursor)
                self._run_locked(run, cursor)
                transaction.set_rollback(True)
                return run

        with transaction.atomic():
            cursor = ProbeCursor.objects.select_for_update().get(pk=self.cursor.pk)
            self._recover_orphaned_runs(cursor, now_ms)
            self._assert_no_running(cursor)
            if resume:
                self._resume(cursor)
            run = self._create_run(cursor)
        try:
            self._run_locked(run, cursor)
        except Exception as exc:
            # This is deliberately a new short transaction; a failed transport
            # must remain observable even when report persistence rolled back.
            code = getattr(exc, 'code', None)
            error_code = (code if isinstance(code, str) and code in {status.value for status in ProbeStatus}
                          else _safe_error_code(type(exc).__name__) or 'failed')
            with transaction.atomic():
                failed = ProbeRun.objects.filter(pk=run.pk, status=ProbeRun.Status.RUNNING,
                                                lease_owner=run.lease_owner).update(
                    status=ProbeRun.Status.FAILED, stop_reason=run.stop_reason or 'failed',
                    error_code=error_code,
                    finished_at_ms=int(timezone.now().timestamp()*1000),
                    lease_owner='', lease_expires_at_ms=None)
                if failed:
                    diagnostics = record_diagnostics(run, self.client)
                    ProbeRun.objects.filter(pk=run.pk).update(diagnostics=run.diagnostics)
                    ProbeEvent.objects.create(run=run, kill_id=self.pending_id, status='failed',
                                              error_code=error_code, diagnostics=diagnostics)
            raise
        return run

    @staticmethod
    def _resume(cursor):
        cursor.pause_reason, cursor.cooldown_until_ms, cursor.failure_count = '', None, 0
        cursor.save(update_fields=['pause_reason', 'cooldown_until_ms', 'failure_count'])

    @staticmethod
    def _recover_orphaned_runs(cursor: ProbeCursor, now_ms: int) -> int:
        """Fail expired runs so a crashed worker cannot block the cursor forever."""
        recovered = ProbeRun.objects.filter(
            cursor=cursor,
            status=ProbeRun.Status.RUNNING,
        ).filter(
            Q(lease_expires_at_ms__lte=now_ms)
            | Q(lease_expires_at_ms__isnull=True)
        ).update(
            status=ProbeRun.Status.FAILED,
            stop_reason="lease_expired",
            error_code="lease_expired",
            finished_at_ms=now_ms,
            lease_owner="",
            lease_expires_at_ms=None,
        )
        if recovered and cursor.provisional_empty_id is not None:
            cursor.next_probe_id = cursor.provisional_empty_id
            cursor.provisional_empty_id = None
            cursor.save(update_fields=['next_probe_id', 'provisional_empty_id'])
        return recovered

    @staticmethod
    def _assert_no_running(cursor: ProbeCursor) -> None:
        if ProbeRun.objects.filter(cursor=cursor, status=ProbeRun.Status.RUNNING).exists():
            raise RuntimeError("probe cursor already has a running run")

    def _create_run(self, cursor: ProbeCursor) -> ProbeRun:
        now_ms = int(timezone.now().timestamp() * 1000)
        return ProbeRun.objects.create(
            cursor=cursor,
            policy=self.policy,
            status=ProbeRun.Status.RUNNING,
            started_at_ms=now_ms,
            lease_owner=uuid.uuid4().hex,
            lease_expires_at_ms=now_ms + RUN_LEASE_MS,
        )

    @staticmethod
    def _owned(run, cursor):
        # Always take cursor before run, matching claim/recovery lock order.
        ProbeCursor.objects.select_for_update().get(pk=cursor.pk)
        owned = ProbeRun.objects.select_for_update().get(pk=run.pk)
        if owned.status != ProbeRun.Status.RUNNING or owned.lease_owner != run.lease_owner:
            raise LeaseLostError()

    @transaction.atomic
    def _record(self, run, cursor, probe_id, outcome):
        self._owned(run, cursor)
        run.request_count += 1
        disposition = ''
        if outcome.status is ProbeStatus.REPORT:
            parsed = outcome.payload
            report_time = _time_value(parsed.get('kill_time_raw'))
            if cursor.last_success_kill_time and report_time and report_time < cursor.last_success_kill_time:
                run.stop_reason = 'time_reversed'
            else:
                report, created = persist_report(parsed, policy=self.policy, source=self.source)
                disposition = disposition_for(parsed, self.policy, report, created)
                run.report_count += 1
                if not outcome.deferred_stop_code:
                    cursor.pause_reason, cursor.cooldown_until_ms, cursor.failure_count = '', None, 0
                cursor.last_success_id = probe_id
                if report_time is not None:
                    cursor.last_success_kill_time = report_time
                cursor.consecutive_empty_count = 0
                self.first_empty = None
                cursor.provisional_empty_id = None
                cursor.next_probe_id = probe_id + 1
            if outcome.deferred_stop_code:
                run.stop_reason = run.error_code = outcome.deferred_stop_code
                self.pause(cursor, run.stop_reason)
        elif outcome.status is ProbeStatus.EMPTY:
            if self.first_empty is None:
                self.first_empty = probe_id
                cursor.provisional_empty_id = probe_id
            run.empty_count += 1
            cursor.consecutive_empty_count += 1
            cursor.next_probe_id = probe_id + 1
            if cursor.consecutive_empty_count >= self.config.empty_threshold:
                run.stop_reason = 'empty_threshold'
        else:
            run.error_code = outcome.status.value
            run.stop_reason = outcome.status.value
            self.pause(cursor, run.stop_reason)
        cursor.updated_at_ms = int(timezone.now().timestamp()*1000)
        cursor.save()
        diagnostics = record_diagnostics(run, self.client, disposition,
                                         enrichment_deferred=bool(outcome.deferred_stop_code))
        run.save(update_fields=['request_count', 'report_count', 'empty_count', 'error_code', 'stop_reason', 'diagnostics'])
        ProbeEvent.objects.create(
            run=run,
            kill_id=probe_id,
            status=outcome.status.value,
            error_code=_safe_error_code(outcome.error_code) or outcome.deferred_stop_code or
                       (outcome.status.value if outcome.status is not ProbeStatus.REPORT else ''),
            observed_at_ms=cursor.updated_at_ms,
            diagnostics=diagnostics,
        )

    @transaction.atomic
    def _finish(self, run, cursor):
        self._owned(run, cursor)
        if self.first_empty is not None:
            cursor.next_probe_id = self.first_empty
            cursor.provisional_empty_id = None
            cursor.save(update_fields=['next_probe_id', 'provisional_empty_id'])
        run.status, run.finished_at_ms = ProbeRun.Status.STOPPED, int(timezone.now().timestamp()*1000)
        run.lease_owner, run.lease_expires_at_ms = '', None
        run.save()

    def _run_locked(self, run: ProbeRun, cursor: ProbeCursor) -> None:
        self.active_run = run
        paused = self.paused_reason(cursor)
        if paused:
            run.stop_reason = paused
            self._finish(run, cursor)
            return
        if self.client_factory:
            try:
                self.client = self.client_factory()
            except Exception:
                with transaction.atomic():
                    self._owned(run, cursor)
                    cursor.pause_reason, cursor.cooldown_until_ms = 'configuration_error', None
                    cursor.save(update_fields=['pause_reason', 'cooldown_until_ms'])
                run.stop_reason = 'configuration_error'
                self._finish(run, cursor)
                return
        with transaction.atomic():
            self._owned(run, cursor)
            cursor.consecutive_empty_count = 0
            cursor.save(update_fields=['consecutive_empty_count'])
        next_id = cursor.next_probe_id
        if next_id is None and cursor.last_success_id is not None:
            next_id = cursor.last_success_id + 1
        if next_id is None:
            next_id = self.config.start_id
        if next_id is None:
            run.stop_reason = 'missing_start_id'
        while next_id is not None and run.request_count < self.config.max_requests and not run.stop_reason:
            if not 1 <= next_id <= self.config.MAX_ID:
                run.stop_reason = 'id_limit'
                break
            self.heartbeat()
            self.pending_id = next_id
            outcome = self._fetch(next_id)
            self._record(run, cursor, next_id, outcome)
            self.pending_id = None
            next_id = cursor.next_probe_id
        run.stop_reason = run.stop_reason or 'max_requests'
        self._finish(run, cursor)


def discover(*args, **kwargs):
    """Functional entry point retained for management-command callers."""
    return DiscoveryRunner(*args, **kwargs).run()
