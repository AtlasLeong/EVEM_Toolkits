from django.db import models


# Create your models here.

class FraudList(models.Model):
    id = models.BigAutoField(primary_key=True)
    fraud_account = models.CharField(max_length=255, blank=True, null=True)
    account_type = models.CharField(max_length=255, blank=True, null=True)
    remark = models.CharField(max_length=255, blank=True, null=True)
    fraud_type = models.CharField(max_length=255, blank=True, null=True)
    source_group_id = models.IntegerField(blank=True, null=True)
    source_group_name = models.CharField(max_length=255, blank=True, null=True)
    icon = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'fraud_list'


class FraudAuthGroup(models.Model):
    group_id = models.IntegerField(primary_key=True)
    group_name = models.CharField(max_length=255, blank=True, null=True)
    icon = models.CharField(max_length=255, blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'fraud_auth_group'


class FraudAuthUserGroup(models.Model):
    user_id = models.IntegerField(primary_key=True)
    group_id = models.IntegerField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'fraud_auth_user_group'


class FraudBehaviorFlow(models.Model):
    operation_id = models.CharField(max_length=255, blank=True, null=True)
    operation_user_id = models.IntegerField(blank=True, null=True)
    action_type = models.CharField(max_length=30, blank=True, null=True)
    change = models.CharField(max_length=255, blank=True, null=True)
    fraud_id = models.BigIntegerField(blank=True, null=True)
    fraud_account = models.CharField(max_length=255, blank=True, null=True)
    account_type = models.CharField(max_length=255, blank=True, null=True)
    remark = models.CharField(max_length=255, blank=True, null=True)
    fraud_type = models.CharField(max_length=255, blank=True, null=True)
    source_group_id = models.IntegerField(blank=True, null=True)
    source_group_name = models.CharField(max_length=255, blank=True, null=True)
    icon = models.CharField(max_length=255, blank=True, null=True)
    change_time = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'fraud_behavior_flow'


class FraudListReportFlow(models.Model):
    create_user_id = models.CharField(max_length=255, blank=True, null=True)
    report_status = models.CharField(max_length=255, blank=True, null=True)
    fraud_account = models.CharField(max_length=255, blank=True, null=True)
    account_type = models.CharField(max_length=255, blank=True, null=True)
    description = models.CharField(max_length=255, blank=True, null=True)
    contact_number = models.CharField(max_length=255, blank=True, null=True)
    evidence_dict = models.CharField(max_length=1000, blank=True, null=True)
    approver_id = models.CharField(max_length=255, blank=True, null=True)
    approver_group = models.CharField(max_length=255, blank=True, null=True)
    approve_remark = models.CharField(max_length=255, blank=True, null=True)
    approve_time = models.DateTimeField(blank=True, null=True)
    create_time = models.DateTimeField(blank=True, null=True)

    class Meta:
        managed = False
        db_table = 'fraud_list_report_flow'


class FraudEvidenceFlow(models.Model):
    user_id = models.IntegerField(blank=True, null=True)
    image_url = models.CharField(max_length=255, blank=True, null=True)
    upload_time = models.DateTimeField(blank=True, null=True)
    is_exists = models.IntegerField(blank=True, null=True)
    file_hash = models.CharField(max_length=32, blank=True, null=True, db_index=True)

    class Meta:
        managed = False
        db_table = 'fraud_evidence_flow'
