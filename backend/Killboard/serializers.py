from datetime import datetime, timezone

from GameData.registry import camouflaged_identity, item_name, location_record, npc_identity

from .catalog import ship_name
from .image_catalog import image_metadata, image_url
from .models import KillItem, KillParticipant, KillReport


def _iso(value):
    return value.isoformat() if value is not None else None


def _report_time(report):
    point = report.kill_time_display
    # The verified game protocol returns UTC without an offset. Django's
    # legacy naive storage must not make browsers interpret that as local time.
    source = str(report.source or '')
    if point is not None and point.tzinfo is None and (source == 'kill_api' or source.startswith('kill_api_')):
        point = point.replace(tzinfo=timezone.utc)
    return _iso(point)


def _string(value):
    return str(value) if value is not None else None


def report_payload(report, security=None):
    static_location = location_record(report.system_id) if report.system_id and not security else None
    location = {**(static_location or {}), **(security or {})}
    return {
        'kill_id': str(report.kill_id),
        'ship_type_id': _string(report.ship_type_id),
        'ship_image_url': image_url(report.ship_type_id),
        'ship_name': report.ship_name or item_name(report.ship_type_id) or ship_name(report.ship_type_id),
        'ship_class_key': report.ship_class_key or '',
        'ship_class_label': report.ship_class_label or '',
        'system_id': _string(report.system_id),
        'system_name': report.system_name or location.get('system_name', ''),
        'security_status': location.get('security_status'),
        'security_label': location.get('security_label', '安等未知'),
        'security_band': location.get('security_band', 'unknown'),
        'security_color': location.get('security_color', '#9fb4b9'),
        'constellation_name': location.get('constellation_name', ''),
        'region_name': location.get('region_name', ''),
        'victim_character_id': _string(report.victim_character_id),
        'victim_name': report.victim_name or '',
        'victim_corporation_id': _string(report.victim_corporation_id),
        'victim_corporation_name': report.victim_corporation_name or '',
        'victim_corporation_ticker': getattr(report, 'victim_corporation_ticker', '') or '',
        'victim_alliance_id': _string(report.victim_alliance_id),
        'victim_alliance_name': report.victim_alliance_name or '',
        'kill_time_raw': report.kill_time_raw or '',
        'kill_time_display': _report_time(report),
        'time_quality': report.time_quality,
        'isk_lost': _string(report.isk_lost),
        'participant_count': report.participant_count,
        'participant_count_source': report.participant_count_source,
        'participants_status': report.participants_status,
        'victim_damage_taken': report.victim_damage_taken,
        'damage_total_verified': report.damage_total_verified,
        'final_summary': report.final_summary,
        'equipment_status': report.equipment_status,
        'completeness': report.completeness,
        'source': report.source,
    }


def participant_payload(row):
    camouflage = camouflaged_identity(getattr(row, 'camouflaged_faction_id', None),
                                      getattr(row, 'feat_score', None))
    npc = None if row.character_name or camouflage else npc_identity(getattr(row, 'weapon_type_id', None))
    display_name = row.character_name or (camouflage or {}).get('name', '') or (npc or {}).get('name', '')
    identity_kind = 'character' if row.character_name else ((camouflage or {}).get('identity_kind', '')
                                                             if camouflage else ((npc or {}).get('identity_kind', '')
                                                                                 if npc else ('source' if row.is_source_summary else '')))
    return {
        'character_id': _string(row.character_id),
        'character_name': row.character_name or '',
        'display_name': display_name,
        'identity_kind': identity_kind,
        'npc_source_type_id': (npc or {}).get('source_type_id'),
        'corporation_id': _string(row.corporation_id),
        'corporation_name': row.corporation_name or '',
        'corporation_ticker': getattr(row, 'corporation_ticker', '') or '',
        'alliance_id': _string(row.alliance_id),
        'alliance_name': row.alliance_name or '',
        'damage': row.damage,
        'damage_pct': _string(row.damage_pct),
        'is_final_blow': row.is_final_blow,
        'is_top_damage': row.is_top_damage,
        'ship_type_id': _string(getattr(row, 'ship_type_id', None)),
        'ship_name': item_name(getattr(row, 'ship_type_id', None)) or ship_name(getattr(row, 'ship_type_id', None)),
        'ship_image_url': image_url(getattr(row, 'ship_type_id', None)),
        'weapon_type_id': _string(getattr(row, 'weapon_type_id', None)),
        'camouflaged_faction_id': _string(getattr(row, 'camouflaged_faction_id', None)),
        'feat_score': _string(getattr(row, 'feat_score', None)),
        'is_source_summary': bool(getattr(row, 'is_source_summary', False)),
    }


def item_payload(row):
    name = item_name(row.type_id) or row.name or ''
    return {
        'type_id': _string(row.type_id),
        'name': name,
        'slot': row.slot or '',
        'quantity_dropped': row.quantity_dropped,
        'quantity_destroyed': row.quantity_destroyed,
        'quantity_unknown': row.quantity_unknown,
        'status': row.status,
        'image_url': image_url(row.type_id),
        'image_role': (image_metadata(row.type_id) or {}).get('imageRole', ''),
        'image_warning': (image_metadata(row.type_id) or {}).get('compositeWarning'),
    }


def detail_payload(report, security=None):
    result = report_payload(report, security=security)
    result['participants'] = [participant_payload(row) for row in report.participants.all()]
    result['items'] = [item_payload(row) for row in report.items.all()]
    return result
