from .models import FraudList, FraudBehaviorFlow, FraudListReportFlow
from rest_framework import serializers
from Authentication.models import EVEMUser


class FraudListSerializer(serializers.ModelSerializer):
    class Meta:
        model = FraudList
        fields = ['fraud_account', 'account_type', 'remark', 'fraud_type', 'source_group_id', 'source_group_name',
                  'icon', 'id']


class FraudBehaviorFlowSerializer(serializers.ModelSerializer):
    username = serializers.SerializerMethodField()

    class Meta:
        model = FraudBehaviorFlow
        fields = '__all__'

    @staticmethod
    def get_username(obj):
        # 假设 EVEMUser 是关联的用户模型，并且通过 user_id 字段关联
        # 如果这里的关联不是直接的，你可能需要调整这个查询
        user = EVEMUser.objects.filter(id=obj.operation_user_id).first()
        return user.username if user else None


class FraudListReportFlowSerializer(serializers.ModelSerializer):
    class Meta:
        model = FraudListReportFlow
        fields = ['id', 'report_status', 'fraud_account', 'account_type', 'description', 'contact_number',
                  'evidence_dict', 'approver_id', "approver_group", "approve_time", "create_time", "approve_remark"]
