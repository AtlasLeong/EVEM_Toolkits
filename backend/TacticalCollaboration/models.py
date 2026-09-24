"""Durable organization state. All writes are serialized by the organization row."""
from django.conf import settings
from django.db import models


class Organization(models.Model):
    name = models.CharField(max_length=80)
    founder = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    region_ids = models.JSONField(default=list)
    border_hops = models.PositiveSmallIntegerField(default=0)
    scope_version = models.PositiveIntegerField(default=1)
    state_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)


class Board(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT, related_name='boards')
    name = models.CharField(max_length=80)
    kind = models.CharField(max_length=8, choices=[('war', 'War'), ('pirate', 'Pirate')])
    # Only the original/default war board is addressable by legacy org URLs.
    is_default = models.BooleanField(default=False)
    region_ids = models.JSONField(default=list)
    border_hops = models.PositiveSmallIntegerField(default=0)
    scope_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organization', 'name'], name='tactical_board_org_name_unique')]


class Membership(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    role = models.CharField(max_length=12, default='scout')
    status = models.CharField(max_length=12, default='active')
    permission_version = models.PositiveIntegerField(default=1)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['organization', 'user'], name='tactical_membership_unique')]


class Invite(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    creator = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+')
    code_hash = models.CharField(max_length=64, unique=True)
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)


class JoinApplication(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    status = models.CharField(max_length=12, default='pending')
    reviewer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name='+', null=True)
    reviewed_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [models.Index(fields=['organization', 'status'], name='tactical_application_state')]


class CommandReceipt(models.Model):
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    scope = models.CharField(max_length=40)
    request_id = models.UUIDField()
    payload_hash = models.CharField(max_length=64)
    result = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['actor', 'scope', 'request_id'], name='tactical_receipt_unique')]
        indexes = [models.Index(fields=['actor', 'created_at'], name='tactical_receipt_actor_time')]


class AuditLog(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    actor = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    action = models.CharField(max_length=40)
    request_id = models.UUIDField()
    # Internal metadata is never used as the scout-facing projection.
    metadata = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True)


class Report(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    board = models.ForeignKey(Board, on_delete=models.PROTECT, null=True)
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    # A system total is an observation of a place, not a movable fleet.
    report_kind = models.CharField(max_length=16, default='fleet', choices=[('fleet', 'Fleet'), ('system_count', 'System enemy count'), ('fleet_intel', 'Named fleet observation')])
    fleet_name = models.CharField(max_length=80, blank=True, default='')
    linked_force = models.ForeignKey('Force', on_delete=models.PROTECT, related_name='observations', null=True)
    version = models.PositiveIntegerField(default=1)
    system_id = models.PositiveIntegerField()
    system_name = models.CharField(max_length=255)
    people = models.PositiveIntegerField(null=True)
    ships = models.JSONField(default=dict)
    notes = models.CharField(max_length=1000, blank=True)
    observed_at = models.DateTimeField()
    status = models.CharField(max_length=12, default='pending')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['organization', 'updated_at'], name='tactical_report_org_time')]


class ReportRevision(models.Model):
    report = models.ForeignKey(Report, on_delete=models.PROTECT)
    version = models.PositiveIntegerField()
    content = models.JSONField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=['report', 'version'], name='tactical_report_revision_unique')]


class Force(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    board = models.ForeignKey(Board, on_delete=models.PROTECT, null=True)
    # Only this source may project later author revisions into the estimate.
    # Manual commander edits clear it; a position-only move preserves it.
    source_report = models.ForeignKey(Report, on_delete=models.PROTECT, related_name='+', null=True)
    version = models.PositiveIntegerField(default=1)
    name = models.CharField(max_length=80)
    side = models.CharField(max_length=8)
    archived = models.BooleanField(default=False)
    system_id = models.PositiveIntegerField()
    system_name = models.CharField(max_length=255)
    people = models.PositiveIntegerField(null=True)
    ships = models.JSONField(default=dict)
    notes = models.CharField(max_length=1000, blank=True)
    observed_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['organization', 'side'], name='tactical_force_org_side')]


class ForceSource(models.Model):
    force = models.ForeignKey(Force, on_delete=models.PROTECT)
    # A revision may be adopted only once, even with a different command ID.
    revision = models.OneToOneField(ReportRevision, on_delete=models.PROTECT)
    confirmer = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    force_version = models.PositiveIntegerField()
    created_at = models.DateTimeField(auto_now_add=True)


class ConnectionLease(models.Model):
    organization = models.ForeignKey(Organization, on_delete=models.PROTECT)
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    connection_id = models.UUIDField(unique=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
    socket_generation = models.UUIDField(null=True)
    socket_claim_window_at = models.DateTimeField(null=True)
    socket_claim_count = models.PositiveSmallIntegerField(default=0)

    class Meta:
        indexes = [models.Index(fields=['organization', 'expires_at', 'user'], name='tactical_lease_org_expiry')]


class PirateSighting(models.Model):
    board = models.ForeignKey(Board, on_delete=models.PROTECT, related_name='sightings')
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT)
    version = models.PositiveIntegerField(default=1)
    character_name = models.CharField(max_length=120)
    ship_type = models.CharField(max_length=120)
    normalized_name = models.CharField(max_length=2560)
    normalized_ship = models.CharField(max_length=2560)
    location_kind = models.CharField(max_length=16)
    location_id = models.PositiveIntegerField()
    location_name = models.CharField(max_length=255)
    observed_at = models.DateTimeField()
    activity_start_utc = models.CharField(max_length=5, null=True, blank=True)
    activity_end_utc = models.CharField(max_length=5, null=True, blank=True)
    notes = models.CharField(max_length=1000, blank=True)
    status = models.CharField(max_length=12, default='active')
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        indexes = [models.Index(fields=['board', 'author', 'status'], name='tactical_pirate_visible')]
