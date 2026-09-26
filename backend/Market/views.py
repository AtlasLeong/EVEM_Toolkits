import time
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Count, Q
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
    item_payload, price_levels, run_payload, utc_iso,
)
from .worker import MAX_ITEMS_PER_RUN
from .taxonomy import (
    BUCKET_LABELS, BUCKET_OTHER, PRIMARY_BUCKETS, is_primary_bucket,
)


CATEGORY_LABELS = {
    100: '技能与采集',
    1000: '舰船',
    1010: '武器',
    1020: '装备',
    1030: '战术装备',
    1040: '战斗改装件',
    1050: '工程改装件',
    1100: '建筑',
    1200: '旗舰组件',
    1700: '蓝图',
    2000: '植入体',
    3950: '数据核心',
    4000: '涂装',
    5000: '弹药',
}
KNOWN_CATEGORY_IDS = frozenset(CATEGORY_LABELS)


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


def filter_items_by_category(items, raw_category_id):
    if raw_category_id is None:
        return items
    if raw_category_id in PRIMARY_BUCKETS:
        return items.filter(market_bucket=raw_category_id)
    if raw_category_id == 'other':
        # Once the catalog has logical buckets, "other" means the explicit
        # catch-all bucket.  The legacy branch keeps old operator-created rows
        # filterable by their official category ids until the catalog is
        # reseeded.
        if items.filter(market_bucket__in=PRIMARY_BUCKETS).exists():
            return items.filter(market_bucket=BUCKET_OTHER)
        return items.filter(
            Q(category_id__isnull=True) | Q(category_id=0) | ~Q(category_id__in=KNOWN_CATEGORY_IDS)
        )
    if not raw_category_id.isdecimal() or len(raw_category_id) > 19:
        raise ValidationError({'category_id': 'Choose a non-negative category ID or other.'})
    category_id = int(raw_category_id)
    if category_id > 2**63 - 1:
        raise ValidationError({'category_id': 'Category ID exceeds signed 64-bit range.'})
    if category_id == 0:
        return items.filter(Q(category_id__isnull=True) | Q(category_id=0))
    return items.filter(category_id=category_id)


class PublicCategoriesView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'market_public'

    def get(self, request):
        logical_totals = MarketItem.objects.filter(enabled=True).values('market_bucket').annotate(count=Count('pk'))
        logical_counts = {row['market_bucket']: row['count'] for row in logical_totals}
        has_logical_catalog = MarketItem.objects.filter(market_bucket__in=PRIMARY_BUCKETS).exists()
        if has_logical_catalog:
            categories = [
                {'id': bucket, 'label': BUCKET_LABELS[bucket], 'count': logical_counts.get(bucket, 0)}
                for bucket in PRIMARY_BUCKETS
            ]
            if logical_counts.get(BUCKET_OTHER, 0):
                categories.append({
                    'id': BUCKET_OTHER,
                    'label': BUCKET_LABELS[BUCKET_OTHER],
                    'count': logical_counts[BUCKET_OTHER],
                })
            return Response(categories)

        # Compatibility for rows created before the logical taxonomy existed.
        # A normal seeded installation enters the branch above as soon as one
        # of the three selectable buckets is enabled.
        totals = MarketItem.objects.filter(enabled=True).values('category_id').annotate(count=Count('pk'))
        categories = []
        other_count = 0
        for row in totals:
            category_id = row['category_id']
            if category_id in (None, 0) or category_id not in KNOWN_CATEGORY_IDS:
                other_count += row['count']
            else:
                categories.append({
                    'id': category_id,
                    'label': CATEGORY_LABELS.get(category_id, '其他'),
                    'count': row['count'],
                })
        categories.sort(key=lambda category: category['id'])
        if other_count:
            categories.append({'id': 'other', 'label': '其他', 'count': other_count})
        return Response(categories)


class PublicItemsView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = 'market_public'

    def get(self, request):
        items = MarketItem.objects.filter(enabled=True).select_related('latest_price__snapshot')
        items = filter_items_by_category(items, request.query_params.get('category_id'))
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
        def history_payload(snapshot):
            payload = {
                'observed_at': utc_iso(snapshot.observed_at_ms),
                'best_buy': str(snapshot.best_buy) if snapshot.best_buy is not None else None,
                'best_sell': str(snapshot.best_sell) if snapshot.best_sell is not None else None,
            }
            sell_prices = price_levels(snapshot, 'sell_prices')
            buy_prices = price_levels(snapshot, 'buy_prices')
            if sell_prices:
                payload['sell_prices'] = sell_prices
            if buy_prices:
                payload['buy_prices'] = buy_prices
            return payload
        return paged_response(snapshots, request, history_payload)


def series_change(first, last):
    if first is None or last is None or first == last:
        if first is None or last is None:
            return {'absolute': None, 'percent': None}
        return {'absolute': '0.00', 'percent': '0.00'}
    if first == 0:
        return {'absolute': None, 'percent': None}
    change = last - first
    precision = Decimal('0.01')
    return {
        'absolute': str(change.quantize(precision)),
        'percent': str(((change / first) * 100).quantize(precision)),
    }


SERIES_POINT_LIMIT = 240
MONTH_MS = 30 * 24 * 60 * 60 * 1000


def _empty_series_state():
    return {'first': None, 'current': None, 'high': None, 'low': None}


def _series_candidate(row, field, row_index):
    value = row[field]
    if value is None:
        return None
    return {
        'value': value,
        'observed_at_ms': row['observed_at_ms'],
        'row_index': row_index,
    }


