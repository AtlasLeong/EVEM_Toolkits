import time

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import Http404
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, PermissionDenied, ValidationError
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import CollectionRun, MarketConfig, MarketConfigAudit, MarketItem, PriceSnapshot, epoch_ms
from .serializers import (
    ConfigPatchSerializer, ItemCreateSerializer, ItemPatchSerializer, admin_item_payload,
    item_payload, run_payload, utc_iso,
)
from .worker import MAX_ITEMS_PER_RUN


def page_parameters(request):
    try:
        page = int(request.query_params.get('page', '1'))
        requested_size = int(request.query_params.get('page_size', '50'))
    except (TypeError, ValueError):
        raise ValidationError({'page': 'Page and page_size must be integers.'})
    if not 1 <= page <= 10000 or requested_size < 1:
        raise ValidationError({'page': 'Page and page_size must be positive and page at most 10000.'})
    return page, min(requested_size, 100)


def paged_response(queryset, request, project):
    page, page_size = page_parameters(request)
    offset = (page - 1) * page_size
    return Response({
        'count': queryset.count(),
        'results': [project(row) for row in queryset[offset:offset + page_size]],
    })


def require_item_id_range(item_id):
    if not 1 <= item_id <= 2**63 - 1:
        raise Http404


def filter_items_by_query(items, raw_query, *, include_scope=False):
    query = raw_query.strip()
    if len(query) > 100:
        raise ValidationError({'q': 'Search text must be at most 100 characters.'})
    if not query:
        return items
    predicate = Q(name__icontains=query) | Q(category__icontains=query)
    if include_scope:
        predicate |= Q(scope__icontains=query)
    if query.isdecimal() and len(query) <= 19 and int(query) <= 2**63 - 1:
        predicate |= Q(pk=int(query))
    return items.filter(predicate)


class PublicItemsView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'market_public'

    def get(self, request):
        items = MarketItem.objects.filter(enabled=True).select_related('latest_price__snapshot')
        items = filter_items_by_query(items, request.query_params.get('q', ''), include_scope=True)
        return paged_response(items, request, item_payload)


class PublicHistoryView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'market_public'

    def get(self, request, item_id):
        require_item_id_range(item_id)
        item = get_object_or_404(MarketItem, pk=item_id, enabled=True)
        days = request.query_params.get('days', '1')
        if days not in {'1', '7', '30'}:
            raise ValidationError({'days': 'Choose 1, 7, or 30 days.'})
        cutoff_ms = int(time.time() * 1000) - int(days) * 24 * 60 * 60 * 1000
        snapshots = PriceSnapshot.objects.filter(item=item, observed_at_ms__gte=cutoff_ms)
        return paged_response(snapshots, request, lambda snapshot: {
            'observed_at': utc_iso(snapshot.observed_at_ms),
            'best_buy': str(snapshot.best_buy) if snapshot.best_buy is not None else None,
            'best_sell': str(snapshot.best_sell) if snapshot.best_sell is not None else None,
        })


class IsMarketStaff(BasePermission):
    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_staff)


class AdminView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated, IsMarketStaff]

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        response['Cache-Control'] = 'no-store, private'
        return response


def require_change_permission(user, model):
    if not user.is_staff or not user.has_perm(f'Market.change_{model}'):
        raise PermissionDenied('Market change permission is required.')


def config_payload(config):
    last_success = CollectionRun.objects.filter(
        status__in=['succeeded', 'partial'], success_count__gt=0,
        finished_at_ms__isnull=False,
    ).order_by('-finished_at_ms', '-id').first()
    last_run = CollectionRun.objects.first()
    return {
        'min_interval_seconds': config.min_interval_seconds,
        'max_interval_seconds': config.max_interval_seconds,
        'enabled': config.enabled,
        'next_run_at': utc_iso(config.next_due_at_ms),
        'next_due_at_ms': config.next_due_at_ms,
        'session_status': config.session_status,
        'enabled_item_count': MarketItem.objects.filter(enabled=True).count(),
        'max_items_per_run': MAX_ITEMS_PER_RUN,
        'last_success_at': utc_iso(last_success.finished_at_ms) if last_success else None,
        'last_run_failure_count': last_run.failure_count if last_run else 0,
    }


class AdminConfigView(AdminView):
    def get(self, request):
        config, _ = MarketConfig.objects.get_or_create(pk=1)
        return Response(config_payload(config))

    def patch(self, request):
        require_change_permission(request.user, 'marketconfig')
        with transaction.atomic():
            config, _ = MarketConfig.objects.select_for_update().get_or_create(pk=1)
            serializer = ConfigPatchSerializer(data=request.data, context={'config': config})
            serializer.is_valid(raise_exception=True)
            before = {
                'min_interval_seconds': config.min_interval_seconds,
                'max_interval_seconds': config.max_interval_seconds,
                'enabled': config.enabled,
            }
            for field, value in serializer.validated_data.items():
                setattr(config, field, value)
            after = {
                'min_interval_seconds': config.min_interval_seconds,
                'max_interval_seconds': config.max_interval_seconds,
                'enabled': config.enabled,
            }
            if before != after:
                config.updated_at_ms = epoch_ms()
                config.save(update_fields=[*serializer.validated_data.keys(), 'updated_at_ms'])
                MarketConfigAudit.objects.create(config=config, actor=request.user, before=before, after=after)
        return Response(config_payload(config))


class AdminItemsView(AdminView):
    def get(self, request):
        items = filter_items_by_query(MarketItem.objects.all(), request.query_params.get('q', ''))
        return paged_response(items, request, admin_item_payload)

    def post(self, request):
        require_change_permission(request.user, 'marketitem')
        serializer = ItemCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        attrs = dict(serializer.validated_data)
        item_id = int(attrs.pop('item_id'))
        try:
            with transaction.atomic():
                item = MarketItem.objects.create(id=item_id, **attrs)
        except IntegrityError:
            raise ValidationError({'item_id': 'This item already exists.'})
        return Response(admin_item_payload(item), status=201)


class AdminItemDetailView(AdminView):
    def patch(self, request, item_id):
        require_change_permission(request.user, 'marketitem')
        require_item_id_range(item_id)
        item = get_object_or_404(MarketItem, pk=item_id)
        serializer = ItemPatchSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        for field, value in serializer.validated_data.items():
            setattr(item, field, value)
        if serializer.validated_data:
            item.save(update_fields=serializer.validated_data.keys())
        return Response(admin_item_payload(item))


class AdminRunsView(AdminView):
    def get(self, request):
        return paged_response(CollectionRun.objects.all(), request, run_payload)


class Conflict(APIException):
    status_code = 409
    default_detail = 'A collection run is already queued or running.'


class AdminRunView(AdminView):
    def post(self, request):
        require_change_permission(request.user, 'collectionrun')
        if request.data:
            raise ValidationError({'non_field_errors': ['Manual run accepts no request fields.']})
        with transaction.atomic():
            MarketConfig.objects.select_for_update().get_or_create(pk=1)
            active_run = CollectionRun.objects.filter(
                Q(status='queued') | Q(status='running', lease_expires_at_ms__gt=epoch_ms())
            )
            if active_run.exists():
                raise Conflict()
            run = CollectionRun.objects.create(trigger='manual', status='queued', requested_by=request.user)
        return Response(run_payload(run), status=202)
