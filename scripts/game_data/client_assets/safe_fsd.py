"""Bounded, non-executing reader for CCP FSD binary tables.

The first four bytes of an extracted table give the length of a protocol-2
schema pickle.  This module inspects that schema with :mod:`pickletools` only;
it never reconstructs Python objects from the pickle and never imports names
found in it.  The table reader understands the fixed-width integer-key footer
used by the item/type tables, plus enough object primitives to inspect ship
image fields.
"""

from __future__ import annotations

import argparse
import dataclasses
import json
import pathlib
import pickletools
import struct
from typing import Any, Iterator


MAX_FILE_BYTES = 64 * 1024 * 1024
MAX_SCHEMA_BYTES = 8 * 1024 * 1024
MAX_PICKLE_OPS = 1_000_000
MAX_STRING_BYTES = 4 * 1024 * 1024
MAX_COLLECTION_ITEMS = 1_000_000


class UnsafeFsdError(ValueError):
    """Malformed, truncated, or unsupported FSD input."""


@dataclasses.dataclass(frozen=True)
class Record:
    key: int | str
    offset: int
    size: int
    fields: dict[str, Any]


@dataclasses.dataclass(frozen=True)
class TableInfo:
    path: pathlib.Path
    file_size: int
    schema_size: int
    key_type: str
    value_type: str
    value_attributes: tuple[str, ...]
    key_count: int
    key_min: int | str | None
    key_max: int | str | None
    fixed_footer: bool


_MARK = object()


def _u32(data: bytes, pos: int) -> int:
    if pos < 0 or pos + 4 > len(data):
        raise UnsafeFsdError(f"u32 outside buffer at {pos}")
    return struct.unpack_from("<I", data, pos)[0]


def _checked_slice(data: bytes, start: int, size: int, label: str = "slice") -> bytes:
    if start < 0 or size < 0 or start > len(data) or size > len(data) - start:
        raise UnsafeFsdError(f"{label} outside buffer: {start}+{size}/{len(data)}")
    return data[start : start + size]


