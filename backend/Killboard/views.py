from datetime import datetime, timedelta

from django.db.models import Q
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from django.utils import timezone

from .models import KillReport, ProbeRun, ShipClass
from .serializers import detail_payload, report_payload


class PublicKillboardView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'killboard_public'


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


class ReportsView(PublicKillboardView):
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
        rows = KillReport.objects.all()
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
        return Response({
            'count': count,
            'page': page,
            'page_size': size,
            'results': [report_payload(row) for row in rows[offset:offset + size]],
        })


class ReportDetailView(PublicKillboardView):
    def get(self, request, kill_id):
        try:
            kill_id = int(kill_id)
        except (TypeError, ValueError):
            raise ValidationError({'kill_id': 'kill_id must be an integer.'})
        if kill_id < 1:
            raise ValidationError({'kill_id': 'kill_id must be positive.'})
        report = get_object_or_404(
            KillReport.objects.prefetch_related('participants', 'items'), kill_id=kill_id,
        )
        return Response(detail_payload(report))


class FiltersView(PublicKillboardView):
    def get(self, request):
        return Response({'ship_classes': [
            {'key': row.key, 'label': row.label, 'rank': row.rank}
            for row in ShipClass.objects.filter(enabled=True).order_by('rank', 'key')
        ]})


class StatusView(PublicKillboardView):
    def get(self, request):
        latest = KillReport.objects.order_by('-kill_time_display', '-kill_id').first()
        latest_run = ProbeRun.objects.order_by('-created_at_ms', '-id').first()
        return Response({
            'state': 'not_configured' if latest_run is None else latest_run.status,
            'collection_enabled': False,
            'last_collected_at': latest_run.finished_at_ms if latest_run else None,
            'latest_kill_id': str(latest.kill_id) if latest else None,
        })
