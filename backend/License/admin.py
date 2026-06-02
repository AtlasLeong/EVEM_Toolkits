from django.contrib import admin

from .models import (
    ActivationCodeExtraScript,
    LicenseActivationCode,
    Plan,
    PlanScript,
    ScriptProduct,
    ValidationLog,
)


class PlanScriptInline(admin.TabularInline):
    model = PlanScript
    extra = 0


class ActivationCodeExtraScriptInline(admin.TabularInline):
    model = ActivationCodeExtraScript
    extra = 0


@admin.register(ScriptProduct)
class ScriptProductAdmin(admin.ModelAdmin):
    list_display = ('script_id', 'display_name', 'is_active', 'sort_order')
    list_filter = ('is_active',)
    search_fields = ('script_id', 'display_name')


@admin.register(Plan)
class PlanAdmin(admin.ModelAdmin):
    list_display = ('code', 'name', 'grant_all_scripts', 'is_active')
    list_filter = ('grant_all_scripts', 'is_active')
    inlines = [PlanScriptInline]


@admin.register(LicenseActivationCode)
class LicenseActivationCodeAdmin(admin.ModelAdmin):
    list_display = ('code', 'plan', 'is_active', 'expires_at', 'pc_identifier', 'last_used', 'remark')
    list_filter = ('plan', 'is_active')
    search_fields = ('code', 'pc_identifier', 'remark')
    inlines = [ActivationCodeExtraScriptInline]


@admin.register(ValidationLog)
class ValidationLogAdmin(admin.ModelAdmin):
    list_display = ('code', 'source', 'is_valid', 'message', 'pc_identifier', 'ip_address', 'created_at')
    list_filter = ('source', 'is_valid')
    search_fields = ('code', 'pc_identifier', 'message')
    readonly_fields = ('created_at',)

