from django.conf import settings
from django.db import models


class Corporation(models.Model):
    name = models.CharField(max_length=80)
    short_name = models.CharField(max_length=20, blank=True)
    server = models.CharField(max_length=10, default='cn')
    name_key = models.CharField(max_length=64, unique=True)
    owner = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='owned_corporations')
    working_revision = models.ForeignKey('Revision', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    published_revision = models.ForeignKey('Revision', null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    is_listed = models.BooleanField(default=True)
    moderation_reason = models.CharField(max_length=1000, blank=True)
    moderated_at = models.DateTimeField(null=True, blank=True)
    moderator = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    created_at = models.DateTimeField(auto_now_add=True)


class Claim(models.Model):
    corporation = models.ForeignKey(Corporation, on_delete=models.PROTECT)
    applicant = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    # Each application owns its identity proposal. Null means a legacy claim
    # whose original proposal is unknown, not the first applicant's spelling.
    proposed_name = models.CharField(max_length=80, null=True, blank=True)
    proposed_short_name = models.CharField(max_length=20, null=True, blank=True)
    request_id = models.UUIDField()
    payload_hash = models.CharField(max_length=64)
    statement = models.CharField(max_length=1000)
    contact = models.CharField(max_length=200)
    status = models.CharField(max_length=12, default='pending', db_index=True)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_reason = models.CharField(max_length=1000, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['applicant', 'request_id'], name='community_claim_request_unique')]
        indexes = [models.Index(fields=['applicant', 'created_at'], name='community_claim_actor_time')]


class Revision(models.Model):
    corporation = models.ForeignKey(Corporation, on_delete=models.PROTECT)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=1)
    status = models.CharField(max_length=12, default='draft', db_index=True)
    content = models.JSONField(default=dict)
    # Portable, bounded enum filter: avoids MySQL/SQLite JSON containment differences.
    activity_keys = models.CharField(max_length=100, blank=True)
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.PROTECT, related_name='+')
    reviewed_at = models.DateTimeField(null=True, blank=True)
    review_reason = models.CharField(max_length=1000, blank=True)
    submitted_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)


class DraftRequest(models.Model):
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_id = models.UUIDField()
    corporation = models.ForeignKey(Corporation, on_delete=models.PROTECT)
    revision = models.ForeignKey(Revision, on_delete=models.PROTECT)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['author', 'request_id'], name='community_draft_request_unique')]


class MediaAsset(models.Model):
    corporation = models.ForeignKey(Corporation, on_delete=models.PROTECT)
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
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
        constraints = [models.UniqueConstraint(fields=['uploader', 'request_id'], name='community_media_request_unique')]
        indexes = [models.Index(fields=['uploader', 'created_at'], name='community_media_actor_time')]


class MediaUploadAttempt(models.Model):
    """Persistent pre-decode reservation; failed images also consume a quota slot."""
    corporation = models.ForeignKey(Corporation, on_delete=models.PROTECT)
    uploader = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    request_id = models.UUIDField()
    original_sha256 = models.CharField(max_length=64)
    status = models.CharField(max_length=12, default='processing')
    created_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['uploader', 'request_id'], name='community_upload_attempt_unique')]
        indexes = [models.Index(fields=['uploader', 'created_at'], name='community_attempt_actor_time')]
