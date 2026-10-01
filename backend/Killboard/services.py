"""Transactional persistence services for parsed kill reports.

The collector deliberately hands this module plain, parser-validated values.  It
does not know about accounts, sessions, or transport details.
"""

from __future__ import annotations

from datetime import datetime, timezone as dt_timezone
from decimal import Decimal, InvalidOperation
import hashlib
import json

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from GameData.registry import npc_identity

from .models import CollectionPolicy, KillItem, KillParticipant, KillReport, ShipClass


_COMPLETENESS_RANK = {
    KillReport.Completeness.PARTIAL: 0,
    KillReport.Completeness.NEEDS_REVIEW: 1,
    KillReport.Completeness.COMPLETE: 2,
}


def _completeness(value: str | None, parsed: dict) -> str:
    if value in _COMPLETENESS_RANK:
        return value
    required = (parsed.get("ship_name"), parsed.get("kill_time_raw"), parsed.get("victim_name"))
    if all(required) and parsed.get("participants") is not None:
        return KillReport.Completeness.COMPLETE
    return KillReport.Completeness.PARTIAL


def _policy_allows(parsed: dict, policy: CollectionPolicy | None) -> bool:
    if policy is None:
        return True
    if not policy.enabled:
        return False
    threshold = policy.min_isk_lost
    if threshold is not None:
        observed = parsed.get("isk_lost")
        if observed is None or isinstance(observed, bool):
            return False
        try:
            observed = Decimal(str(observed))
        except (InvalidOperation, TypeError, ValueError):
            return False
        if not observed.is_finite() or observed <= threshold:
            return False
    class_key = str(parsed.get("ship_class_key") or "")
    allowed = set(policy.allowed_class_keys or [])
    if allowed:
        return class_key in allowed
    if policy.min_ship_rank <= 0:
        return True
    ship_class = ShipClass.objects.filter(key=class_key, enabled=True).first()
    return ship_class is not None and ship_class.rank >= policy.min_ship_rank


def _parse_time(raw: str | None):
    if not raw:
        return None
    try:
        value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if timezone.is_naive(value):
        return value.replace(tzinfo=dt_timezone.utc) if settings.USE_TZ else value
    return value if settings.USE_TZ else timezone.make_naive(value, dt_timezone.utc)