def parse_schema_pickle(payload: bytes) -> dict[str, Any]:
    """Parse a protocol-2 schema using a strict data-only opcode whitelist."""
    if len(payload) > MAX_SCHEMA_BYTES:
        raise UnsafeFsdError("schema exceeds safety limit")
    stack: list[Any] = []
    memo: dict[int, Any] = {}
    saw_proto = False
    saw_stop = False
    operations = 0
    try:
        ops = pickletools.genops(payload)
        for op, arg, pos in ops:
            operations += 1
            if operations > MAX_PICKLE_OPS:
                raise UnsafeFsdError("schema opcode limit exceeded")
            name = op.name
            if name == "PROTO":
                if saw_proto or arg != 2 or pos != 0:
                    raise UnsafeFsdError("only one protocol-2 header is accepted")
                saw_proto = True
            elif name == "FRAME":
                raise UnsafeFsdError("FRAME is not part of protocol-2 schemas")
            elif name == "MARK":
                stack.append(_MARK)
            elif name == "EMPTY_DICT":
                stack.append({})
            elif name == "EMPTY_LIST":
                stack.append([])
            elif name == "EMPTY_TUPLE":
                stack.append(())
            elif name in {
                "BINUNICODE",
                "SHORT_BINUNICODE",
                "BINSTRING",
                "SHORT_BINSTRING",
                "BININT",
                "BININT1",
                "BININT2",
                "LONG1",
                "LONG4",
                "BINFLOAT",
            }:
                if isinstance(arg, (str, bytes)) and len(arg) > MAX_STRING_BYTES:
                    raise UnsafeFsdError("schema string exceeds safety limit")
                stack.append(arg)
            elif name == "NEWTRUE":
                stack.append(True)
            elif name == "NEWFALSE":
                stack.append(False)
            elif name == "NONE":
                stack.append(None)
            elif name in {"BINPUT", "LONG_BINPUT"}:
                if not stack:
                    raise UnsafeFsdError("memo write with empty stack")
                memo[int(arg)] = stack[-1]
            elif name in {"BINGET", "LONG_BINGET"}:
                if int(arg) not in memo:
                    raise UnsafeFsdError(f"unknown memo index {arg}")
                stack.append(memo[int(arg)])
            elif name == "SETITEM":
                if len(stack) < 3 or not isinstance(stack[-3], dict):
                    raise UnsafeFsdError("invalid SETITEM stack")
                value, key, mapping = stack.pop(), stack.pop(), stack[-1]
                mapping[key] = value
            elif name == "SETITEMS":
                mark = _pop_mark(stack)
                if len(stack) - mark < 1 or not isinstance(stack[mark - 1], dict):
                    raise UnsafeFsdError("invalid SETITEMS stack")
                items = stack[mark + 1 :]
                if len(items) % 2:
                    raise UnsafeFsdError("odd SETITEMS item count")
                mapping = stack[mark - 1]
                mapping.update(zip(items[::2], items[1::2]))
                del stack[mark:]
            elif name == "APPEND":
                if len(stack) < 2 or not isinstance(stack[-2], list):
                    raise UnsafeFsdError("invalid APPEND stack")
                value = stack.pop()
                stack[-1].append(value)
            elif name == "APPENDS":
                mark = _pop_mark(stack)
                if mark < 1 or not isinstance(stack[mark - 1], list):
                    raise UnsafeFsdError("invalid APPENDS stack")
                stack[mark - 1].extend(stack[mark + 1 :])
                del stack[mark:]
            elif name == "TUPLE":
                mark = _pop_mark(stack)
                stack.append(tuple(stack[mark + 1 :]))
                del stack[mark:]
            elif name == "STOP":
                if saw_stop or not saw_proto or len(stack) != 1:
                    raise UnsafeFsdError("invalid STOP state")
                saw_stop = True
                result = stack[0]
            else:
                # GLOBAL, REDUCE, BUILD, NEWOBJ, EXT* and every other
                # executable/object-construction opcode are intentionally out.
                raise UnsafeFsdError(f"unsupported schema opcode {name}")
    except UnsafeFsdError:
        raise
    except Exception as exc:  # pickletools reports malformed streams this way
        raise UnsafeFsdError(f"malformed schema pickle: {exc}") from exc
    if not saw_stop or not isinstance(result, dict):
        raise UnsafeFsdError("schema has no dictionary result")
    return result


def _pop_mark(stack: list[Any]) -> int:
    for i in range(len(stack) - 1, -1, -1):
        if stack[i] is _MARK:
            return i
    raise UnsafeFsdError("container opcode without MARK")


def _schema_type(spec: dict[str, Any] | None) -> str:
    if not isinstance(spec, dict) or not isinstance(spec.get("type"), str):
        raise UnsafeFsdError("invalid FSD type specification")
    return spec["type"]


def _read_string(data: bytes, pos: int) -> tuple[str, int]:
    length = _u32(data, pos)
    if length > MAX_STRING_BYTES:
        raise UnsafeFsdError("FSD string exceeds safety limit")
    raw = _checked_slice(data, pos + 4, length, "string")
    try:
        return raw.decode("utf-8"), pos + 4 + length
    except UnicodeDecodeError as exc:
        raise UnsafeFsdError("invalid UTF-8 FSD string") from exc


def _read_value(data: bytes, pos: int, spec: dict[str, Any]) -> tuple[Any, int]:
    kind = _schema_type(spec)
    if kind == "string":
        return _read_string(data, pos)
    if kind == "int":
        size = int(spec.get("size", 4))
        if size != 4:
            raise UnsafeFsdError(f"unsupported int width {size}")
        return struct.unpack_from("<i", _checked_slice(data, pos, 4, "int"))[0], pos + 4
    if kind == "long":
        size = int(spec.get("size", 8))
        if size != 8:
            raise UnsafeFsdError(f"unsupported long width {size}")
        return struct.unpack_from("<q", _checked_slice(data, pos, 8, "long"))[0], pos + 8
    if kind == "bool":
        return bool(_checked_slice(data, pos, 1, "bool")[0]), pos + 1
    if kind == "float":
        size = int(spec.get("size", 8))
        if size not in (4, 8):
            raise UnsafeFsdError(f"unsupported float width {size}")
        raw = _checked_slice(data, pos, size, "float")
        return (struct.unpack("<f" if size == 4 else "<d", raw)[0], pos + size)
    if kind == "list":
        # Variable FSD lists carry a uint32 item count followed by items.
        count = _u32(data, pos)
        if count > MAX_COLLECTION_ITEMS:
            raise UnsafeFsdError("FSD list exceeds safety limit")
        items = []
        cursor = pos + 4
        item_spec = spec.get("itemTypes")
        if not isinstance(item_spec, dict):
            raise UnsafeFsdError("list has no itemTypes")
        for _ in range(count):
            value, cursor = _read_value(data, cursor, item_spec)
            items.append(value)
        return items, cursor
    # Nested dict/object values are not needed to resolve image references;
    # refuse them instead of guessing their wire format.
    raise UnsafeFsdError(f"unsupported FSD value type {kind}")


