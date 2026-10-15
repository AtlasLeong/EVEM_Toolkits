"""Site feature access, independent of desktop activation-code licensing."""
import uuid
from django.conf import settings
from django.db import models

HOTSPOT_CHANGES_VIEW = 'hotspot_changes.view'


class FeatureGrant(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='feature_grants')
    capability = models.CharField(max_length=64, choices=[(HOTSPOT_CHANGES_VIEW, '犁地变化榜')])
    enabled = models.BooleanField(default=False)
    version = models.PositiveBigIntegerField(default=0)
    updated_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL,
                                   related_name='updated_feature_grants')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['user', 'capability'], name='control_grant_user_cap_unique'),
                       models.CheckConstraint(check=models.Q(capability=HOTSPOT_CHANGES_VIEW), name='control_grant_known_capability')]


class AppendOnlyQuerySet(models.QuerySet):
    def bulk_create(self, objs, batch_size=None, ignore_conflicts=False,
                    update_conflicts=False, update_fields=None, unique_fields=None):
        if update_conflicts:
            raise ValueError('Grant audit records are append-only.')
        return super().bulk_create(objs, batch_size=batch_size, ignore_conflicts=ignore_conflicts,
                                   update_conflicts=False, update_fields=update_fields,
                                   unique_fields=unique_fields)

    def update(self, **kwargs):
        raise ValueError('Grant audit records are append-only.')

    def delete(self):
        raise ValueError('Grant audit records are append-only.')


class GrantAudit(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='grant_actions')
    target = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='grant_audits')
    before_enabled = models.BooleanField()
    after_enabled = models.BooleanField()
    before_version = models.PositiveBigIntegerField()
    after_version = models.PositiveBigIntegerField()
    reason = models.CharField(max_length=500, blank=True)
    request_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)
    objects = AppendOnlyQuerySet.as_manager()

    class Meta:
        ordering = ['-pk']

    def save(self, force_insert=False, force_update=False, using=None, update_fields=None):
        if not self._state.adding or force_update or update_fields is not None:
            raise ValueError('Grant audit records are append-only.')
        # A newly constructed object carrying an old PK must never silently
        # UPDATE an audit row through Django's normal save fallback.
        return super().save(force_insert=True, using=using)

    def delete(self, *args, **kwargs):
        raise ValueError('Grant audit records are append-only.')
