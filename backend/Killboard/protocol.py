"""Bounded decoder for the captured ``get_kill_info`` response envelope.

The observed game RPC has a transport extension (code 10) around the business
extension (code 19), whose payload is ``[71, nested_bytes]``.  Some clients
already unwrap code 10 before handing the value to this module, so the direct
code-19 shape remains accepted for compatibility.  Authentication, sockets
and raw capture files do not belong here.
"""

from __future__ import annotations

from typing import Any

import msgpack


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
MAX_RESPONSE_DEPTH = 24
MAX_RESPONSE_NODES = 10_000
MAX_ARRAY_ITEMS = 4_096
MAX_MAP_ITEMS = 1_024
MAX_STRING_BYTES = 64 * 1024
MAX_BINARY_BYTES = MAX_RESPONSE_BYTES
MAX_EXTENSION_BYTES = MAX_RESPONSE_BYTES
EXPECTED_EXTENSION = 19
EXPECTED_TRANSPORT_EXTENSION = 10
EXPECTED_RESULT_KIND = 71


class KillProtocolError(ValueError):
    """A sanitized protocol failure safe to expose as a stable error code."""

    code = "malformed"


def _unpack(data: bytes) -> Any:
    if not isinstance(data, bytes) or len(data) > MAX_RESPONSE_BYTES:
        raise KillProtocolError("kill response exceeds the size limit")
    try:
        return msgpack.unpackb(
            data,
            raw=False,
            strict_map_key=False,
            max_array_len=MAX_ARRAY_ITEMS,
            max_map_len=MAX_MAP_ITEMS,
            max_str_len=MAX_STRING_BYTES,
            max_bin_len=MAX_BINARY_BYTES,
            max_ext_len=MAX_EXTENSION_BYTES,
        )
    except (ValueError, TypeError, UnicodeDecodeError, RecursionError,
            OverflowError, msgpack.UnpackException) as exc:
        raise KillProtocolError("invalid kill response MessagePack") from exc


def _walk(value: Any, depth: int, budget: list[int]) -> Any:
    if depth > MAX_RESPONSE_DEPTH:
        raise KillProtocolError("kill response nesting exceeds the limit")
    budget[0] -= 1
    if budget[0] < 0:
        raise KillProtocolError("kill response node limit exceeded")
    if isinstance(value, msgpack.ExtType):
        # Extensions are only valid at the envelope boundary.  The transport
        # wrapper is unwrapped explicitly by ``_unwrap_envelope`` below;
        # accepting it recursively would allow arbitrary nested transport
        # payloads to bypass the shape check.
        raise KillProtocolError("unexpected kill response extension")
    if isinstance(value, bytes):
        # Bytes in the verified envelope are nested MessagePack, not arbitrary
        # opaque payloads.  Decode them only when they occur as the envelope's
        # second element; a raw kill_blob remains bytes in the result mapping.
        return value
    if isinstance(value, list):
        return [_walk(child, depth + 1, budget) for child in value]
    if isinstance(value, dict):
        result = {}
        for key, child in value.items():
            if not isinstance(key, str):
                raise KillProtocolError("kill response map key is not text")
            if key in result:
                raise KillProtocolError("duplicate kill response map key")
            result[key] = _walk(child, depth + 1, budget)
        return result
    return value


def _unwrap_envelope(value: Any, budget: list[int]) -> Any:
    """Unwrap the observed transport/business extension pair exactly once."""
    if isinstance(value, msgpack.ExtType) and value.code == EXPECTED_TRANSPORT_EXTENSION:
        value = _unpack(value.data)
    if not isinstance(value, msgpack.ExtType) or value.code != EXPECTED_EXTENSION:
        raise KillProtocolError("invalid get_kill_info extension envelope")
    value = _unpack(value.data)
    return _walk(value, 0, budget)


def decode_kill_info_response(payload: bytes | bytearray | Any) -> dict[str, Any] | None:
    """Decode one ``get_kill_info`` result and return its safe mapping.

    ``None`` and an empty result list are the source's no-report response.  A
    non-empty result must be the extension-19 / kind-71 envelope and contain a
    mapping (typically ``{"kill_blob": bytes}``).
    """

    if isinstance(payload, bytearray):
        payload = bytes(payload)
    if isinstance(payload, bytes):
        if not payload:
            return None
        value = _unpack(payload)
    else:
        value = payload
    if value is None or value == []:
        return None
    value = _unwrap_envelope(value, [MAX_RESPONSE_NODES])
    if not isinstance(value, list) or len(value) != 2 or value[0] != EXPECTED_RESULT_KIND:
        raise KillProtocolError("invalid get_kill_info envelope")
    nested = value[1]
    if not isinstance(nested, bytes):
        raise KillProtocolError("invalid get_kill_info nested payload")
    nested_value = _walk(_unpack(nested), 0, [MAX_RESPONSE_NODES])
    if nested_value is None or nested_value == []:
        return None
    if not isinstance(nested_value, dict):
        raise KillProtocolError("get_kill_info result is not a mapping")
    # A captured response stores kill_blob as text; older callers used bytes,
    # which remain accepted here and are normalized later by the parser.
    blob = nested_value.get("kill_blob")
    if blob is not None and not isinstance(blob, (str, bytes, bytearray)):
        raise KillProtocolError("kill response kill_blob is not text")
    return nested_value
