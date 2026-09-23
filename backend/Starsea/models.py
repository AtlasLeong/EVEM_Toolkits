from django.conf import settings
from django.db import models


class Post(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='starsea_posts')
    request_id = models.UUIDField()
    payload_hash = models.CharField(max_length=64)
    working_revision = models.ForeignKey('Revision', null=True, on_delete=models.PROTECT, related_name='+')
    published_revision = models.ForeignKey('Revision', null=True, on_delete=models.PROTECT, related_name='+')
    is_listed = models.BooleanField(default=True)
    published_at = models.DateTimeField(null=True)
    moderation_reason = models.CharField(max_length=1000, blank=True)
    moderator = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name='+')
    moderated_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['author', 'request_id'], name='starsea_post_request_unique')]
        indexes = [models.Index(fields=['author', 'created_at'], name='starsea_post_author_time')]


class Revision(models.Model):
    post = models.ForeignKey(Post, on_delete=models.PROTECT, related_name='revisions')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, default='draft', db_index=True)
    content = models.JSONField(default=dict)
    summary = models.JSONField(default=dict)
    kind = models.CharField(max_length=16, default='story', db_index=True)
    title = models.CharField(max_length=120, blank=True)
    region_id = models.PositiveBigIntegerField(null=True, db_index=True)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.PROTECT, related_name='+')
    review_reason = models.CharField(max_length=1000, blank=True)
    reviewed_at = models.DateTimeField(null=True)
    submitted_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class Asset(models.Model):
    post = models.ForeignKey(Post, on_delete=models.PROTECT, related_name='assets')
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    request_id = models.UUIDField()
    original_sha256 = models.CharField(max_length=64)
    storage_name = models.CharField(max_length=100, unique=True)
    sha256 = models.CharField(max_length=64)
    size = models.PositiveIntegerField()
    content_type = models.CharField(max_length=30)
    width = models.PositiveIntegerField()
    height = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['uploader', 'request_id'], name='starsea_asset_request_unique')]
        indexes = [models.Index(fields=['uploader', 'created_at'], name='starsea_asset_actor_time')]


class UploadAttempt(models.Model):
    post = models.ForeignKey(Post, on_delete=models.PROTECT)
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    request_id = models.UUIDField()
    original_sha256 = models.CharField(max_length=64)
    status = models.CharField(max_length=12, default='processing')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['uploader', 'request_id'], name='starsea_attempt_request_unique')]
        indexes = [models.Index(fields=['uploader', 'created_at'], name='starsea_attempt_actor_time')]


class ModerationEvent(models.Model):
    post = models.ForeignKey(Post, on_delete=models.PROTECT)
    revision = models.ForeignKey(Revision, null=True, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    action = models.CharField(max_length=16)
    reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
