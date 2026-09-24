from django.contrib import admin

from .models import CollectionRun, LatestPrice, MarketConfig, MarketConfigAudit, MarketItem, PriceSnapshot


class ReadOnlyMarketAdmin(admin.ModelAdmin):
    """Market writes go through audited APIs or the collector, not Django admin."""

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False


@admin.register(MarketItem)
class MarketItemAdmin(ReadOnlyMarketAdmin):
    list_display = ('id', 'name', 'category', 'scope', 'enabled')
    search_fields = ('id', 'name')
    list_filter = ('enabled', 'scope')


@admin.register(MarketConfig)
class MarketConfigAdmin(ReadOnlyMarketAdmin):
    list_display = ('id', 'min_interval_seconds', 'max_interval_seconds', 'enabled', 'session_status')


@admin.register(MarketConfigAudit)
class MarketConfigAuditAdmin(ReadOnlyMarketAdmin):
    list_display = ('id', 'actor', 'changed_at_ms')


@admin.register(CollectionRun)
class CollectionRunAdmin(ReadOnlyMarketAdmin):
    list_display = ('id', 'status', 'trigger', 'success_count', 'failure_count', 'created_at_ms')
    list_filter = ('status', 'trigger')


@admin.register(PriceSnapshot)
class PriceSnapshotAdmin(ReadOnlyMarketAdmin):
    list_display = ('id', 'item', 'best_buy', 'best_sell', 'observed_at_ms', 'run')


@admin.register(LatestPrice)
class LatestPriceAdmin(ReadOnlyMarketAdmin):
    list_display = ('item', 'snapshot', 'updated_at_ms')
