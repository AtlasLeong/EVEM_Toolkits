from django.db import models
from django.contrib.auth.models import AbstractUser, Group, Permission
import time


# Create your models here.


# 继承django用户模型，并加入自定义字段
class EVEMUser(AbstractUser):
    class Meta:
        db_table = 'authentication_evemuser'  # 确保这里的大小写与数据库中的表名一致

    # 覆盖username字段
    username = models.CharField(
        max_length=150,
        unique=True,
        db_collation='utf8mb4_bin',
        help_text='Required. 150 characters or fewer. Letters, digits and @/./+/-/_ only.',
        validators=[AbstractUser.username_validator],
        error_messages={
            'unique': "A user with that username already exists.",
        },
    )
    # 添加你想要的额外字段
    # 添加unique=True来确保邮箱唯一
    email = models.EmailField(unique=True)

    eve_id = models.CharField(max_length=15, blank=True, null=True)
    user_corp = models.CharField(max_length=15, blank=True)
    user_union = models.CharField(max_length=15, blank=True)

    groups = models.ManyToManyField(Group, related_name='evemuser_set')
    user_permissions = models.ManyToManyField(Permission, related_name='evemuser_set')


class EmailVerificationCode(models.Model):
    class Meta:
        db_table = 'email_code'  # 确保这里的大小写与数据库中的表名一致
    email = models.EmailField(unique=True)
    code = models.CharField(max_length=6)
    created_at = models.BigIntegerField(default=time.time)  # 使用默认方法生成当前时间戳

    def __str__(self):
        return self.email
