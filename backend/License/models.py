from django.db import models


class ScriptProduct(models.Model):
    class Meta:
        db_table = 'license_script_product'
        ordering = ['sort_order', 'id']

    script_id = models.CharField(max_length=100, unique=True)
    display_name = models.CharField(max_length=255)
    description = models.TextField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.script_id} - {self.display_name}'


class Plan(models.Model):
    class Meta:
        db_table = 'license_plan'
        ordering = ['id']

    code = models.CharField(max_length=50, unique=True)
    name = models.CharField(max_length=100)
    grant_all_scripts = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)
    scripts = models.ManyToManyField(ScriptProduct, through='PlanScript', related_name='plans')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f'{self.code} - {self.name}'


class PlanScript(models.Model):
    class Meta:
        db_table = 'license_plan_scripts'
        unique_together = ('plan', 'script')
        ordering = ['sort_order', 'id']

    plan = models.ForeignKey(Plan, on_delete=models.CASCADE)
    script = models.ForeignKey(ScriptProduct, on_delete=models.CASCADE)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.plan.code}:{self.script.script_id}'


class LicenseActivationCode(models.Model):
    class Meta:
        db_table = 'license_activation_code'
        ordering = ['-created_at', 'id']

    code = models.CharField(max_length=255, unique=True)
    is_active = models.BooleanField(default=True)
    plan = models.ForeignKey(Plan, on_delete=models.PROTECT, related_name='activation_codes')
    expires_at = models.DateTimeField()
    pc_identifier = models.CharField(max_length=255, null=True, blank=True)
    last_used = models.DateTimeField(null=True, blank=True)
    remark = models.CharField(max_length=255, null=True, blank=True)
    extra_scripts = models.ManyToManyField(
        ScriptProduct,
        through='ActivationCodeExtraScript',
        related_name='extra_activation_codes',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return str(self.code)


class ActivationCodeExtraScript(models.Model):
    class Meta:
        db_table = 'license_activation_extra_scripts'
        unique_together = ('activation_code', 'script')
        ordering = ['sort_order', 'id']

    activation_code = models.ForeignKey(LicenseActivationCode, on_delete=models.CASCADE)
    script = models.ForeignKey(ScriptProduct, on_delete=models.CASCADE)
    sort_order = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f'{self.activation_code.code}:{self.script.script_id}'


class ValidationLog(models.Model):
    class Meta:
        db_table = 'license_validation_log'
        ordering = ['-created_at', 'id']

    code = models.CharField(max_length=255)
    pc_identifier = models.CharField(max_length=255, null=True, blank=True)
    source = models.CharField(max_length=20)
    is_valid = models.BooleanField(default=False)
    message = models.CharField(max_length=255, null=True, blank=True)
    ip_address = models.CharField(max_length=64, null=True, blank=True)
    user_agent = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

