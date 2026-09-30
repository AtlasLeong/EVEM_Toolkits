from datetime import datetime

from GameData.registry import item_name

from .catalog import ship_name
from .image_catalog import image_metadata, image_url
from .models import KillItem, KillParticipant, KillReport


def _iso(value):
    return value.isoformat() if value is not None else None


def _string(value):
    return str(value) if value is not None else None


def report_payload(report, security=None):
    return {
        'kill_id': str(report.kill_id),
        'ship_type_id': _string(report.ship_type_id),
        'ship_image_url': image_url(report.ship_type_id),
        'ship_name': report.ship_name or ship_name(report.ship_type_id),
        'ship_class_key': report.ship_class_key or '',
        'ship_class_label': report.ship_class_label or '',
        'system_id': _string(report.system_id),
        'system_name': report.system_name or (security or {}).get('system_name', ''),
        'security_status': (security or {}).get('security_status'),
        'security_label': (security or {}).get('security_label', '安等未知'),
        'security_band': (security or {}).get('security_band', 'unknown'),
        'security_color': (security or {}).get('security_color', '#9fb4b9'),
        'constellation_name': (security or {}).get('constellation_name', ''),
        'region_name': (security or {}).get('region_name', ''),
        'victim_character_id': _string(report.victim_character_id),
        'victim_name': report.victim_name or '',
        'victim_corporation_id': _string(report.victim_corporation_id),
        'victim_corporation_name': report.victim_corporation_name or '',
        'victim_alliance_id': _string(report.victim_alliance_id),
        'victim_alliance_name': report.victim_alliance_name or '',
        'kill_time_raw': report.kill_time_raw or '',
        'kill_time_display': _iso(report.kill_time_display),
        'time_quality': report.time_quality,
        'isk_lost': _string(report.isk_lost),
        'participant_count': report.participant_count,
        'participant_count_source': report.participant_count_source,
        'participants_status': report.participants_status,
        'equipment_status': report.equipment_status,
        'completeness': report.completeness,
        'source': report.source,
    }


def participant_payload(row):
    return {
        'character_id': _string(row.character_id),
        'character_name': row.character_name or '',
        'corporation_id': _string(row.corporation_id),
        'corporation_name': row.corporation_name or '',
        'alliance_id': _string(row.alliance_id),
        'alliance_name': row.alliance_name or '',
        'damage': row.damage,
        'damage_pct': _string(row.damage_pct),
        'is_final_blow': row.is_final_blow,
        'is_top_damage': row.is_top_damage,
        'ship_type_id': _string(getattr(row, 'ship_type_id', None)),
        'ship_name': ship_name(getattr(row, 'ship_type_id', None)),
        'ship_image_url': image_url(getattr(row, 'ship_type_id', None)),
        'weapon_type_id': _string(getattr(row, 'weapon_type_id', None)),
    }


def item_payload(row):
    return {
        'type_id': _string(row.type_id),
        'name': row.name or item_name(row.type_id),
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
