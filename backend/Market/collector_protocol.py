"""Read-only captured-template market RPC. No account/password login is claimed.

Adapted from the separately verified Windows collector transport, without its
PCAP/DPAPI/configuration files. Use one context per collection cycle, then close.
This module does not load Django settings or connect at import time.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from decimal import Decimal, localcontext
import math
import socket
import struct
import time
from typing import Any
import uuid

import msgpack

from .session_bundle import NeedsAuthError, validate_session


MAX_FRAME_SIZE = 10_000_000
MAX_RESPONSE_FRAMES = 100
MAX_NESTING = 64


class ProtocolError(Exception):
    """Sanitized protocol/transport error, with a stable machine-readable code."""

    code = 'protocol_error'


class ProtocolTimeout(ProtocolError):
    code = 'timeout'


@dataclass(frozen=True)
class Quote:
    best_sell: Decimal | None
    best_buy: Decimal | None
    sell_count: int
    buy_count: int


def _unpack(data):
    try:
        return msgpack.unpackb(data, raw=False, strict_map_key=False)
    except (ValueError, TypeError, UnicodeDecodeError, RecursionError, msgpack.UnpackException):
        raise ProtocolError('Invalid market MessagePack data.') from None


def unpack_nested(value: Any) -> Any:
    """Decode the two extension envelopes observed by the original collector."""
    if isinstance(value, bytes):
        value = _unpack(value)

    def visit(part, depth):
        if depth > MAX_NESTING:
            raise ProtocolError('Market response nesting limit exceeded.')
        if isinstance(part, msgpack.ExtType):
            if part.code not in (10, 55):
                return part
            return visit(_unpack(part.data), depth + 1)
        if isinstance(part, list):
            return [visit(child, depth + 1) for child in part]
        if isinstance(part, dict):
            return {key: visit(child, depth + 1) for key, child in part.items()}
        return part

    return visit(value, 0)


def _price(value):
    if isinstance(value, bool) or not isinstance(value, (int, float, Decimal)):
        raise ProtocolError('Invalid market order price.')
    result = Decimal(str(value))
    if not result.is_finite() or not 0 < result < Decimal('1e18'):
        raise ProtocolError('Invalid market order price.')
    # The durable snapshot uses DECIMAL(20, 2). Reject, never round an observed
    # price into a different quote or leave overflow to database coercion.
    with localcontext() as context:
        context.prec = 32
        if result != result.quantize(Decimal('0.01')):
            raise ProtocolError('Market order price has unsupported precision.')
    return result


def extract_prices(value: Any) -> list[Decimal]:
    """Parse observed dictionary and schema/value orders; reject schema drift."""
    prices = []
    wrapper_keys = {'nested', 'orders', 'rows', 'items', 'data', 'result', 'values', 'value'}
    error_keys = {'error', 'errors', 'err', 'exception', 'message'}

    def visit(part, depth=0):
        if depth > MAX_NESTING:
            raise ProtocolError('Market response nesting limit exceeded.')
        if isinstance(part, dict):
            if any(str(key).lower() in error_keys for key in part):
                raise ProtocolError('Market response contains an error.')
            if 'price' in part:
                if any(isinstance(value, (dict, list)) for key, value in part.items() if key != 'price'):
                    raise ProtocolError('Unrecognized market order data.')
                prices.append(_price(part['price']))
                return
            if not part:
                return
            if len(part) != 1 or next(iter(part)) not in wrapper_keys:
                raise ProtocolError('Unrecognized market order data.')
            child = next(iter(part.values()))
            if not isinstance(child, (dict, list)):
                raise ProtocolError('Unrecognized market order data.')
            visit(child, depth + 1)
            return
        if not isinstance(part, list):
            raise ProtocolError('Unrecognized market order data.')
        if not part:
            return
        if (len(part) == 2 and isinstance(part[0], list) and part[0]
                and all(isinstance(field, list) and field for field in part[0])):
            field_names = [field[0] for field in part[0]]
            if 'price' in field_names:
                index = field_names.index('price')
                rows = part[1]
                if not isinstance(rows, list):
                    raise ProtocolError('Invalid market order rows.')
                if not rows:
                    return
                if all(isinstance(row, list) for row in rows):
                    for row in rows:
                        if len(row) <= index:
                            raise ProtocolError('Invalid market order row.')
                        prices.append(_price(row[index]))
                else:
                    if len(rows) <= index:
                        raise ProtocolError('Invalid market order row.')
                    prices.append(_price(rows[index]))
                return
        for child in part:
            visit(child, depth + 1)

    visit(value)
    return prices


def summarize_orders(result: Any) -> Quote:
    if not isinstance(result, list) or len(result) < 2:
        raise ProtocolError('Market response lacks sell and buy sides.')
    if isinstance(result[0], str):
        # Remote error strings can contain identifiers/session data.
        raise ProtocolError('Market RPC was rejected.')
    sells, buys = extract_prices(result[0]), extract_prices(result[1])
    return Quote(min(sells) if sells else None, max(buys) if buys else None, len(sells), len(buys))


def _pack(kind, body):
    data = msgpack.packb([kind, msgpack.packb(body, use_bin_type=True)], use_bin_type=True)
    return struct.pack('<I', len(data)) + data


def _remaining(sock, deadline):
    remaining = deadline - time.monotonic()
    if remaining <= 0:
        raise ProtocolTimeout('Market request timed out.')
    sock.settimeout(remaining)


def _read_exact(sock, size, deadline):
    chunks = bytearray()
    while len(chunks) < size:
        _remaining(sock, deadline)
        chunk = sock.recv(size - len(chunks))
        if not chunk:
            raise ProtocolError('Market connection closed while reading a frame.')
        chunks.extend(chunk)
    return bytes(chunks)


def _read_frame(sock, deadline):
    size = struct.unpack('<I', _read_exact(sock, 4, deadline))[0]
    if not 0 < size <= MAX_FRAME_SIZE:
        raise ProtocolError('Invalid market frame size.')
    outer = _unpack(_read_exact(sock, size, deadline))
    if (not isinstance(outer, list) or len(outer) != 2
            or type(outer[0]) is not int or not isinstance(outer[1], bytes)):
        raise ProtocolError('Invalid market frame envelope.')
    return outer[0], _unpack(outer[1])


def _identifier(value):
    if type(value) is not int or not 0 < value < 2**63:
        raise ProtocolError('Invalid market identifier.')
    return value


class MarketSession:
    """A synchronous, bounded, short-lived connection for one collection cycle."""

    def __init__(self, bundle: dict[str, Any], timeout: float = 10.0):
        self.bundle = validate_session(bundle)
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 120:
            raise ProtocolError('Invalid market request timeout.')
        self.timeout = timeout
        self.sock = None
        self.client_id = None
        self.proxy_id = None
        self.next_seq = 0
        self.next_server_seq = 0

    def __enter__(self):
        if self.sock is not None:
            raise ProtocolError('Market session is already connected.')
        self.client_id = self.proxy_id = None
        self.next_seq = self.next_server_seq = 0
        try:
            self.sock = socket.create_connection(tuple(self.bundle['endpoint']), timeout=self.timeout)
            deadline = time.monotonic() + self.timeout
            _remaining(self.sock, deadline)
            hello = copy.deepcopy(self.bundle['hello'])
            hello['token'] = str(uuid.uuid4())
            self.sock.sendall(_pack(1, hello))
            kind, response = _read_frame(self.sock, deadline)
            if kind != 2 or not isinstance(response, dict) or response.get('accepted') is not True:
                raise NeedsAuthError('Market handshake rejected; refresh the private session.')
            try:
                self.client_id = _identifier(response['info']['node_info']['node_id'])
            except (KeyError, TypeError):
                raise ProtocolError('Invalid market handshake response.') from None
            self.authenticate()
            return self
        except BaseException as exc:
            self.__exit__(None, None, None)
            if isinstance(exc, (socket.timeout, TimeoutError)):
                raise ProtocolTimeout('Market connection timed out.') from None
            if isinstance(exc, OSError):
                raise ProtocolError('Market connection is unavailable.') from None
            raise

    def __exit__(self, *_exc):
        if self.sock is not None:
            try:
                self.sock.close()
            except OSError:
                pass
            finally:
                self.sock = None
                self.client_id = self.proxy_id = None

    def _rpc(self, method, item_id=None, region_id=None):
        if self.sock is None or self.client_id is None:
            raise ProtocolError('Market session is not connected.')
        meta = copy.deepcopy(self.bundle['templates'][method])
        body = _unpack(meta['content'])
        call_id = self.next_seq + 1
        body[1][1:3] = [self.client_id, call_id]
        if body[2][2] != -1 and self.proxy_id is not None:
            body[2][2] = self.proxy_id
        if item_id is not None or region_id is not None:
            extension = body[3][0]
            call = _unpack(extension.data)
            if item_id is not None:
                call[1][0] = item_id
                if region_id is not None:
                    call[1][1] = region_id
            else:
                call[1][0] = region_id
            body[3][0] = msgpack.ExtType(extension.code, msgpack.packb(call, use_bin_type=True))
        meta.update(content=msgpack.packb(body, use_bin_type=True), seq=self.next_seq,
                    ack=self.next_server_seq, trace=None)
        deadline = time.monotonic() + self.timeout
        try:
            _remaining(self.sock, deadline)
            self.sock.sendall(_pack(3, meta))
            self.next_seq += 1
            for _ in range(MAX_RESPONSE_FRAMES):
                kind, response = _read_frame(self.sock, deadline)
                if kind != 3:
                    continue
                if not isinstance(response, dict):
                    raise ProtocolError('Invalid market RPC envelope.')
                server_seq = response.get('seq')
                if type(server_seq) is int and server_seq >= 0:
                    self.next_server_seq = max(self.next_server_seq, server_seq + 1)
                packet = unpack_nested(response.get('content'))
                if (isinstance(packet, list) and len(packet) > 3 and packet[0] == 2
                        and isinstance(packet[2], list) and len(packet[2]) > 2
                        and type(packet[2][2]) is int and packet[2][2] == call_id):
                    if not isinstance(packet[3], list) or not packet[3]:
                        raise ProtocolError('Invalid market RPC result.')
                    return packet[3][0]
            raise ProtocolError('No matching market RPC response.')
        except (OSError, ProtocolError) as exc:
            # A timeout can leave half a frame unread. Reusing that byte stream
            # could misattribute the next item; fail closed until a new cycle.
            self.__exit__(None, None, None)
            if isinstance(exc, (socket.timeout, TimeoutError)):
                raise ProtocolTimeout('Market request timed out.') from None
            if isinstance(exc, OSError):
                raise ProtocolError('Market connection is unavailable.') from None
            raise

    def authenticate(self):
        result = self._rpc('login_sigma')
        if (not isinstance(result, list) or len(result) < 2 or type(result[0]) is not int
                or result[0] != 0 or not isinstance(result[1], dict)):
            raise NeedsAuthError('Market login rejected; refresh the private session.')
        try:
            self.client_id = _identifier(result[1]['client_id'])
            self.proxy_id = _identifier(result[1]['proxy_node_id'])
        except (KeyError, TypeError, ProtocolError):
            raise NeedsAuthError('Market login rejected; refresh the private session.') from None
        for method in ('request_start_wait', 'get_newbie_info', 'select_character_id'):
            result = self._rpc(method)
            if ((isinstance(result, list) and result and isinstance(result[0], str))
                    or (method == 'select_character_id' and (type(result) is not int or result != 1))):
                raise NeedsAuthError('Market character entry rejected; refresh the private session.')

    def quote(self, item_id: int, region_id: int = 8) -> Quote:
        return summarize_orders(self._rpc('get_super_orders', _identifier(item_id), _identifier(region_id)))
