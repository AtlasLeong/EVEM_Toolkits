from django.db import models

# Create your models here.
from django.db import models
import uuid


class ActivationCode(models.Model):
    class Meta:
        db_table = 'activation_code'  # 确保这里的大小写与数据库中的表名一致
    code = models.CharField(max_length=255, null=True, blank=True,unique=True)
    is_active = models.IntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    pc_identifier = models.CharField(max_length=255, null=True, blank=True)
    last_used = models.DateTimeField(null=True, blank=True)

    def __str__(self):
        return str(self.code)