def _hash_payload(parsed: dict) -> str:
    encoded = json.dumps(parsed, sort_keys=True, default=str, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


_NPC_PLAYER_EVIDENCE_FIELDS = (
    "character_id", "character_name", "corporation_id", "corporation_name",
    "alliance_id", "alliance_name", "camouflaged_faction_id",
)


def _has_identity_evidence(participant: dict, field: str) -> bool:
    """Return whether a participant field carries positive player evidence."""
    value = participant.get(field)
    if value is None or value is False:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return value != ""


def _is_proven_npc_only(participants) -> bool:
    """Identify reports whose every participant is an exact client NPC unit.

    KM participant data is intentionally treated as uncertain unless every row
    has a resolvable NPC weapon/unit type and no player or camouflage evidence.
    ``is_source_summary`` is provenance only: the parser sets it on an
    anonymous final-blow summary, so it cannot independently prove a player.
    This predicate is conservative: malformed, unknown, missing-weapon, mixed,
    or empty participant sections are all retained for later review.
    """
    if not isinstance(participants, list) or not participants:
        return False
    for participant in participants:
        if not isinstance(participant, dict):
            return False
        if any(_has_identity_evidence(participant, field) for field in _NPC_PLAYER_EVIDENCE_FIELDS):
            return False
        weapon_type_id = participant.get("weapon_type_id")
        if weapon_type_id is None or weapon_type_id == "":
            return False
        if not npc_identity(weapon_type_id):
            return False
    return True


def disposition_for(parsed, policy, report, created):
    """Stable audit classification, with the same conservative filtering rules."""
    if report is not None:
        return getattr(report, '_collection_disposition', 'created' if created else 'updated')
    if _is_proven_npc_only(parsed.get('participants')):
        return 'filtered_npc'
    if policy is not None and policy.min_isk_lost is not None:
        value = parsed.get('isk_lost')
        try:
            observed = Decimal(str(value)) if value is not None and not isinstance(value, bool) else None
        except (InvalidOperation, TypeError, ValueError):
            observed = None
        if observed is None or not observed.is_finite() or observed <= policy.min_isk_lost:
            return 'filtered_value'
    return 'filtered_policy'


def _set_if_present(report: KillReport, parsed: dict, field: str, *, preserve_blank=True):
    if field not in parsed:
        return
    value = parsed[field]
    if preserve_blank and value in (None, ""):
        return
    setattr(report, field, value)


def _save_children(report: KillReport, parsed: dict):
    participants = parsed.get("participants")
    participant_status = parsed.get("participants_status")
    participants_provided = (
        participant_status == "provided"
        or bool(participants)
        or (participants == [] and parsed.get("participant_count") == 0)
    )
    if "participants" in parsed and participants is not None and participants_provided:
        previous = {
            (row.character_id, row.source_index, row.is_source_summary): row
            for row in report.participants.all()
            if row.character_id is not None and row.character_id > 0
        }
        report.participants.all().delete()
        for participant in participants or []:
            participant = dict(participant)
            old = previous.get((participant.get('character_id'), participant.get('source_index'),
                                participant.get('is_source_summary', False)))
            if old is not None:
                if not participant.get('character_name'):
                    participant['character_name'] = old.character_name
                same_corp = participant.get('corporation_id') in (None, old.corporation_id)
                if same_corp:
                    for field in ('corporation_id', 'corporation_name'):
                        if participant.get(field) in (None, ''):
                            participant[field] = getattr(old, field)
                    if participant.get('alliance_id') in (None, old.alliance_id):
                        for field in ('alliance_id', 'alliance_name'):
                            if participant.get(field) in (None, ''):
                                participant[field] = getattr(old, field)
            KillParticipant.objects.create(report=report, **{
                key: participant.get(key)
                for key in (
                    "character_id", "character_name", "corporation_id", "corporation_name",
                    "alliance_id", "alliance_name", "damage", "damage_pct", "is_final_blow",
                    "is_top_damage", "ship_type_id", "weapon_type_id", "source_index",
                    "camouflaged_faction_id", "feat_score", "is_source_summary",
                )
                if key in participant
            })

    # An omitted/unknown equipment section is not evidence that the old
    # children disappeared.  Only an explicitly provided section may replace
    # existing rows, including an explicitly provided empty list.
    equipment_status = parsed.get("equipment_status")
    if "items" not in parsed or equipment_status in {"missing", "unavailable", "unknown"}:
        return
    report.items.all().delete()
    for item in parsed.get("items") or []:
        KillItem.objects.create(report=report, **{
            key: item.get(key)
            for key in (
                "type_id", "name", "slot", "quantity_dropped", "quantity_destroyed",
                "quantity_unknown", "status",
            )
            if key in item
        })


@transaction.atomic
def persist_report(
    parsed: dict,
    *,
    policy: CollectionPolicy | None = None,
    source: str = "unknown",
    parser_version: str = "1",
) -> tuple[KillReport | None, bool]:
    """Insert or safely merge one parser result.

    Returns ``(None, False)`` when the active collection policy excludes the
    ship.  A lower completeness result never overwrites an existing record.
    """

    if _is_proven_npc_only(parsed.get("participants")):
        return None, False
    if not _policy_allows(parsed, policy):
        return None, False
    kill_id = int(parsed["kill_id"])
    incoming_completeness = _completeness(parsed.get("completeness"), parsed)
    incoming_rank = _COMPLETENESS_RANK[incoming_completeness]
    try:
        report = KillReport.objects.select_for_update().get(kill_id=kill_id)
        created = False
    except KillReport.DoesNotExist:
        report = KillReport(kill_id=kill_id)
        created = True

    existing_rank = _COMPLETENESS_RANK.get(report.completeness, 0)
    if not created and incoming_rank < existing_rank:
        report._collection_disposition = 'parsed'
        return report, False

    fields = (
        "ship_type_id", "ship_name", "ship_class_key", "system_id", "system_name",
        "victim_character_id", "victim_name", "victim_corporation_id", "victim_corporation_name",
        "victim_alliance_id", "victim_alliance_name", "kill_time_raw", "time_quality", "isk_lost",
        "participant_count",
        "victim_damage_taken", "damage_total_verified", "final_summary",
    )
    for field in fields:
        _set_if_present(report, parsed, field)
    if parsed.get("participant_count") is not None:
        report.participant_count_source = parsed.get("participant_count_source", "source")
    report.kill_time_display = _parse_time(parsed.get("kill_time_raw")) or report.kill_time_display
    report.source = source
    report.parser_version = parser_version
    report.completeness = incoming_completeness
    report._collection_disposition = 'created' if created else 'updated'
    if "participants_status" in parsed:
        incoming_status = parsed["participants_status"]
        if created or incoming_status not in {"missing", "unavailable", "unknown"} or report.participants_status not in {"provided", "summary"}:
            report.participants_status = incoming_status
    elif parsed.get("participants"):
        report.participants_status = "provided"
    if "equipment_status" in parsed:
        incoming_status = parsed["equipment_status"]
        if created or incoming_status not in {"missing", "unavailable", "unknown"} or report.equipment_status != "provided":
            report.equipment_status = incoming_status
    report.raw_hash = _hash_payload(parsed)
    report.collected_at_ms = int(parsed.get("collected_at_ms") or report.collected_at_ms or 0)
    report.updated_at_ms = int(timezone.now().timestamp() * 1000)
    report.save()
    _save_children(report, parsed)
    return report, created


# Explicit alias used by callers that prefer the domain term.
upsert_kill_report = persist_report


class KillReportService:
    """Small dependency-free facade for management commands and tests."""

    persist = staticmethod(persist_report)
    upsert = staticmethod(persist_report)
