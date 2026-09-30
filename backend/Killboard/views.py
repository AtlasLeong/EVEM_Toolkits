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
from .models import KillReport, ProbeCursor, ProbeRun, ShipClass
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
            'state': paused or ('not_configured' if not ready else latest_run.status if latest_run else 'ready'),
            'configured': configured,
            'collection_enabled': ready,
            'last_collected_at': latest_run.finished_at_ms if latest_run else None,
            'latest_kill_id': str(latest.kill_id) if latest else None,
            'candidate_kill_id': str(cursor.candidate_id) if cursor and cursor.candidate_id else None,
            'coverage_verified': False,
            'cooldown_until_ms': cursor.cooldown_until_ms if cursor else None,
            'stop_reason': latest_run.stop_reason if latest_run else None,
            'last_success_id': str(cursor.last_success_id) if cursor and cursor.last_success_id else None,
        })
