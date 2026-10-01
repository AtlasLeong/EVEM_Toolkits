"""Exact hull lookup from the shared client catalog."""
from GameData.registry import item_record


def ship_name(type_id):
    row = item_record(type_id)
    return row.get('name', '') if row and row.get('entity_kind') == 'ships' else ''