def _decode_object(blob: bytes, spec: dict[str, Any], wanted: set[str] | None = None) -> dict[str, Any]:
    attrs = spec.get("attributes")
    variable = spec.get("attributesWithVariableOffsets")
    optional = spec.get("optionalValueLookups", {})
    if not isinstance(attrs, dict) or not isinstance(variable, list) or not isinstance(optional, dict):
        raise UnsafeFsdError("object schema lacks attribute offset metadata")
    if len(blob) < 8:
        raise UnsafeFsdError("truncated FSD object mask")
    mask = struct.unpack_from("<Q", blob, 0)[0]
    selected: list[str] = []
    for name in variable:
        if not isinstance(name, str) or name not in attrs:
            raise UnsafeFsdError("object schema has an invalid variable attribute")
        bit = optional.get(name)
        if bit is None or mask & int(bit):
            selected.append(name)
    offset_end = 8 + 4 * len(selected)
    _checked_slice(blob, 0, offset_end, "object offsets")
    values_start = offset_end
    result: dict[str, Any] = {}
    for index, name in enumerate(selected):
        if wanted is not None and name not in wanted:
            continue
        offset = struct.unpack_from("<I", blob, 8 + 4 * index)[0]
        field_pos = values_start + offset
        value, _ = _read_value(blob, field_pos, attrs[name])
        result[name] = value
    # Constant-offset attributes are uncommon in extracted item tables. Read
    # only those with a valid integer offset; never infer an offset ourselves.
    constants = spec.get("constantAttributeOffsets", {})
    if isinstance(constants, dict):
        for name, offset in constants.items():
            if name in result or name not in attrs:
                continue
            if not isinstance(offset, int) or offset < 0:
                raise UnsafeFsdError("invalid constant attribute offset")
            value, _ = _read_value(blob, offset, attrs[name])
            result[name] = value
    return result


def _load(path: str | pathlib.Path) -> tuple[bytes, dict[str, Any], int, int, int, int]:
    path = pathlib.Path(path)
    data = path.read_bytes()
    if len(data) > MAX_FILE_BYTES:
        raise UnsafeFsdError("FSD file exceeds safety limit")
    if len(data) < 8:
        raise UnsafeFsdError("FSD file is truncated")
    schema_size = _u32(data, 0)
    if schema_size == 0 or schema_size > MAX_SCHEMA_BYTES:
        raise UnsafeFsdError("invalid schema length")
    schema = parse_schema_pickle(_checked_slice(data, 4, schema_size, "schema"))
    data_start = 4 + schema_size
    footer_size = _u32(data, len(data) - 4)
    footer_start = len(data) - 4 - footer_size
    if footer_start < data_start + 4:
        raise UnsafeFsdError("footer overlaps schema")
    return data, schema, schema_size, data_start, footer_start, footer_size


def _footer_layout(schema: dict[str, Any]) -> tuple[str, int | None]:
    key_spec = schema.get("keyTypes")
    key_type = _schema_type(key_spec)
    if key_type == "long":
        return key_type, 16
    if key_type == "int":
        return key_type, 12
    if key_type == "string":
        # String-key footer records have a variable key tail. We expose the
        # schema and count safely but do not attempt arbitrary string offsets.
        return key_type, None
    raise UnsafeFsdError(f"unsupported FSD key type {key_type}")


