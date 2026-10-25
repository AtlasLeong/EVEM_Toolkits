from .models import FraudList, FraudBehaviorFlow, FraudListReportFlow
from rest_framework import serializers


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

    def get_username(self, obj):
        return self.context.get('actor_names', {}).get(obj.operation_user_id)


class FraudListReportFlowSerializer(serializers.ModelSerializer):
    class Meta:
        model = FraudListReportFlow
        fields = ['id', 'report_status', 'fraud_account', 'account_type', 'description', 'contact_number',
                  'evidence_dict', 'approver_id', "approver_group", "approve_time", "create_time", "approve_remark"]
