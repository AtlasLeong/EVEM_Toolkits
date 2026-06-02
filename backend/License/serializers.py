from rest_framework import serializers

from .models import LicenseActivationCode, Plan, ScriptProduct
from .services import build_permissions_for_activation


class ScriptProductSerializer(serializers.ModelSerializer):
    class Meta:
        model = ScriptProduct
        fields = ['script_id', 'display_name', 'is_active', 'sort_order']


class PlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = Plan
        fields = ['code', 'name', 'grant_all_scripts', 'is_active']


class LicenseActivationCodeSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)

    class Meta:
        model = LicenseActivationCode
        fields = ['code', 'expires_at', 'last_used', 'remark', 'plan']


class LicenseActivationCodeManagementSerializer(serializers.ModelSerializer):
    plan = PlanSerializer(read_only=True)
    extra_script_ids = serializers.SerializerMethodField()
    permissions = serializers.SerializerMethodField()

    class Meta:
        model = LicenseActivationCode
        fields = [
            'id',
            'code',
            'is_active',
            'expires_at',
            'pc_identifier',
            'last_used',
            'remark',
            'plan',
            'extra_script_ids',
            'permissions',
            'created_at',
            'updated_at',
        ]

    def get_extra_script_ids(self, obj):
        return list(obj.extra_scripts.filter(is_active=True).order_by('sort_order', 'id').values_list('script_id', flat=True))

    def get_permissions(self, obj):
        return build_permissions_for_activation(obj)


class LicenseActivationCodeCreateSerializer(serializers.Serializer):
    expiration_days = serializers.IntegerField(min_value=1)
    plan = serializers.CharField(required=False, default='default')
    remark = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    extra_script_ids = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
    )


class LicenseActivationCodeUpdateSerializer(serializers.Serializer):
    plan = serializers.CharField(required=False)
    is_active = serializers.BooleanField(required=False)
    expires_at = serializers.DateTimeField(required=False)
    remark = serializers.CharField(required=False, allow_blank=True, allow_null=True, max_length=255)
    extra_script_ids = serializers.ListField(
        child=serializers.CharField(),
        required=False,
        allow_empty=True,
    )


class LicenseActivationCodeExtendSerializer(serializers.Serializer):
    days = serializers.IntegerField(min_value=1)

