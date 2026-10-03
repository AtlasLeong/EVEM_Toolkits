"""Strict, bounded parser for the game's XML-like ``kill_blob`` value."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re
from typing import Iterable, Mapping


MAX_BLOB_BYTES = 1_000_000
MAX_NODES = 10_000
MAX_ATTRIBUTES_PER_NODE = 64
MAX_DEPTH = 32
MAX_TEXT_LENGTH = 255
_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.:-]*")
_INTEGER = re.compile(r"0|[1-9][0-9]*")
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_ENTITY = re.compile(r"&[^<>;\r\n]{1,64};")


class KillParseError(ValueError):
    """A malformed or unsafe kill blob."""

    code = "malformed"


@dataclass
class _Node:
    name: str
    attrs: dict[str, str]
    children: list["_Node"] = field(default_factory=list)


def _fail(message: str) -> None:
    raise KillParseError(message)


def _scan_tag(source: str, start: int) -> tuple[str, bool, int]:
    """Return the raw tag body, closing flag and index after ``>``."""
    quote = None
    index = start + 1
    while index < len(source):
        char = source[index]
        if quote:
            if char == quote:
                quote = None
        elif char in "'\"":
            quote = char
        elif char == ">":
            raw = source[start + 1:index]
            if raw.startswith("!") or raw.startswith("?"):
                _fail("comments and processing instructions are not allowed")
            return raw, raw.lstrip().startswith("/"), index + 1
        index += 1
    _fail("unterminated kill blob tag")


def _parse_attrs(raw: str) -> tuple[str, dict[str, str], bool]:
    text = raw.strip()
    closing = text.startswith("/")
    if closing:
        text = text[1:].lstrip()
    self_closing = False
    if not closing and text.endswith("/"):
        self_closing = True
        text = text[:-1].rstrip()
    match = _NAME.match(text)
    if not match:
        _fail("invalid kill blob tag name")
    name = match.group(0).lower()
    if closing:
        if text[match.end():].strip():
            _fail("closing tag has attributes")
        return name, {}, False
    attrs: dict[str, str] = {}
    index = match.end()
    while index < len(text):
        while index < len(text) and text[index].isspace():
            index += 1
        if index == len(text):
            break
        attr_match = _NAME.match(text, index)
        if not attr_match:
            _fail("invalid kill blob attribute name")
        attr_name = attr_match.group(0).lower()
        if attr_name in attrs:
            _fail("duplicate kill blob attribute")
        index = attr_match.end()
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text) or text[index] != "=":
            _fail("kill blob attributes must have values")
        index += 1
        while index < len(text) and text[index].isspace():
            index += 1
        if index >= len(text):
            _fail("missing kill blob attribute value")
        if text[index] in "'\"":
            quote = text[index]
            index += 1
            end = text.find(quote, index)
            if end < 0:
                _fail("unterminated kill blob attribute value")
            value = text[index:end]
            index = end + 1
        else:
            end = index
            while end < len(text) and not text[end].isspace():
                end += 1
            value = text[index:end]
            index = end
        if _CONTROL.search(value):
            _fail("control character in kill blob attribute")
        if _ENTITY.search(value):
            _fail("entities are not allowed in kill blob attributes")
        if len(value) > MAX_TEXT_LENGTH:
            _fail("kill blob attribute value is too long")
        attrs[attr_name] = value
        if len(attrs) > MAX_ATTRIBUTES_PER_NODE:
            _fail("kill blob attribute limit exceeded")
    return name, attrs, self_closing


def _parse_forest(source: str) -> list[_Node]:
    if len(source.encode("utf-8")) > MAX_BLOB_BYTES:
        _fail("kill blob exceeds the size limit")
    if _CONTROL.search(source):
        _fail("control character in kill blob")
    stack: list[_Node] = []
    roots: list[_Node] = []
    nodes = 0
    index = 0
    while index < len(source):
        opening = source.find("<", index)
        if opening < 0:
            if source[index:].strip():
                _fail("text outside kill blob root")
            break
        if source[index:opening].strip():
            _fail("text content is not allowed in kill blob")
        raw, closing, after = _scan_tag(source, opening)
        name, attrs, self_closing = _parse_attrs(raw)
        if closing:
            if not stack or stack[-1].name != name:
                _fail("kill blob closing tag does not match")
            stack.pop()
        else:
            nodes += 1
            if nodes > MAX_NODES:
                _fail("kill blob node limit exceeded")
            if len(stack) >= MAX_DEPTH:
                _fail("kill blob nesting exceeds the limit")
            node = _Node(name, attrs)
            if stack:
                stack[-1].children.append(node)
            else:
                roots.append(node)
            if not self_closing:
                stack.append(node)
        index = after
    if stack or not roots:
        _fail("kill blob root is incomplete")
    return roots


def _parse_tree(source: str) -> _Node:
    """Parse the legacy single-root representation."""
    roots = _parse_forest(source)
    if len(roots) != 1:
        _fail("kill blob contains multiple roots")
    return roots[0]


def _attr(node: _Node, *names: str, default: str | None = None) -> str | None:
    for name in names:
        if name.lower() in node.attrs:
            return node.attrs[name.lower()]
    return default


def _int(value: str | int | None, label: str, *, required: bool = False) -> int | None:
    if value is None or value == "":
        if required:
            _fail(f"missing {label}")
        return None
    if isinstance(value, bool):
        _fail(f"invalid {label}")
    if isinstance(value, int):
        result = value
    else:
        if not isinstance(value, str) or not _INTEGER.fullmatch(value):
            _fail(f"invalid {label}")
        try:
            result = int(value)
        except (TypeError, ValueError, OverflowError):
            _fail(f"invalid {label}")
    if result < 0 or result >= 2**63:
        _fail(f"{label} exceeds the range")
    return result


def _decimal(value: str | int | float | Decimal | None, label: str) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        _fail(f"invalid {label}")
    if not result.is_finite() or result < 0 or len(str(value)) > 32:
        _fail(f"invalid {label}")
    return result


def _bool(value: str | None, label: str) -> bool:
    if value is None:
        return False
    if value.lower() in {"1", "true", "yes"}:
        return True
    if value.lower() in {"0", "false", "no"}:
        return False
    _fail(f"invalid {label}")


def _text(value: str | None) -> str:
    return value or ""


def _children(node: _Node, names: Iterable[str]) -> list[_Node]:
    wanted = {name.lower() for name in names}
    return [child for child in node.children if child.name in wanted]


def _first(node: _Node, names: Iterable[str]) -> _Node | None:
    matches = _children(node, names)
    return matches[0] if matches else None


def _participant(node: _Node, index: int) -> dict:
    return {
        # The compact wire format uses c/r/a/s/w; the long aliases are kept
        # for the legacy synthetic <kill> representation.
        "character_id": _int(_attr(node, "characterid", "character_id", "id", "c"), "character id"),
        "character_name": _text(_attr(node, "charactername", "character_name", "name")),
        "corporation_id": _int(_attr(node, "corporationid", "corporation_id", "r"), "corporation id"),
        "corporation_name": _text(_attr(node, "corporationname", "corporation_name")),
        "corporation_ticker": "",
        "alliance_id": _int(_attr(node, "allianceid", "alliance_id", "a"), "alliance id"),
        "alliance_name": _text(_attr(node, "alliancename", "alliance_name")),
        "damage": _int(_attr(node, "damagedone", "damage", "damage_done", "d"), "damage"),
        "damage_pct": _decimal(_attr(node, "damagepercent", "damage_pct", "damagepct"), "damage percentage"),
        "is_final_blow": _bool(_attr(node, "finalblow", "final_blow"), "final blow"),
        "is_top_damage": _bool(_attr(node, "topdamage", "top_damage"), "top damage"),
        "ship_type_id": _int(_attr(node, "shiptypeid", "ship_type_id", "s"), "ship type id"),
        "weapon_type_id": _int(_attr(node, "weapontypeid", "weapon_type_id", "w"), "weapon type id"),
        "camouflaged_faction_id": _int(_attr(node, "cf", "camouflaged_faction_id"), "camouflaged faction id"),
        "feat_score": _decimal(_attr(node, "fs", "feat_score"), "feat score"),
        "is_source_summary": False,
        "source_index": index,
    }


def _item(node: _Node) -> dict:
    dropped = _int(_attr(node, "d"), "dropped quantity") or 0
    destroyed = _int(_attr(node, "x"), "destroyed quantity") or 0
    unknown = _int(_attr(node, "c"), "unknown quantity") or 0
    if dropped and destroyed:
        status = "mixed"
    elif dropped:
        status = "dropped"
    elif destroyed:
        status = "destroyed"
    else:
        status = "unknown"
    return {
        "type_id": _int(_attr(node, "typeid", "type_id", "id", "t"), "item type id"),
        "name": _text(_attr(node, "typename", "type_name", "name")),
        # f is the observed compact fitting/flag field.  Keep it as an
        # opaque slot candidate; k and i_ are intentionally not guessed.
        "slot": _text(_attr(node, "slot", "f")),
        "quantity_dropped": dropped,
        "quantity_destroyed": destroyed,
        "quantity_unknown": unknown,
        "status": status,
    }


def _summary_attr(summary: Mapping | None, *names: str):
    if not summary:
        return None
    for name in names:
        if name in summary:
            return summary[name]
    return None


def _summary_participant(summary: Mapping) -> dict | None:
    character_id = _int(_summary_attr(summary, "final_character_id"), "final character id")
    row = {
        "character_id": character_id,
        "character_name": "",
        "corporation_id": _int(_summary_attr(summary, "final_corporation_id"), "final corporation id"),
        "corporation_name": "",
        "corporation_ticker": "",
        "alliance_id": _int(_summary_attr(summary, "final_alliance_id"), "final alliance id"),
        "alliance_name": "",
        "damage": _int(_summary_attr(summary, "final_damage_done"), "final damage"),
        "damage_pct": None,
        "is_final_blow": True,
        "is_top_damage": False,
        "ship_type_id": _int(_summary_attr(summary, "final_ship_type_id"), "final ship type id"),
        "weapon_type_id": _int(_summary_attr(summary, "final_weapon_type_id"), "final weapon type id"),
        "camouflaged_faction_id": _int(_summary_attr(summary, "killer_camouflaged_faction_id"), "final camouflage faction id"),
        "feat_score": _decimal(_summary_attr(summary, "killer_feat_score"), "final feat score"),
        "is_source_summary": True,
        "source_index": 0,
    }
    if not any(row.get(key) for key in ('character_id', 'ship_type_id', 'weapon_type_id', 'damage')):
        return None
    return row


def _match_final(participants: list[dict], final: dict) -> list[dict]:
    # A missing character ID does not mean NPC. Require a useful source
    # signature, and do not attach anonymous final metadata to a named player.
    if final.get('character_id'):
        matches = [row for row in participants if row.get('character_id') == final['character_id']]
    elif final.get('damage') is not None and any(final.get(k) for k in ('ship_type_id', 'weapon_type_id', 'camouflaged_faction_id')):
        keys = [key for key in ('damage', 'ship_type_id', 'weapon_type_id', 'camouflaged_faction_id', 'feat_score')
                if final.get(key) is not None]
        matches = [row for row in participants if not row.get('character_id')
                   and all(row.get(key) == final[key] for key in keys)]
    else:
        matches = []
    return matches


def _json_row(row: dict) -> dict:
    return {key: str(value) if isinstance(value, Decimal) else value for key, value in row.items()}


def _identity_value(identity_map: Mapping, collection: str, identifier: int | None) -> Mapping | str | None:
    """Return one trusted identity record without guessing from an ID.

    The compact kill report intentionally carries IDs only.  A separate,
    verified character/corporation response can be supplied by the transport
    as ``identity_map``.  Keys may be integers (the normal in-memory form) or
    strings (JSON/cache form), and values may be a name string or a mapping.
    """
    if identifier is None:
        return None
    records = identity_map.get(collection) if isinstance(identity_map, Mapping) else None
    if not isinstance(records, Mapping):
        return None
    record = records.get(identifier)
    if record is None:
        record = records.get(str(identifier))
    return record if isinstance(record, (Mapping, str)) else None


def _identity_name(record: Mapping | str | None, *keys: str) -> str:
    if isinstance(record, str):
        return record
    if not isinstance(record, Mapping):
        return ""
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _identity_id(record: Mapping | str | None, *keys: str) -> int | None:
    if not isinstance(record, Mapping):
        return None
    for key in keys:
        value = record.get(key)
        if value is not None:
            return _int(value, key)
    return None


def _identity_ticker(record: Mapping | str | None) -> str:
    # Name-only legacy identity records are not evidence of a short tag.
    value = record.get("ticker") if isinstance(record, Mapping) else None
    if not isinstance(value, str) or len(value) > MAX_TEXT_LENGTH:
        return ""
    return value.strip()


def _enrich_identity(
    participants: list[dict],
    *,
    victim_character_id: int | None,
    victim_name: str,
    victim_corporation_id: int | None,
    victim_corporation_name: str,
    victim_alliance_id: int | None,
    victim_alliance_name: str,
    identity_map: Mapping,
) -> tuple[str, str, str, str, int | None]:
    """Fill names from explicit identity responses, preserving source names."""
    def enrich_row(row: dict) -> None:
        character = _identity_value(identity_map, "characters", row.get("character_id"))
        if not row.get("character_name"):
            row["character_name"] = _identity_name(character, "name", "character_name")
        if row.get("corporation_id") is None:
            row["corporation_id"] = _identity_id(character, "corporation_id", "corp_id")
        if row.get("alliance_id") is None:
            row["alliance_id"] = _identity_id(character, "alliance_id")
        corporation = _identity_value(identity_map, "corporations", row.get("corporation_id"))
        if not row.get("corporation_name"):
            row["corporation_name"] = _identity_name(corporation, "name", "corporation_name")
        row["corporation_ticker"] = _identity_ticker(corporation)
        alliance = _identity_value(identity_map, "alliances", row.get("alliance_id"))
        if not row.get("alliance_name"):
            row["alliance_name"] = _identity_name(alliance, "name", "alliance_name")

    for participant in participants:
        enrich_row(participant)

    character = _identity_value(identity_map, "characters", victim_character_id)
    if not victim_name:
        victim_name = _identity_name(character, "name", "character_name")
    if victim_corporation_id is None:
        victim_corporation_id = _identity_id(character, "corporation_id", "corp_id")
    if victim_alliance_id is None:
        victim_alliance_id = _identity_id(character, "alliance_id")
    corporation = _identity_value(identity_map, "corporations", victim_corporation_id)
    if not victim_corporation_name:
        victim_corporation_name = _identity_name(corporation, "name", "corporation_name")
    alliance = _identity_value(identity_map, "alliances", victim_alliance_id)
    if not victim_alliance_name:
        victim_alliance_name = _identity_name(alliance, "name", "alliance_name")
    return (victim_name, victim_corporation_name, victim_alliance_name,
            _identity_ticker(corporation), victim_corporation_id)


def parse_kill_blob(
    blob: str | bytes | bytearray,
    *,
    summary: Mapping | None = None,
    metadata: Mapping | None = None,
    identity_map: Mapping | None = None,
) -> dict:
    """Parse one legacy or captured report into safe persistence values.

    Captured reports carry IDs and timestamps in the outer MessagePack map;
    ``summary`` and ``metadata`` are aliases kept for callers/tests.  When a
    transport also captures the game's character/corporation proxy responses,
    pass them as ``identity_map`` to resolve those IDs without guessing.
    """
    if isinstance(blob, bytearray):
        blob = bytes(blob)
    if isinstance(blob, bytes):
        if len(blob) > MAX_BLOB_BYTES:
            _fail("kill blob exceeds the size limit")
        try:
            blob = blob.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise KillParseError("kill blob is not UTF-8") from exc
    if not isinstance(blob, str) or not blob:
        _fail("kill blob must be non-empty text")
    if summary is not None and metadata is not None:
        _fail("provide only one report summary")
    outer = summary if summary is not None else metadata
    if outer is not None and not isinstance(outer, Mapping):
        _fail("invalid report summary")
    if identity_map is not None and not isinstance(identity_map, Mapping):
        _fail("invalid identity map")
    roots = _parse_forest(blob)
    legacy_root = roots[0] if len(roots) == 1 and roots[0].name in {"kill", "killmail", "report"} else None
    if legacy_root is None and not roots:
        _fail("kill blob is empty")

    sections = roots if legacy_root is None else legacy_root.children
    if legacy_root is None:
        section_names = [node.name for node in sections]
        if any(name not in {'attackers', 'items', 'other'} for name in section_names):
            _fail('unexpected captured section')
        if len(set(section_names)) != len(section_names):
            _fail('duplicate captured section')
    attackers_node = next((node for node in sections if node.name in {"attackers", "participants"}), None)
    items_node = next((node for node in sections if node.name in {"items", "equipment", "fittings"}), None)
    participants = []
    if attackers_node:
        attacker_nodes = _children(attackers_node, {"attacker", "participant", "a"})
        participants = [_participant(node, index) for index, node in enumerate(attacker_nodes)]

    item_rows = [_item(node) for node in _children(items_node, {"item", "i"})] if items_node else []
    if legacy_root is not None:
        kill_id_value = _attr(legacy_root, "killid", "kill_id", "id")
        victim = _first(legacy_root, {"victim", "v"})
        get = lambda *names: _attr(legacy_root, *names)
        victim_value = victim
    else:
        kill_id_value = _summary_attr(outer, "kill_id")
        get = lambda *names: _summary_attr(outer, *names)
        victim_value = None
    kill_id = _int(kill_id_value, "kill id", required=True)
    if kill_id == 0:
        _fail('invalid kill id')
    if legacy_root is not None:
        ship_type_id = _int(get("shiptypeid", "ship_type_id", "shipid"), "ship type id")
        system_id = _int(get("solarsystemid", "systemid", "system_id"), "system id")
        system_name = _text(get("solarsystemname", "systemname", "system_name"))
        victim_character_id = _int(_attr(victim_value, "characterid", "character_id") if victim_value else None, "victim character id")
        victim_name = _text(_attr(victim_value, "charactername", "character_name", "name") if victim_value else None)
        victim_corporation_id = _int(_attr(victim_value, "corporationid", "corporation_id") if victim_value else None, "victim corporation id")
        victim_corporation_name = _text(_attr(victim_value, "corporationname", "corporation_name") if victim_value else None)
        victim_alliance_id = _int(_attr(victim_value, "allianceid", "alliance_id") if victim_value else None, "victim alliance id")
        victim_alliance_name = _text(_attr(victim_value, "alliancename", "alliance_name") if victim_value else None)
    else:
        ship_type_id = _int(get("ship_type_id", "victim_ship_type_id", "shiptypeid"), "ship type id")
        system_id = _int(get("solar_system_id", "system_id", "solarsystemid"), "system id")
        system_name = _text(get("solar_system_name", "system_name", "solarsystemname"))
        victim_character_id = _int(get("victim_character_id"), "victim character id")
        victim_name = ""
        victim_corporation_id = _int(get("victim_corporation_id"), "victim corporation id")
        victim_corporation_name = ""
        victim_alliance_id = _int(get("victim_alliance_id"), "victim alliance id")
        victim_alliance_name = ""

    final_summary = {}
    final_ambiguous = False
    if outer:
        summary_participant = _summary_participant(outer)
        if summary_participant:
            matches = _match_final(participants, summary_participant)
            if len(matches) == 1:
                matches[0]['is_final_blow'] = True
                for key, value in summary_participant.items():
                    if key not in ('source_index', 'is_source_summary', 'is_top_damage') and matches[0].get(key) in (None, ''):
                        matches[0][key] = value
                final_summary = {**_json_row(summary_participant), 'match_status': 'matched',
                                 'source_index': matches[0]['source_index']}
            elif len(matches) > 1:
                final_ambiguous = True
                final_summary = {**_json_row(summary_participant), 'match_status': 'ambiguous'}
            else:
                summary_participant['source_index'] = len(participants)
                participants.append(summary_participant)
                final_summary = {**_json_row(summary_participant), 'match_status': 'added'}

    victim_corporation_ticker = ""
    if identity_map is not None:
        (victim_name, victim_corporation_name, victim_alliance_name,
         victim_corporation_ticker, victim_corporation_id) = _enrich_identity(
            participants,
            victim_character_id=victim_character_id,
            victim_name=victim_name,
            victim_corporation_id=victim_corporation_id,
            victim_corporation_name=victim_corporation_name,
            victim_alliance_id=victim_alliance_id,
            victim_alliance_name=victim_alliance_name,
            identity_map=identity_map,
        )

    total_damage = _int(_summary_attr(outer, 'victim_damage_taken'), 'total damage')
    damage_verified = bool(total_damage and participants and not final_ambiguous
                           and all(row.get('damage') is not None for row in participants)
                           and sum(row['damage'] for row in participants) == total_damage)
    if total_damage:
        for row in participants:
            if row.get('damage') is not None and row.get('damage_pct') is None:
                row['damage_pct'] = Decimal(row['damage'] * 100 // total_damage)
    if damage_verified:
        highest = max(row['damage'] for row in participants)
        for row in participants:
            row['is_top_damage'] = row['damage'] == highest
    kill_time_raw = _text(get("killtime", "kill_time", "time"))
    time_quality = "source" if re.search(r"(?:z|[+-][0-9]{2}:[0-9]{2})$", kill_time_raw, re.I) else "unknown"
    result = {
        "kill_id": kill_id,
        "ship_type_id": ship_type_id,
        "ship_name": _text(get("shipname", "ship_name")),
        "ship_class_key": _text(get("shipclass", "ship_class")),
        "system_id": system_id,
        "system_name": system_name,
        "victim_character_id": victim_character_id,
        "victim_name": victim_name,
        "victim_corporation_id": victim_corporation_id,
        "victim_corporation_name": victim_corporation_name,
        "victim_corporation_ticker": victim_corporation_ticker,
        "victim_alliance_id": victim_alliance_id,
        "victim_alliance_name": victim_alliance_name,
        "kill_time_raw": kill_time_raw,
        "time_quality": time_quality,
        "isk_lost": _decimal(get("isklost", "isk_lost", "value"), "ISK lost"),
        "participant_count": _int(
            _attr(legacy_root, "participantcount", "participant_count") if legacy_root else None,
            "participant count",
        ),
        "participant_count_source": "source" if legacy_root and _attr(legacy_root, "participantcount", "participant_count") else "unknown",
        "victim_damage_taken": total_damage,
        "damage_total_verified": damage_verified,
        "final_summary": final_summary,
        "participants": participants,
        "items": item_rows,
        "equipment_status": "provided" if items_node else "missing",
        "participants_status": "provided" if attackers_node else "summary" if participants else "missing",
    }
    if damage_verified and result['participant_count'] is None:
        result['participant_count'] = len(participants)
        result['participant_count_source'] = 'damage_reconciled'
    if outer:
        for field in ('final_character_id', 'final_corporation_id', 'final_alliance_id', 'final_ship_type_id', 'final_weapon_type_id', 'final_damage_done'):
            result[field] = _int(outer.get(field), field)
    return result