def _iter_fixed_footer(data: bytes, footer_start: int, footer_size: int, key_type: str, width: int) -> Iterator[tuple[int | str, int, int]]:
    count = _u32(data, footer_start)
    expected = 4 + count * width
    if count > MAX_COLLECTION_ITEMS or expected != footer_size:
        raise UnsafeFsdError("invalid fixed-width FSD footer")
    cursor = footer_start + 4
    for _ in range(count):
        if key_type == "long":
            key = struct.unpack_from("<q", _checked_slice(data, cursor, 8, "footer key"))[0]
            offset, size = struct.unpack_from("<II", _checked_slice(data, cursor + 8, 8, "footer span"))
        else:
            key = struct.unpack_from("<i", _checked_slice(data, cursor, 4, "footer key"))[0]
            offset, size = struct.unpack_from("<II", _checked_slice(data, cursor + 4, 8, "footer span"))
        yield key, offset, size
        cursor += width


def inventory_file(path: str | pathlib.Path) -> TableInfo:
    data, schema, schema_size, data_start, footer_start, footer_size = _load(path)
    key_type, width = _footer_layout(schema)
    key_count = _u32(data, footer_start)
    key_min: int | str | None = None
    key_max: int | str | None = None
    fixed = width is not None
    if width is not None:
        keys = [key for key, _, _ in _iter_fixed_footer(data, footer_start, footer_size, key_type, width)]
        if keys:
            key_min, key_max = min(keys), max(keys)
    value_spec = schema.get("valueTypes")
    value_type = _schema_type(value_spec)
    attrs = value_spec.get("attributes", {}) if isinstance(value_spec, dict) else {}
    return TableInfo(
        pathlib.Path(path), len(data), schema_size, key_type, value_type,
        tuple(attrs.keys()) if isinstance(attrs, dict) else (), key_count,
        key_min, key_max, fixed,
    )


def lookup_record(path: str | pathlib.Path, key: int | str, fields: set[str] | None = None) -> Record | None:
    data, schema, schema_size, data_start, footer_start, footer_size = _load(path)
    key_type, width = _footer_layout(schema)
    if width is None:
        raise UnsafeFsdError("string-key footer lookup is intentionally unsupported")
    if key_type == "long" and not isinstance(key, int):
        raise UnsafeFsdError("long footer requires integer key")
    if key_type == "int" and not isinstance(key, int):
        raise UnsafeFsdError("int footer requires integer key")
    value_spec = schema.get("valueTypes")
    if not isinstance(value_spec, dict):
        raise UnsafeFsdError("table has no value schema")
    for footer_key, offset, size in _iter_fixed_footer(data, footer_start, footer_size, key_type, width):
        if footer_key != key:
            continue
        blob_start = data_start + 4 + offset
        blob = _checked_slice(data, blob_start, size, "FSD record")
        decoded = _decode_object(blob, value_spec, fields) if _schema_type(value_spec) == "object" else {"value": _read_value(blob, 0, value_spec)[0]}
        return Record(footer_key, offset, size, decoded)
    return None


def iter_inventory(directory: str | pathlib.Path) -> Iterator[TableInfo]:
    for path in sorted(pathlib.Path(directory).glob("*.bin")):
        try:
            yield inventory_file(path)
        except UnsafeFsdError:
            continue


def _main() -> int:
    parser = argparse.ArgumentParser(description="safe, non-executing FSD schema/table inspector")
    parser.add_argument("path", type=pathlib.Path)
    parser.add_argument("--lookup", type=int)
    args = parser.parse_args()
    if args.path.is_dir():
        for info in iter_inventory(args.path):
            print(json.dumps(dataclasses.asdict(info), ensure_ascii=False, default=str))
        return 0
    info = inventory_file(args.path)
    print(json.dumps(dataclasses.asdict(info), ensure_ascii=False, default=str))
    if args.lookup is not None:
        record = lookup_record(args.path, args.lookup)
        print(json.dumps(dataclasses.asdict(record) if record else None, ensure_ascii=False, default=str))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main())
