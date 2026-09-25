import time

from django.conf import settings
from django.core.exceptions import ValidationError
from django.db import models
from django.db.models import F, Q


def epoch_ms():
    return int(time.time() * 1000)


class MarketItem(models.Model):
    id = models.BigIntegerField(primary_key=True)
    name = models.CharField(max_length=255)
    category = models.CharField(max_length=120, blank=True, default='')
    category_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    subcategory_id = models.BigIntegerField(null=True, blank=True)
    market_bucket = models.CharField(max_length=16, default='other', db_index=True)
    scope = models.CharField(max_length=80, default='global')
    enabled = models.BooleanField(default=True)
    last_attempt_at_ms = models.BigIntegerField(null=True, blank=True)
    last_failure_at_ms = models.BigIntegerField(null=True, blank=True)
    last_error_code = models.CharField(max_length=64, blank=True, default='')

    class Meta:
        ordering = ['name', 'id']


class MarketConfig(models.Model):
    id = models.PositiveSmallIntegerField(primary_key=True, default=1, editable=False)
    min_interval_seconds = models.PositiveIntegerField(default=2100)
    max_interval_seconds = models.PositiveIntegerField(default=3060)
    enabled = models.BooleanField(default=True)
    next_due_at_ms = models.BigIntegerField(null=True, blank=True)
    session_status = models.CharField(
        max_length=16,
        choices=[
            ('unconfigured', 'Unconfigured'),
            ('ready', 'Ready'),
            ('needs_auth', 'Needs authentication'),
            ('error', 'Error'),
        ],
        default='unconfigured',
    )
    updated_at_ms = models.BigIntegerField(default=epoch_ms)

    class Meta:
        constraints = [
            models.CheckConstraint(check=Q(id=1), name='market_config_singleton_id'),
            models.CheckConstraint(
                check=Q(min_interval_seconds__gte=2100) & Q(max_interval_seconds__lte=3060)
                & Q(min_interval_seconds__lte=F('max_interval_seconds')),
                name='market_config_interval_bounds',
            ),
        ]

    def clean(self):
        super().clean()
        if self.pk != 1:
            raise ValidationError({'id': 'Market configuration must be the singleton row.'})
        if not 2100 <= self.min_interval_seconds <= self.max_interval_seconds <= 3060:
            raise ValidationError({
                'min_interval_seconds': 'Intervals must satisfy 2100 <= min <= max <= 3060.'
            })

    def save(self, *args, **kwargs):
        self.full_clean()
        return super().save(*args, **kwargs)


class MarketConfigAudit(models.Model):
    config = models.ForeignKey(MarketConfig, on_delete=models.PROTECT, related_name='audits')
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    before = models.JSONField()
    after = models.JSONField()
    changed_at_ms = models.BigIntegerField(default=epoch_ms)

    class Meta:
        ordering = ['-changed_at_ms', '-id']


class CollectionRun(models.Model):
    STATUS_CHOICES = [
        ('queued', 'Queued'),
        ('running', 'Running'),
        ('succeeded', 'Succeeded'),
        ('partial', 'Partial'),
        ('failed', 'Failed'),
        ('needs_auth', 'Needs authentication'),
    ]
    TRIGGER_CHOICES = [('scheduled', 'Scheduled'), ('manual', 'Manual')]

    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default='queued')
    trigger = models.CharField(max_length=16, choices=TRIGGER_CHOICES)
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name='market_runs'
    )
    created_at_ms = models.BigIntegerField(default=epoch_ms)
    started_at_ms = models.BigIntegerField(null=True, blank=True)
    finished_at_ms = models.BigIntegerField(null=True, blank=True)
    success_count = models.PositiveIntegerField(default=0)
    failure_count = models.PositiveIntegerField(default=0)
    error_code = models.CharField(max_length=64, blank=True, default='')
    lease_owner = models.CharField(max_length=128, blank=True, default='')
    lease_expires_at_ms = models.BigIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['-created_at_ms', '-id']
        indexes = [models.Index(fields=['status', 'created_at_ms'], name='market_run_status_created')]


class ImmutableSnapshotQuerySet(models.QuerySet):
    def update(self, **kwargs):
        raise ValidationError('Price snapshots are immutable.')

    def delete(self):
        raise ValidationError('Price snapshots are immutable.')


class PriceSnapshot(models.Model):
    objects = ImmutableSnapshotQuerySet.as_manager()
    item = models.ForeignKey(MarketItem, on_delete=models.PROTECT, related_name='snapshots')
    run = models.ForeignKey(CollectionRun, on_delete=models.PROTECT, related_name='snapshots')
    best_buy = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    best_sell = models.DecimalField(max_digits=20, decimal_places=2, null=True, blank=True)
    buy_order_count = models.PositiveIntegerField(default=0)
    sell_order_count = models.PositiveIntegerField(default=0)
    buy_prices = models.JSONField(default=list)
    sell_prices = models.JSONField(default=list)
    observed_at_ms = models.BigIntegerField()

    class Meta:
        ordering = ['-observed_at_ms', '-id']
        constraints = [
            models.UniqueConstraint(fields=['run', 'item'], name='market_snapshot_run_item_unique'),
            models.CheckConstraint(
                check=(Q(best_buy__isnull=True) | Q(best_buy__gt=0)),
                name='market_snapshot_buy_positive',
            ),
            models.CheckConstraint(
                check=(Q(best_sell__isnull=True) | Q(best_sell__gt=0)),
                name='market_snapshot_sell_positive',
            ),
        ]
        indexes = [models.Index(fields=['item', '-observed_at_ms'], name='market_snapshot_item_time')]

    def save(self, *args, **kwargs):
        if self.pk is not None and type(self).objects.filter(pk=self.pk).exists():
            raise ValidationError('Price snapshots are immutable.')
        return super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise ValidationError('Price snapshots are immutable.')


class LatestPrice(models.Model):
    item = models.OneToOneField(MarketItem, on_delete=models.CASCADE, primary_key=True, related_name='latest_price')
    snapshot = models.OneToOneField(PriceSnapshot, on_delete=models.PROTECT, related_name='latest_record')
    updated_at_ms = models.BigIntegerField(default=epoch_ms)

    def save(self, *args, **kwargs):
        if self.snapshot_id is not None and self.item_id is not None and self.snapshot.item_id != self.item_id:
            raise ValidationError('Latest price must point to a snapshot of the same item.')
        return super().save(*args, **kwargs)
