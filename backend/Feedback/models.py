from django.conf import settings
from django.db import models


class FeedbackTicket(models.Model):
    TYPES = [('feature', '功能建议'), ('bug', '问题反馈')]
    MODULES = [('planetary', '行星资源'), ('starmap', '星图'), ('fraudlist', '避坑名单'),
               ('account', '账户'), ('other', '其他')]
    STATUSES = [('pending', '待处理'), ('processing', '处理中'), ('completed', '已完成'),
                ('declined', '暂不采纳')]

    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feedback_tickets')
    request_id = models.UUIDField()
    type = models.CharField(max_length=16, choices=TYPES)
    module = models.CharField(max_length=16, choices=MODULES)
    title = models.CharField(max_length=120)
    description = models.TextField(max_length=5000)
    contact = models.CharField(max_length=200, blank=True, default='')
    status = models.CharField(max_length=16, choices=STATUSES, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-updated_at', '-id']
        constraints = [models.UniqueConstraint(fields=['author', 'request_id'], name='feedback_ticket_request_unique')]
        indexes = [models.Index(fields=['author', 'created_at'], name='feedback_ticket_rate_idx')]


class FeedbackComment(models.Model):
    ticket = models.ForeignKey(FeedbackTicket, on_delete=models.CASCADE, related_name='comments')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feedback_comments')
    request_id = models.UUIDField()
    body = models.TextField(max_length=3000)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [models.UniqueConstraint(fields=['author', 'request_id'], name='feedback_comment_request_unique')]
        indexes = [models.Index(fields=['author', 'created_at'], name='feedback_comment_rate_idx')]


class FeedbackAttachment(models.Model):
    ticket = models.ForeignKey(FeedbackTicket, on_delete=models.CASCADE, related_name='attachments')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feedback_attachments')
    request_id = models.UUIDField()
    name = models.CharField(max_length=200)
    storage_name = models.CharField(max_length=100, unique=True)
    size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=100)
    sha256 = models.CharField(max_length=64)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['created_at', 'id']
        constraints = [models.UniqueConstraint(fields=['author', 'request_id'], name='feedback_attach_request_unique')]
        indexes = [models.Index(fields=['author', 'created_at'], name='feedback_attach_rate_idx')]
