"""Domain models for the read-only killboard and bounded discovery worker."""

import time

from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import Q


def epoch_ms():
    return int(time.time() * 1000)


KILL_ITEM_STATUS_VALUES = ('dropped', 'destroyed', 'mixed', 'unknown')


class ShipClass(models.Model):
    key = models.CharField(max_length=64, unique=True)
    label = models.CharField(max_length=120)
    rank = models.PositiveSmallIntegerField(default=0, db_index=True, validators=[MinValueValidator(0)])
    enabled = models.BooleanField(default=True, db_index=True)

    class Meta:
        ordering = ['rank', 'key']
        indexes = [models.Index(fields=['enabled', 'rank'], name='kb_shipclass_enabled_rank')]

    def __str__(self):
        return self.label or self.key


class CollectionPolicy(models.Model):
    name = models.CharField(max_length=120, unique=True)
    enabled = models.BooleanField(default=True, db_index=True)
    min_ship_rank = models.PositiveSmallIntegerField(default=0, validators=[MinValueValidator(0)])
    allowed_class_keys = models.JSONField(default=list)

    class Meta:
        ordering = ['name']
        indexes = [models.Index(fields=['enabled', 'min_ship_rank'], name='kb_policy_enabled_rank')]

    def __str__(self):
        return self.name


class KillReport(models.Model):
    class TimeQuality(models.TextChoices):
        SOURCE = 'source', 'Source timestamp'
        CONVERTED = 'converted', 'Converted timestamp'
        UNKNOWN = 'unknown', 'Unknown timestamp'

    class Completeness(models.TextChoices):
        PARTIAL = 'partial', 'Partial'
        COMPLETE = 'complete', 'Complete'
        NEEDS_REVIEW = 'needs_review', 'Needs review'

    kill_id = models.BigIntegerField(unique=True)
    ship_type_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    ship_name = models.CharField(max_length=255, blank=True, default='')
    ship_class_key = models.CharField(max_length=64, blank=True, default='', db_index=True)
    ship_class_label = models.CharField(max_length=120, blank=True, default='')
    system_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    system_name = models.CharField(max_length=255, blank=True, default='')
    victim_character_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    victim_name = models.CharField(max_length=255, blank=True, default='')
    victim_corporation_id = models.BigIntegerField(null=True, blank=True)
    victim_corporation_name = models.CharField(max_length=255, blank=True, default='')
    victim_alliance_id = models.BigIntegerField(null=True, blank=True)
    victim_alliance_name = models.CharField(max_length=255, blank=True, default='')
    kill_time_raw = models.CharField(max_length=64, blank=True, default='')
    kill_time_display = models.DateTimeField(null=True, blank=True, db_index=True)
    time_quality = models.CharField(max_length=16, choices=TimeQuality.choices, default=TimeQuality.UNKNOWN)
    isk_lost = models.DecimalField(max_digits=24, decimal_places=2, null=True, blank=True)
    participant_count = models.PositiveIntegerField(null=True, blank=True)
    participant_count_source = models.CharField(max_length=32, default='unknown')
    source = models.CharField(max_length=64, default='unknown', db_index=True)
    parser_version = models.CharField(max_length=32, default='1')
    completeness = models.CharField(max_length=16, choices=Completeness.choices, default=Completeness.PARTIAL, db_index=True)
    raw_hash = models.CharField(max_length=128, blank=True, default='')
    collected_at_ms = models.BigIntegerField(default=epoch_ms, db_index=True)
    updated_at_ms = models.BigIntegerField(default=epoch_ms)

    class Meta:
        ordering = ['-kill_time_display', '-kill_id']
        indexes = [
            models.Index(fields=['ship_class_key', '-kill_time_display'], name='kb_report_ship_time'),
            models.Index(fields=['system_id', '-kill_time_display'], name='kb_report_system_time'),
            models.Index(fields=['victim_character_id', '-kill_time_display'], name='kb_report_char_time'),
            models.Index(fields=['completeness', '-updated_at_ms'], name='kb_report_complete_updated'),
        ]

    def __str__(self):
        return f'{self.kill_id}: {self.ship_name or "Unknown ship"}'


