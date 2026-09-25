from collections.abc import Mapping
from datetime import datetime, timezone
import time

from rest_framework import serializers


STALE_AFTER_MS = 2 * 60 * 60 * 1000


def utc_iso(epoch_millis):
    if epoch_millis is None:
        return None
    return datetime.fromtimestamp(epoch_millis / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


def price_levels(snapshot, field):
    """Expose bounded top-five levels without changing legacy empty payloads."""
    values = getattr(snapshot, field, None) if snapshot is not None else None
    if not isinstance(values, (list, tuple)):
        return []
    return [str(value) for value in values[:5]]


def item_payload(item, now_ms=None):
    now_ms = int(time.time() * 1000) if now_ms is None else now_ms
    try:
        snapshot = item.latest_price.snapshot
    except (AttributeError, type(item).latest_price.RelatedObjectDoesNotExist):
        snapshot = None

    observed_at_ms = snapshot.observed_at_ms if snapshot else None
    if snapshot is None:
        status = 'uncollected'
    elif now_ms - observed_at_ms > STALE_AFTER_MS:
        status = 'stale'
    elif snapshot.best_buy is None and snapshot.best_sell is None:
        status = 'empty'
    else:
        status = 'fresh'
    payload = {
        'item_id': str(item.pk),
        'name': item.name,
        'category': item.category,
        'category_id': item.category_id,
        'subcategory_id': item.subcategory_id,
        'scope': item.scope,
        'best_buy': str(snapshot.best_buy) if snapshot and snapshot.best_buy is not None else None,
        'best_sell': str(snapshot.best_sell) if snapshot and snapshot.best_sell is not None else None,
        'observed_at': utc_iso(observed_at_ms),
        'status': status,
    }
    sell_prices = price_levels(snapshot, 'sell_prices')
    buy_prices = price_levels(snapshot, 'buy_prices')
    # Keep the pre-top-five response shape for old snapshots while making new
    # collected snapshots immediately consumable by the terminal.
    if sell_prices:
        payload['sell_prices'] = sell_prices
    if buy_prices:
        payload['buy_prices'] = buy_prices
    return payload


class StrictSerializer(serializers.Serializer):
    def to_internal_value(self, data):
        if not isinstance(data, Mapping):
            raise serializers.ValidationError({'non_field_errors': ['Expected a JSON object.']})
        unknown = set(data) - set(self.fields)
        if unknown:
            raise serializers.ValidationError({key: 'Unknown field.' for key in sorted(unknown)})
        return super().to_internal_value(data)


class ConfigPatchSerializer(StrictSerializer):
    min_interval_seconds = serializers.IntegerField(min_value=2100, max_value=3060, required=False)
    max_interval_seconds = serializers.IntegerField(min_value=2100, max_value=3060, required=False)
    enabled = serializers.BooleanField(required=False)

    def validate(self, attrs):
        current = self.context['config']
        minimum = attrs.get('min_interval_seconds', current.min_interval_seconds)
        maximum = attrs.get('max_interval_seconds', current.max_interval_seconds)
        if minimum > maximum:
            raise serializers.ValidationError({'max_interval_seconds': 'Must be at least min_interval_seconds.'})
        return attrs


class ItemCreateSerializer(StrictSerializer):
    item_id = serializers.RegexField(r'^[1-9][0-9]*$', max_length=19)
    name = serializers.CharField(max_length=255)
    category = serializers.CharField(max_length=120, allow_blank=True, required=False, default='')
    scope = serializers.ChoiceField(choices=['global'], required=False, default='global')
    enabled = serializers.BooleanField(required=False, default=True)

    def validate_item_id(self, value):
        if int(value) > 2**63 - 1:
            raise serializers.ValidationError('Item ID exceeds signed 64-bit range.')
        return value


class ItemPatchSerializer(StrictSerializer):
    name = serializers.CharField(max_length=255, required=False)
    category = serializers.CharField(max_length=120, allow_blank=True, required=False)
    scope = serializers.ChoiceField(choices=['global'], required=False)
    enabled = serializers.BooleanField(required=False)


def admin_item_payload(item):
    return {
        'item_id': str(item.pk),
        'name': item.name,
        'category': item.category,
        'scope': item.scope,
        'enabled': item.enabled,
        'last_failure': safe_error_code(item.last_error_code) or None,
    }


def safe_error_code(value):
    safe_codes = {
        'AUTH_EXPIRED', 'ORDER_TIMEOUT', 'COLLECTION_ERROR',
        'needs_auth', 'lease_expired', 'no_enabled_items', 'item_error', 'collection_error',
    }
    return value if not value or value in safe_codes else 'COLLECTION_ERROR'


def run_payload(run):
    return {
        'id': run.pk,
        'status': run.status,
        'trigger': run.trigger,
        'created_at': utc_iso(run.created_at_ms),
        'started_at': utc_iso(run.started_at_ms),
        'finished_at': utc_iso(run.finished_at_ms),
        'created_at_ms': run.created_at_ms,
        'started_at_ms': run.started_at_ms,
        'finished_at_ms': run.finished_at_ms,
        'success_count': run.success_count,
        'failure_count': run.failure_count,
        'error_code': safe_error_code(run.error_code),
    }
