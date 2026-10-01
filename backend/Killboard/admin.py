from django.contrib import admin

from .models import (
    CollectionPolicy,
    KillItem,
    KillParticipant,
    KillReport,
    ProbeCursor,
    ProbeRun,
    ShipClass,
)


@admin.register(ShipClass)
class ShipClassAdmin(admin.ModelAdmin):
    list_display = ('key', 'label', 'rank', 'enabled')
    list_filter = ('enabled',)
    search_fields = ('key', 'label')


@admin.register(CollectionPolicy)
class CollectionPolicyAdmin(admin.ModelAdmin):
    list_display = ('name', 'min_ship_rank', 'min_isk_lost', 'enabled')
    list_filter = ('enabled',)


@admin.register(KillReport)
class KillReportAdmin(admin.ModelAdmin):
    list_display = ('kill_id', 'ship_name', 'ship_class_key', 'system_name', 'kill_time_display', 'completeness')
    list_filter = ('ship_class_key', 'completeness', 'time_quality')
    search_fields = ('kill_id', 'ship_name', 'victim_name', 'system_name')
    readonly_fields = ('kill_id', 'collected_at_ms', 'updated_at_ms')


@admin.register(KillParticipant)
class KillParticipantAdmin(admin.ModelAdmin):
    list_display = ('report', 'character_name', 'damage', 'damage_pct', 'is_final_blow', 'is_top_damage')
    list_filter = ('is_final_blow', 'is_top_damage')
    search_fields = ('character_name', 'corporation_name', 'alliance_name')


@admin.register(KillItem)
class KillItemAdmin(admin.ModelAdmin):
    list_display = ('report', 'name', 'status', 'quantity_dropped', 'quantity_destroyed', 'quantity_unknown')
    list_filter = ('status',)
    search_fields = ('name', 'type_id')


@admin.register(ProbeCursor)
class ProbeCursorAdmin(admin.ModelAdmin):
    list_display = ('name', 'last_success_id', 'next_probe_id', 'consecutive_empty_count', 'updated_at_ms')


@admin.register(ProbeRun)
class ProbeRunAdmin(admin.ModelAdmin):
    list_display = ('id', 'status', 'request_count', 'report_count', 'empty_count', 'stop_reason', 'lease_expires_at_ms', 'created_at_ms')
    list_filter = ('status',)