class KillParticipant(models.Model):
    report = models.ForeignKey(KillReport, on_delete=models.CASCADE, related_name='participants')
    character_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    character_name = models.CharField(max_length=255, blank=True, default='')
    corporation_id = models.BigIntegerField(null=True, blank=True)
    corporation_name = models.CharField(max_length=255, blank=True, default='')
    alliance_id = models.BigIntegerField(null=True, blank=True)
    alliance_name = models.CharField(max_length=255, blank=True, default='')
    damage = models.PositiveBigIntegerField(null=True, blank=True)
    damage_pct = models.DecimalField(max_digits=7, decimal_places=3, null=True, blank=True)
    is_final_blow = models.BooleanField(default=False)
    is_top_damage = models.BooleanField(default=False)
    source_index = models.PositiveIntegerField(null=True, blank=True)

    class Meta:
        ordering = ['source_index', 'id']
        indexes = [
            models.Index(fields=['report', 'is_final_blow'], name='kb_participant_final'),
            models.Index(fields=['report', 'is_top_damage'], name='kb_participant_top'),
            models.Index(fields=['character_id', 'report'], name='kb_participant_char_report'),
        ]

    def __str__(self):
        return self.character_name or str(self.character_id or 'Unknown participant')


class KillItem(models.Model):
    class Status(models.TextChoices):
        DROPPED = 'dropped', 'Dropped'
        DESTROYED = 'destroyed', 'Destroyed'
        MIXED = 'mixed', 'Mixed'
        UNKNOWN = 'unknown', 'Unknown'

    report = models.ForeignKey(KillReport, on_delete=models.CASCADE, related_name='items')
    type_id = models.BigIntegerField(null=True, blank=True, db_index=True)
    name = models.CharField(max_length=255, blank=True, default='')
    slot = models.CharField(max_length=64, blank=True, default='')
    quantity_dropped = models.PositiveBigIntegerField(default=0)
    quantity_destroyed = models.PositiveBigIntegerField(default=0)
    quantity_unknown = models.PositiveBigIntegerField(default=0)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.UNKNOWN, db_index=True)

    class Meta:
        ordering = ['slot', 'name', 'id']
        constraints = [
            models.CheckConstraint(
                check=Q(status__in=KILL_ITEM_STATUS_VALUES),
                name='kb_item_status_valid',
            ),
        ]
        indexes = [
            models.Index(fields=['report', 'status'], name='kb_item_report_status'),
            models.Index(fields=['type_id', 'status'], name='kb_item_type_status'),
        ]

    def __str__(self):
        return self.name or str(self.type_id or 'Unknown item')


class ProbeCursor(models.Model):
    name = models.CharField(max_length=80, unique=True, default='default')
    last_success_id = models.BigIntegerField(null=True, blank=True)
    last_success_kill_time = models.DateTimeField(null=True, blank=True)
    consecutive_empty_count = models.PositiveIntegerField(default=0)
    next_probe_id = models.BigIntegerField(null=True, blank=True)
    updated_at_ms = models.BigIntegerField(default=epoch_ms)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ProbeRun(models.Model):
    class Status(models.TextChoices):
        QUEUED = 'queued', 'Queued'
        RUNNING = 'running', 'Running'
        SUCCEEDED = 'succeeded', 'Succeeded'
        STOPPED = 'stopped', 'Stopped'
        FAILED = 'failed', 'Failed'

    cursor = models.ForeignKey(ProbeCursor, on_delete=models.PROTECT, related_name='runs')
    policy = models.ForeignKey(CollectionPolicy, null=True, blank=True, on_delete=models.SET_NULL, related_name='runs')
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.QUEUED, db_index=True)
    started_at_ms = models.BigIntegerField(null=True, blank=True)
    finished_at_ms = models.BigIntegerField(null=True, blank=True)
    request_count = models.PositiveIntegerField(default=0)
    report_count = models.PositiveIntegerField(default=0)
    empty_count = models.PositiveIntegerField(default=0)
    stop_reason = models.CharField(max_length=64, blank=True, default='')
    error_code = models.CharField(max_length=64, blank=True, default='')
    created_at_ms = models.BigIntegerField(default=epoch_ms, db_index=True)

    class Meta:
        ordering = ['-created_at_ms', '-id']
        indexes = [models.Index(fields=['status', '-created_at_ms'], name='kb_probe_status_created')]

    def __str__(self):
        return f'Probe {self.pk or "new"} ({self.status})'