def _update_series_state(state, candidate):
    if candidate is None:
        return
    if state['first'] is None:
        state['first'] = candidate
    state['current'] = candidate
    if state['high'] is None or candidate['value'] > state['high']['value']:
        state['high'] = candidate
    if state['low'] is None or candidate['value'] < state['low']['value']:
        state['low'] = candidate


def _public_series_candidate(candidate):
    if candidate is None:
        return None
    return {
        'value': str(candidate['value']),
        'observed_at': utc_iso(candidate['observed_at_ms']),
    }


def _public_series_stats(states):
    return {
        key: {
            'current': _public_series_candidate(state['current']),
            'range': {
                'high': _public_series_candidate(state['high']),
                'low': _public_series_candidate(state['low']),
            },
            'month': {
                'high': _public_series_candidate(month_state['high']),
                'low': _public_series_candidate(month_state['low']),
            },
        }
        for key, state, month_state in (
            ('buy', states['buy'], states['month_buy']),
            ('sell', states['sell'], states['month_sell']),
        )
    }


class PublicSeriesView(APIView):
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
        now_ms = int(time.time() * 1000)
        cutoff_ms = now_ms - int(days) * 24 * 60 * 60 * 1000
        month_cutoff_ms = now_ms - MONTH_MS
        snapshots = PriceSnapshot.objects.filter(
            item=item, observed_at_ms__gte=month_cutoff_ms,
        ).order_by('observed_at_ms', 'id').values(
            'id', 'observed_at_ms', 'best_buy', 'best_sell', 'buy_prices', 'sell_prices',
        )
        selected_count = snapshots.filter(observed_at_ms__gte=cutoff_ms).count()
        if selected_count:
            sample_indexes = (
                set(range(selected_count)) if selected_count <= SERIES_POINT_LIMIT else
                {index * (selected_count - 1) // (SERIES_POINT_LIMIT - 1)
                 for index in range(SERIES_POINT_LIMIT)}
            )
        else:
            sample_indexes = set()
        selected_rows = {}
        special_rows = {}
        states = {
            'buy': _empty_series_state(),
            'sell': _empty_series_state(),
            'month_buy': _empty_series_state(),
            'month_sell': _empty_series_state(),
        }
        selected_index = 0
        for snapshot in snapshots.iterator(chunk_size=500):
            month_buy = _series_candidate(snapshot, 'best_buy', selected_index)
            month_sell = _series_candidate(snapshot, 'best_sell', selected_index)
            _update_series_state(states['month_buy'], month_buy)
            _update_series_state(states['month_sell'], month_sell)
            if snapshot['observed_at_ms'] < cutoff_ms:
                continue
            row_index = selected_index
            selected_index += 1
            if row_index in sample_indexes:
                selected_rows[row_index] = snapshot
            buy = _series_candidate(snapshot, 'best_buy', row_index)
            sell = _series_candidate(snapshot, 'best_sell', row_index)
            before_buy_extreme = (states['buy']['high'], states['buy']['low'])
            before_sell_extreme = (states['sell']['high'], states['sell']['low'])
            _update_series_state(states['buy'], buy)
            _update_series_state(states['sell'], sell)
            if (states['buy']['high'], states['buy']['low']) != before_buy_extreme or (states['sell']['high'], states['sell']['low']) != before_sell_extreme:
                special_rows[row_index] = snapshot

        protected_indexes = {0, selected_count - 1} if selected_count else set()
        for state_key in ('buy', 'sell'):
            for extreme_key in ('high', 'low'):
                candidate = states[state_key][extreme_key]
                if candidate is not None:
                    protected_indexes.add(candidate['row_index'])
        candidate_indexes = set(selected_rows) | set(special_rows)
        if len(candidate_indexes) > SERIES_POINT_LIMIT:
            selected_indexes = {
                row_index for row_index in protected_indexes if row_index in candidate_indexes
            }
            # Prefer the evenly distributed base sample, then fill any remaining
            # slots from extrema candidates. Protected rows are always retained.
            for row_index in list(sorted(sample_indexes)) + sorted(candidate_indexes):
                if len(selected_indexes) >= SERIES_POINT_LIMIT:
                    break
                if row_index in candidate_indexes:
                    selected_indexes.add(row_index)
        else:
            selected_indexes = candidate_indexes
        sampled = [
            {**selected_rows.get(row_index, {}), **special_rows.get(row_index, {})}
            for row_index in sorted(selected_indexes)
        ]
        points = []
        for snapshot in sampled:
            point = {
                'observed_at': utc_iso(snapshot['observed_at_ms']),
                'best_buy': str(snapshot['best_buy']) if snapshot['best_buy'] is not None else None,
                'best_sell': str(snapshot['best_sell']) if snapshot['best_sell'] is not None else None,
            }
            sell_prices = [str(value) for value in (snapshot.get('sell_prices') or [])[:5]]
            buy_prices = [str(value) for value in (snapshot.get('buy_prices') or [])[:5]]
            if sell_prices:
                point['sell_prices'] = sell_prices
            if buy_prices:
                point['buy_prices'] = buy_prices
            points.append(point)
        return Response({
            'count': selected_count,
            'points': points,
            'change': {
                'best_buy': series_change(states['buy']['first']['value'], states['buy']['current']['value']) if states['buy']['first'] is not None and states['buy']['current'] is not None else {'absolute': None, 'percent': None},
                'best_sell': series_change(states['sell']['first']['value'], states['sell']['current']['value']) if states['sell']['first'] is not None and states['sell']['current'] is not None else {'absolute': None, 'percent': None},
            },
            'stats': _public_series_stats(states),
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
