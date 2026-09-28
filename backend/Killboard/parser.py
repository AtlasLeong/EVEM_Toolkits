"""Strict, bounded parser for the game's XML-like ``kill_blob`` value."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re
from typing import Iterable


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


def _parse_tree(source: str) -> _Node:
    if len(source.encode("utf-8")) > MAX_BLOB_BYTES:
        _fail("kill blob exceeds the size limit")
    if _CONTROL.search(source):
        _fail("control character in kill blob")
    stack: list[_Node] = []
    root = None
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
            elif root is not None:
                _fail("kill blob contains multiple roots")
            else:
                root = node
            if not self_closing:
                stack.append(node)
        index = after
    if stack or root is None:
        _fail("kill blob root is incomplete")
    return root


def _attr(node: _Node, *names: str, default: str | None = None) -> str | None:
    for name in names:
        if name.lower() in node.attrs:
            return node.attrs[name.lower()]
    return default


def _int(value: str | None, label: str, *, required: bool = False) -> int | None:
    if value is None or value == "":
        if required:
            _fail(f"missing {label}")
        return None
    if not _INTEGER.fullmatch(value):
        _fail(f"invalid {label}")
    try:
        result = int(value)
    except (TypeError, ValueError, OverflowError):
        _fail(f"invalid {label}")
    if result >= 2**63:
        _fail(f"{label} exceeds the range")
    return result


def _decimal(value: str | None, label: str) -> Decimal | None:
    if value is None or value == "":
        return None
    try:
        result = Decimal(value)
    except (InvalidOperation, ValueError):
        _fail(f"invalid {label}")
    if not result.is_finite() or result < 0 or len(value) > 32:
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
        "character_id": _int(_attr(node, "characterid", "character_id", "id"), "character id"),
        "character_name": _text(_attr(node, "charactername", "character_name", "name")),
        "corporation_id": _int(_attr(node, "corporationid", "corporation_id"), "corporation id"),
        "corporation_name": _text(_attr(node, "corporationname", "corporation_name")),
        "alliance_id": _int(_attr(node, "allianceid", "alliance_id"), "alliance id"),
        "alliance_name": _text(_attr(node, "alliancename", "alliance_name")),
        "damage": _int(_attr(node, "damagedone", "damage", "damage_done"), "damage"),
        "damage_pct": _decimal(_attr(node, "damagepercent", "damage_pct", "damagepct"), "damage percentage"),
        "is_final_blow": _bool(_attr(node, "finalblow", "final_blow"), "final blow"),
        "is_top_damage": _bool(_attr(node, "topdamage", "top_damage"), "top damage"),
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
        "type_id": _int(_attr(node, "typeid", "type_id", "id"), "item type id"),
        "name": _text(_attr(node, "typename", "type_name", "name")),
        "slot": _text(_attr(node, "slot")),
        "quantity_dropped": dropped,
        "quantity_destroyed": destroyed,
        "quantity_unknown": unknown,
        "status": status,
    }


def parse_kill_blob(blob: str | bytes | bytearray) -> dict:
    """Parse one report into persistence-friendly, untrusted plain values."""
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
    root = _parse_tree(blob)
    if root.name not in {"kill", "killmail", "report"}:
        _fail("unexpected kill blob root")

    kill_id = _int(_attr(root, "killid", "kill_id", "id"), "kill id", required=True)
    victim = _first(root, {"victim", "v"})
    attackers_node = _first(root, {"attackers", "participants", "a"})
    participants = []
    if attackers_node:
        attacker_nodes = _children(attackers_node, {"attacker", "participant", "a"})
        participants = [_participant(node, index) for index, node in enumerate(attacker_nodes)]
    items_node = _first(root, {"items", "equipment", "fittings"})
    item_rows = []
    if items_node:
        item_rows = [_item(node) for node in _children(items_node, {"item", "i"})]

    kill_time_raw = _text(_attr(root, "killtime", "kill_time", "time"))
    time_quality = "source" if re.search(r"(?:z|[+-][0-9]{2}:[0-9]{2})$", kill_time_raw, re.I) else "unknown"
    result = {
        "kill_id": kill_id,
        "ship_type_id": _int(_attr(root, "shiptypeid", "ship_type_id", "shipid"), "ship type id"),
        "ship_name": _text(_attr(root, "shipname", "ship_name")),
        "ship_class_key": _text(_attr(root, "shipclass", "ship_class")),
        "system_id": _int(_attr(root, "solarsystemid", "systemid", "system_id"), "system id"),
        "system_name": _text(_attr(root, "solarsystemname", "systemname", "system_name")),
        "victim_character_id": _int(_attr(victim, "characterid", "character_id") if victim else None, "victim character id"),
        "victim_name": _text(_attr(victim, "charactername", "character_name", "name") if victim else None),
        "victim_corporation_id": _int(_attr(victim, "corporationid", "corporation_id") if victim else None, "victim corporation id"),
        "victim_corporation_name": _text(_attr(victim, "corporationname", "corporation_name") if victim else None),
        "victim_alliance_id": _int(_attr(victim, "allianceid", "alliance_id") if victim else None, "victim alliance id"),
        "victim_alliance_name": _text(_attr(victim, "alliancename", "alliance_name") if victim else None),
        "kill_time_raw": kill_time_raw,
        "time_quality": time_quality,
        "isk_lost": _decimal(_attr(root, "isklost", "isk_lost", "value"), "ISK lost"),
        "participant_count": _int(_attr(root, "participantcount", "participant_count")
                                   or (_attr(attackers_node, "count") if attackers_node else None),
                                   "participant count"),
        "participants": participants,
        "items": item_rows,
        "equipment_status": "provided" if items_node else "missing",
    }
    return result

