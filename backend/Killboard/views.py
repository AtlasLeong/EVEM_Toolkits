from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation

from django.db.models import Q
from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication
from django.utils import timezone

from .access import KillboardOwnerPermission, can_view_killboard
from .diagnostics import (DEFAULT_WINDOW_HOURS, audit_error as _audit_error,
                          audit_status, bounded_integer as _bounded_integer,
                          diagnostic_summary, safe_diagnostics as _safe_diagnostics,
                          validate_window_hours)
from .models import KillReport, ProbeCursor, ProbeEvent, ProbeRun, ShipClass
from .worker import paused_reason
from .serializers import detail_payload, report_payload
from .security import system_security_map


class PrivateKillboardResponseMixin:
    """Prevent private report data from being shared by browser/CDN caches."""

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store, private'
        vary = {part.strip() for part in response.get('Vary', '').split(',') if part.strip()}
        vary.add('Authorization')
        response['Vary'] = ', '.join(sorted(vary))
        return response


class PrivateKillboardView(PrivateKillboardResponseMixin, APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, KillboardOwnerPermission]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'killboard_private'


class KillboardAccessView(PrivateKillboardResponseMixin, APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'killboard_private'

    def get(self, request):
        return Response({'can_view_killboard': can_view_killboard(request.user)})


def _page(request):
    try:
        page = int(request.query_params.get('page', '1'))
        size = int(request.query_params.get('page_size', '25'))
    except (TypeError, ValueError):
        raise ValidationError({'page': 'page and page_size must be integers.'})
    if page < 1 or size < 1 or size > 100:
        raise ValidationError({'page': 'page must be positive and page_size must be between 1 and 100.'})
    return page, size


def _text(request, key, maximum=80):
    value = request.query_params.get(key, '').strip()
    if len(value) > maximum:
        raise ValidationError({key: f'{key} is too long.'})
    return value


def _date(value, key):
    if not value:
        return None
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except ValueError as exc:
        raise ValidationError({key: 'Use YYYY-MM-DD.'}) from exc


def _day_start(value):
    point = datetime.combine(value, datetime.min.time())
    return timezone.make_aware(point) if timezone.is_aware(timezone.now()) else point


def _minimum_isk_lost():
    try:
        value = Decimal(str(getattr(settings, 'KILLBOARD_MIN_ISK_LOST', '20000000000.00')))
        return value if value.is_finite() and value >= 0 else Decimal('20000000000.00')
    except (InvalidOperation, TypeError, ValueError):
        return Decimal('20000000000.00')


def _strategy_summary(value):
    state = value if isinstance(value, dict) else {}
    raw_ranges = state.get('pending_ranges')
    ranges = []
    if isinstance(raw_ranges, list):
        for pair in raw_ranges[:256]:
            if not isinstance(pair, list) or len(pair) != 2:
                continue
            lower, upper = (_bounded_integer(point) for point in pair)
            if lower is not None and upper is not None and 0 < lower <= upper:
                ranges.append((lower, upper))
    frontier = _bounded_integer(state.get('frontier'))
    deferred = state.get('deferred_ids')
    deferred_count = 0
    if isinstance(deferred, dict):
        deferred_count = sum(
            1 for identifier, retry_at in list(deferred.items())[:256]
            if isinstance(identifier, str) and 1 <= len(identifier) <= 19
            and identifier.isascii() and identifier.isdecimal()
            and 0 < int(identifier) <= 2**63 - 1 and _bounded_integer(retry_at) is not None
        )
    return {
        'phase': state.get('phase') if state.get('phase') in ('locate', 'scan') else 'unknown',
        'newest_candidate_id': str(frontier) if frontier and _bounded_integer(state.get('last_boundary_at_ms')) else None,
        'historical_next_id': str(min(pair[0] for pair in ranges)) if ranges else None,
        'pending_range_count': len(ranges),
        'pending_id_count': sum(upper - lower + 1 for lower, upper in ranges),
        'deferred_id_count': deferred_count,
        'last_boundary_at_ms': _bounded_integer(state.get('last_boundary_at_ms')),
        # A bounded frontier search never proves complete collection coverage.
        'coverage_verified': False,
    }


class ReportsView(PrivateKillboardView):
    def get(self, request):
        page, size = _page(request)
        query = _text(request, 'q')
        ship_class = _text(request, 'ship_class', 64)
        system = _text(request, 'system')
        character = _text(request, 'character')
        corporation = _text(request, 'corporation')
        from_date = _date(_text(request, 'from', 10), 'from')
        to_date = _date(_text(request, 'to', 10), 'to')
        if from_date and to_date and from_date > to_date:
            raise ValidationError({'to': 'to must not be earlier than from.'})
        rows = KillReport.objects.filter(isk_lost__gt=_minimum_isk_lost())
        if query:
            rows = rows.filter(
                Q(ship_name__icontains=query) | Q(system_name__icontains=query)
                | Q(victim_name__icontains=query) | Q(victim_corporation_name__icontains=query)
            )
        if ship_class:
            rows = rows.filter(ship_class_key=ship_class)
        if system:
            predicate = Q(system_name__icontains=system)
            if system.isdecimal():
                predicate |= Q(system_id=int(system))
            rows = rows.filter(predicate)
        if character:
            predicate = Q(victim_name__icontains=character)
            if character.isdecimal():
                predicate |= Q(victim_character_id=int(character))
            rows = rows.filter(predicate)
        if corporation:
            predicate = Q(victim_corporation_name__icontains=corporation)
            if corporation.isdecimal():
                predicate |= Q(victim_corporation_id=int(corporation))
            rows = rows.filter(predicate)
        if from_date:
            rows = rows.filter(kill_time_display__gte=_day_start(from_date))
        if to_date:
            rows = rows.filter(kill_time_display__lt=_day_start(to_date + timedelta(days=1)))
        rows = rows.order_by('-kill_time_display', '-kill_id')
        count = rows.count()
        offset = (page - 1) * size
        page_rows = list(rows[offset:offset + size])
        security = system_security_map(row.system_id for row in page_rows)
        return Response({
            'count': count,
            'page': page,
            'page_size': size,
            'results': [report_payload(row, security=security.get(str(row.system_id))) for row in page_rows],
        })


class ReportDetailView(PrivateKillboardView):
    def get(self, request, kill_id):
        try:
            kill_id = int(kill_id)
        except (TypeError, ValueError):
            raise ValidationError({'kill_id': 'kill_id must be an integer.'})
        if kill_id < 1:
            raise ValidationError({'kill_id': 'kill_id must be positive.'})
        report = get_object_or_404(
            KillReport.objects.prefetch_related('participants', 'items').filter(isk_lost__gt=_minimum_isk_lost()), kill_id=kill_id,
        )
        security = system_security_map([report.system_id]).get(str(report.system_id))
        return Response(detail_payload(report, security=security))


class FiltersView(PrivateKillboardView):
    def get(self, request):
        return Response({'ship_classes': [
            {'key': row.key, 'label': row.label, 'rank': row.rank}
            for row in ShipClass.objects.filter(enabled=True).order_by('rank', 'key')
        ]})


class StatusView(PrivateKillboardView):
    def get(self, request):
        latest = KillReport.objects.filter(isk_lost__gt=_minimum_isk_lost()).order_by('-kill_time_display', '-kill_id').first()
        cursor = ProbeCursor.objects.filter(name='latest').first()
        latest_run = ProbeRun.objects.filter(cursor=cursor).order_by('-created_at_ms', '-id').first() if cursor else None
        configured = bool(getattr(settings, 'KILLBOARD_COLLECTION_ENABLED', False))
        paused = paused_reason(cursor) if cursor else ''
        ready = configured and cursor is not None and cursor.next_probe_id is not None and not paused
        return Response({
            'state': paused or ('not_configured' if not ready else audit_status(latest_run.status, run=True) if latest_run else 'ready'),
            'configured': configured,
            'collection_enabled': ready,
            'last_collected_at': latest_run.finished_at_ms if latest_run else None,
            'latest_kill_id': str(latest.kill_id) if latest else None,
            'candidate_kill_id': str(cursor.candidate_id) if cursor and cursor.candidate_id else None,
            'coverage_verified': False,
            'cooldown_until_ms': cursor.cooldown_until_ms if cursor else None,
            'stop_reason': _audit_error(latest_run.stop_reason) if latest_run else None,
            'last_success_id': str(cursor.last_success_id) if cursor and cursor.last_success_id else None,
        })


class CollectorLogsView(PrivateKillboardView):
    """Read-only collector health and audit data for the configured owner."""

    def get(self, request):
        try:
            raw_hours = request.query_params.get('window_hours', str(DEFAULT_WINDOW_HOURS))
            if len(raw_hours) > 3 or not raw_hours.isascii() or not raw_hours.isdecimal():
                raise ValueError('window_hours must be a bounded integer.')
            window_hours = validate_window_hours(int(raw_hours))
        except (TypeError, ValueError) as exc:
            raise ValidationError({'window_hours': str(exc)}) from None
        cursor = ProbeCursor.objects.filter(name='latest').first()
        configured = bool(getattr(settings, 'KILLBOARD_COLLECTION_ENABLED', False))
        latest_report = KillReport.objects.order_by('-collected_at_ms', '-kill_id').first()
        runs = []
        events = []
        if cursor is not None:
            run_rows = ProbeRun.objects.filter(cursor=cursor).order_by('-created_at_ms', '-id')[:30]
            runs = [
                {
                    'id': row.pk,
                    'status': audit_status(row.status, run=True),
                    'created_at_ms': row.created_at_ms,
                    'started_at_ms': row.started_at_ms,
                    'finished_at_ms': row.finished_at_ms,
                    'request_count': row.request_count,
                    'report_count': row.report_count,
                    'empty_count': row.empty_count,
                    'stop_reason': _audit_error(row.stop_reason),
                    'error_code': _audit_error(row.error_code),
                    'diagnostics': _safe_diagnostics(row.diagnostics),
                }
                for row in run_rows
            ]
            event_rows = ProbeEvent.objects.filter(run__cursor=cursor).order_by(
                '-observed_at_ms', '-id',
            )[:100]
            events = [
                {
                    'id': row.pk,
                    'run_id': row.run_id,
                    'kill_id': str(row.kill_id) if row.kill_id is not None else None,
                    'status': audit_status(row.status),
                    'error_code': _audit_error(row.error_code),
                    'observed_at_ms': row.observed_at_ms,
                    'duration_ms': row.duration_ms,
                    'diagnostics': _safe_diagnostics(row.diagnostics),
                }
                for row in event_rows
            ]
        return Response({
            'configured': configured,
            'collection_enabled': bool(configured and cursor and cursor.next_probe_id and not paused_reason(cursor)),
            'latest_kill_id': str(latest_report.kill_id) if latest_report else None,
            'latest_report_collected_at_ms': latest_report.collected_at_ms if latest_report else None,
            'cursor': {
                'name': cursor.name if cursor else 'latest',
                'last_success_id': str(cursor.last_success_id) if cursor and cursor.last_success_id else None,
                'next_probe_id': str(cursor.next_probe_id) if cursor and cursor.next_probe_id else None,
                'pause_reason': _audit_error(cursor.pause_reason) if cursor else '',
                'cooldown_until_ms': cursor.cooldown_until_ms if cursor else None,
                'failure_count': cursor.failure_count if cursor else 0,
                'updated_at_ms': cursor.updated_at_ms if cursor else None,
                'strategy': _strategy_summary(cursor.strategy_state if cursor else {}),
            },
            'runs': runs,
            'events': events,
            'summary': diagnostic_summary(cursor, window_hours=window_hours),
        })
