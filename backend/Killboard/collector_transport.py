"""Read-only captured Killboard TCP transport; no password login is claimed.

Reuse the verified Market framing and four captured authentication calls, with
a Killboard-specific bundle validator. One factory instance is one run: choose
one session before connecting, connect lazily, then permanently stop on any
auth, rate, network or malformed wire/KM failure. Semantic shape drift in
optional identity responses may be skipped after the full frame is consumed.
There is no reconnect, credential
rotation, PCAP/DPAPI reader, automatic scan or network work at import time.
"""

from __future__ import annotations

import copy
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
import math
from typing import Any

import msgpack
from GameSessions.coordination import CoordinationError, account_lease
from GameSessions.rejections import request_too_often

from Market import collector_protocol as market
from Market.session_bundle import NeedsAuthError as MarketNeedsAuthError

from .protocol import KillProtocolError, decode_kill_info_response
from .identity_protocol import IdentityProtocolError, decode_public_info, decode_corp_brief, profile_ids
from .parser import KillParseError, parse_kill_blob
from .session_bundle import (MAX_KILL_ID, REQUIRED_METHODS, OPTIONAL_METHODS,
                             load_round_robin_session, safe_material_metadata, validate_session)


MAX_IDENTITY_CACHE = 4096
AUDIT_STAGES = ('connection', 'authentication', 'kill_report', 'identity')
AUDIT_ERROR_CODES = ('unauthorized', 'rate_limited', 'network_error', 'malformed',
                     'budget_exhausted', 'lease_lost', 'configuration_error', 'service_rejected')


@dataclass(frozen=True)
class BaseReportResult:
    """Verified base data plus a trusted local stop after identity enrichment.

    A remote mapping cannot opt into this outcome; the transport constructs it
    only after successful KM decoding. The stopped session is never reusable.
    """

    decoded: dict[str, Any]
    stop_code: str


class CollectorError(Exception):
    """Safe discovery stop code/reason; never includes remote text or secrets."""

    def __init__(self, code: str, reason: str = ''):
        self.code = code
        self.reason = reason or code
        super().__init__(f'Killboard collection stopped: {self.reason}.')


def _timeout(value) -> float:
    if (isinstance(value, bool) or not isinstance(value, (int, float))
            or not math.isfinite(value) or not 0 < value <= 120):
        raise ValueError('Invalid Killboard request timeout.')
    return float(value)


class KillboardSession(market.MarketSession):
    """The existing wire/auth state machine with a Killboard-only bundle."""

    def __init__(self, bundle: dict[str, Any], timeout: float = 10.0, *, before_rpc=None):
        # MarketSession.__init__ validates Market-only templates, so initialize
        # its documented connection state with the stricter Killboard schema.
        self.bundle = validate_session(bundle)
        self.timeout = _timeout(timeout)
        self.sock = None
        self.client_id = None
        self.proxy_id = None
        self.next_seq = 0
        self.next_server_seq = 0
        self._ended = False
        self._failure = None
        self._audit = {'rpc_count': 0, 'stage': 'connection'}
        self.set_before_rpc(before_rpc)
        self.account_lease = None

    def _check_session_ready(self):
        if self._failure is not None:
            raise CollectorError(self._failure.code, self._failure.reason) from None
        if self._ended:
            raise CollectorError('network_error', 'session_closed')

    def _latch_failure(self, failure):
        if isinstance(failure, CollectorError):
            self._failure = failure
        elif isinstance(failure, (MarketNeedsAuthError, market.ProtocolError, CoordinationError)):
            self._failure = _transport_error(failure)
        else:
            self._failure = CollectorError('network_error', 'session_closed')
        self.note_failure(self._failure.code)
        self.__exit__(None, None, None)

    def note_failure(self, code):
        if 'failure_rpc_method' not in self._audit and self._audit.get('last_rpc_method'):
            self._audit['failure_rpc_method'] = self._audit['last_rpc_method']
        if code in AUDIT_ERROR_CODES:
            self._audit['error_code'] = code

    def __enter__(self):
        self._check_session_ready()
        try:
            if self.account_lease is not None:
                self.account_lease.__enter__()
            return super().__enter__()
        except BaseException as exc:
            self._latch_failure(exc)
            raise

    def __exit__(self, *_exc):
        self._ended = True
        try:
            super().__exit__(*_exc)
            if self.account_lease is not None and self.account_lease.acquired:
                failure = self._failure
                if failure is None and len(_exc) > 1 and _exc[1] is not None:
                    failure = _transport_error(_exc[1])
                if failure is not None and failure.code == 'unauthorized':
                    self.account_lease.pause_auth()
                elif failure is not None and failure.code == 'rate_limited':
                    self.account_lease.pause_rate()
                elif failure is not None and failure.code == 'service_rejected':
                    self.account_lease.pause_service()
                elif failure is None:
                    self.account_lease.complete()
        finally:
            if self.account_lease is not None:
                failure = self._failure
                if failure is not None:
                    self.account_lease.__exit__(type(failure), failure, failure.__traceback__)
                else:
                    self.account_lease.__exit__(*_exc)

    def set_before_rpc(self, callback) -> None:
        if callback is not None and not callable(callback):
            raise ValueError('Invalid Killboard RPC callback.')
        self.before_rpc = callback

    def _rpc(self, method, item_id=None, region_id=None, *, allow_malformed=False):
        self._check_session_ready()
        try:
            return self._perform_rpc(method, item_id, region_id)
        except BaseException as exc:
            # Profile endpoints are optional and their semantic response
            # shape can drift without invalidating the already-consumed
            # frame.  Keep the socket usable for later KM probes in that one
            # case; auth, transport and throttling failures still latch.
            if (allow_malformed and method in OPTIONAL_METHODS and self.sock is not None
                    and isinstance(exc, CollectorError) and exc.code == 'malformed'
                    and exc.reason != 'unsupported_rpc'):
                raise CollectorError('malformed', 'optional_identity') from None
            self._latch_failure(exc)
            raise

    def _perform_rpc(self, method, item_id, region_id):
        if (method not in (*REQUIRED_METHODS, *OPTIONAL_METHODS)
                or method not in self.bundle['templates'] or region_id is not None):
            raise CollectorError('malformed', 'unsupported_rpc')
        self._audit['last_rpc_method'] = method
        self._audit['stage'] = ('identity' if method in OPTIONAL_METHODS else
                                'kill_report' if method == 'get_kill_info' else 'authentication')
        if self.before_rpc is not None:
            self.before_rpc()
        if self.account_lease is not None:
            self.account_lease.before_rpc()
        self._audit['rpc_count'] += 1
        result = self._raw_rpc(method, item_id)
        stop = _structured_stop(result)
        if stop:
            raise CollectorError(stop)
        if isinstance(result, msgpack.ExtType) and result.code == 10:
            result = market._unpack(result.data)
        return result

    def _raw_rpc(self, method, item_id):
        """Reuse verified framing, preserving the exact business extension tree.

        Market recursively unwraps Ext10/55 and would make a nested error
        lookalike indistinguishable from the one observed throttle envelope.
        Only Killboard's result boundary is unwrapped, after stop validation.
        """
        if self.sock is None or self.client_id is None:
            raise market.ProtocolError('Market session is not connected.')
        meta = copy.deepcopy(self.bundle['templates'][method])
        body = market._unpack(meta['content'])
        call_id = self.next_seq + 1
        body[1][1:3] = [self.client_id, call_id]
        if body[2][2] != -1 and self.proxy_id is not None:
            body[2][2] = self.proxy_id
        if item_id is not None:
            extension = body[3][0]
            call = market._unpack(extension.data)
            call[1][0] = item_id
            body[3][0] = msgpack.ExtType(10, msgpack.packb(call, use_bin_type=True))
        meta.update(content=msgpack.packb(body, use_bin_type=True), seq=self.next_seq,
                    ack=self.next_server_seq, trace=None)
        deadline = market.time.monotonic() + self.timeout
        try:
            market._remaining(self.sock, deadline)
            self.sock.sendall(market._pack(3, meta))
            self.next_seq += 1
            for _ in range(market.MAX_RESPONSE_FRAMES):
                kind, response = market._read_frame(self.sock, deadline)
                if kind != 3:
                    continue
                if not isinstance(response, dict):
                    raise market.ProtocolError('Invalid market RPC envelope.')
                server_seq = response.get('seq')
                if type(server_seq) is int and server_seq >= 0:
                    self.next_server_seq = max(self.next_server_seq, server_seq + 1)
                packet = market._unpack(response.get('content'))
                if (isinstance(packet, list) and len(packet) == 4 and packet[0] == 2
                        and isinstance(packet[2], list) and len(packet[2]) > 2
                        and type(packet[2][2]) is int and packet[2][2] == call_id):
                    if not isinstance(packet[3], list) or len(packet[3]) != 1:
                        raise market.ProtocolError('Invalid market RPC result.')
                    return packet[3][0]
            raise market.ProtocolError('No matching market RPC response.')
        except (OSError, market.ProtocolError) as exc:
            self.__exit__(type(exc), exc, exc.__traceback__)
            if isinstance(exc, (market.socket.timeout, TimeoutError)):
                raise market.ProtocolTimeout('Market request timed out.') from None
            if isinstance(exc, OSError):
                raise market.ProtocolError('Market connection is unavailable.') from None
            raise


def _transport_error(exc: Exception) -> CollectorError:
    if isinstance(exc, CoordinationError):
        if exc.code == 'account_busy':
            return CollectorError('network_error', 'account_busy')
        return CollectorError(exc.code)
    if isinstance(exc, MarketNeedsAuthError):
        return CollectorError('unauthorized')
    if isinstance(exc, market.ServiceRejectedError):
        return CollectorError('service_rejected')
    if isinstance(exc, market.ProtocolTimeout):
        return CollectorError('network_error', 'timeout')
    # Market deliberately replaces OS errors with fixed safe messages. Match
    # only these internal messages, never classify arbitrary remote strings.
    if isinstance(exc, market.ProtocolError) and str(exc) in {
        'Market connection is unavailable.',
        'Market connection closed while reading a frame.',
    }:
        return CollectorError('network_error', 'connection_unavailable')
    return CollectorError('malformed')


def _structured_stop(value, *, transport_wrapped=False) -> str | None:
    """Recognize only explicit structured stop codes; text/numeric drift stops malformed.

    The observed Ext10 -> Ext16 -> UserError/RequestTooOften/null is exact.
    Preserve the original extension shape; recursively removing wrappers
    would misclassify malformed lookalikes. Never infer from remote prose.
    """
    if isinstance(value, msgpack.ExtType):
        if value.code == 10:
            try:
                nested = market._unpack(value.data)
            except market.ProtocolError:
                return 'malformed'
            if isinstance(nested, msgpack.ExtType) and nested.code == 10:
                return 'malformed'
            return _structured_stop(nested, transport_wrapped=True)
        if value.code == 16:
            if not transport_wrapped:
                return 'malformed'
            try:
                error = msgpack.unpackb(value.data, raw=False, strict_map_key=False,
                                       max_array_len=4, max_str_len=64, max_bin_len=64,
                                       max_map_len=4, max_ext_len=64)
            except (ValueError, TypeError, msgpack.UnpackException):
                return 'malformed'
            return 'rate_limited' if request_too_often(error) else 'malformed'
        if value.code not in (19, 58):
            return 'malformed'
    if isinstance(value, list) and value and value[0] == 'UserError':
        return 'malformed'
    if isinstance(value, dict) and 'error' in value:
        if isinstance(value['error'], dict):
            code = value['error'].get('code')
            if code in ('unauthorized', 'rate_limited'):
                return code
        return 'malformed'
    return None


class KillboardClient:
    """Lazy single-run ProbeClient, usable as a context manager or with close()."""

    def __init__(self, bundle: dict[str, Any], timeout: float = 10.0, *, before_rpc=None,
                 enrich=True, session_slot='', material_metadata=None):
        if type(enrich) is not bool:
            raise ValueError('Invalid Killboard enrichment setting.')
        self.session = KillboardSession(bundle, timeout, before_rpc=before_rpc)
        self.enrich = enrich
        self._enrichment_min_isk = None
        self._closed = False
        self._failure: CollectorError | None = None
        self._identities = {'characters': {}, 'corporations': {}}
        self._queried = {'characters': set(), 'corporations': set()}
        if not isinstance(session_slot, str) or (session_slot and (
                not session_slot.isascii() or not session_slot.isalpha()
                or not session_slot.isupper() or len(session_slot) > 2)):
            raise ValueError('Invalid Killboard session ordinal.')
        self._session_slot = session_slot
        self._material_metadata = safe_material_metadata(material_metadata)
        if material_metadata is not None and material_metadata != self._material_metadata:
            raise ValueError('Invalid Killboard material attribution.')

    def audit_snapshot(self):
        result = dict(self.session._audit)
        if self._session_slot:
            result['session_slot'] = self._session_slot
        result.update(self._material_metadata)
        return result

    def set_before_rpc(self, callback) -> None:
        """Install one run-wide pacer without connecting or invoking it."""
        self.session.set_before_rpc(callback)

    def set_enrichment_min_isk(self, value) -> None:
        """Skip identity RPCs for losses excluded by a strict value policy.

        None retains the generic/manual client's full enrichment behavior.
        Invalid configuration is rejected before connecting or spending RPCs.
        """
        if value is None:
            self._enrichment_min_isk = None
            return
        if isinstance(value, bool) or not isinstance(value, (Decimal, int, float, str)):
            raise ValueError('Invalid Killboard enrichment threshold.')
        try:
            threshold = Decimal(str(value))
        except (InvalidOperation, ValueError):
            raise ValueError('Invalid Killboard enrichment threshold.') from None
        if not threshold.is_finite() or threshold < 0:
            raise ValueError('Invalid Killboard enrichment threshold.')
        self._enrichment_min_isk = threshold

    def __enter__(self):
        if self._closed:
            raise CollectorError('network_error', 'client_closed')
        return self

    def __exit__(self, *_exc):
        self.close()

    def close(self) -> None:
        self.session.__exit__(None, None, None)
        self._closed = True

    def _stop(self, failure: CollectorError):
        self._failure = failure
        self.session.note_failure(failure.code)
        self.close()
        raise failure from None

    def _check_ready(self):
        if self._failure is not None:
            raise CollectorError(self._failure.code, self._failure.reason) from None
        if self._closed:
            raise CollectorError('network_error', 'client_closed')

    def _request(self, method, item_id, decoder, *, optional=False):
        self._check_ready()
        try:
            if self.session.sock is None:
                self.session.__enter__()
            result = self.session._rpc(method, item_id=item_id, allow_malformed=optional)
            return decoder(result)
        except CollectorError as exc:
            # Optional identity endpoints are allowed to drift independently
            # of the KM endpoint.  The response frame has already been
            # consumed, so a semantic shape error is safe to skip; transport,
            # auth and throttle failures still stop the run immediately.
            if optional and exc.code == 'malformed' and exc.reason == 'optional_identity':
                raise
            self._stop(exc)
        except (MarketNeedsAuthError, market.ProtocolError) as exc:
            self._stop(_transport_error(exc))
        except (KillProtocolError, IdentityProtocolError, KillParseError) as exc:
            if optional and isinstance(exc, IdentityProtocolError):
                raise CollectorError('malformed', 'optional_identity') from None
            self._stop(CollectorError('malformed', type(exc).__name__))
        except BaseException as exc:
            # Pacer budget/cancellation propagate unchanged but stop reuse.
            self.session.note_failure(getattr(exc, 'code', ''))
            self.close()
            raise

    def _profiles(self, method, identifiers, collection, decoder):
        try:
            identifiers = profile_ids(identifiers)
        except IdentityProtocolError:
            raise ValueError('Invalid Killboard identity request.') from None
        self._check_ready()
        if method not in self.session.bundle['templates']:
            return {}
        missing = [value for value in identifiers if value not in self._queried[collection]]
        missing = missing[:max(0, MAX_IDENTITY_CACHE - len(self._queried[collection]))]
        if missing:
            try:
                rows = self._request(method, missing, lambda value: decoder(value, missing), optional=True)
            except CollectorError as exc:
                if exc.code != 'malformed' or exc.reason != 'optional_identity':
                    raise
                # Keep the valid KM and any other identity rows already
                # decoded in this run.  Cache the attempted IDs so one drifted
                # endpoint cannot multiply requests for every participant.
                rows = {}
            self._queried[collection].update(missing)
            self._identities[collection].update(rows)
        return copy.deepcopy({value: self._identities[collection][value] for value in identifiers
                              if value in self._identities[collection]})

    def get_public_info(self, identifiers):
        """One bounded verified batch, cached for this run; missing rows omitted."""
        return self._profiles('get_public_info', identifiers, 'characters', decode_public_info)

    def get_corp_brief(self, identifiers):
        return self._profiles('get_corp_brief', identifiers, 'corporations', decode_corp_brief)

    def _enrich_report(self, decoded):
        parsed = parse_kill_blob(decoded['kill_blob'], summary=decoded)
        # Discovery still parses and records every verified report response,
        # including excluded losses, so its consecutive-ID cursor can advance.
        # Malformed/nonfinite source values are rejected by the parser above.
        if self._enrichment_min_isk is not None and (
                parsed['isk_lost'] is None or parsed['isk_lost'] <= self._enrichment_min_isk):
            return decoded
        participants = [row for row in parsed['participants']
                        if type(row.get('character_id')) is int and row['character_id'] > 0][:7]
        identifiers = [parsed['victim_character_id'], *[row['character_id'] for row in participants]]
        identifiers = list(dict.fromkeys(value for value in identifiers if type(value) is int and value > 0))
        characters = self.get_public_info(identifiers) if identifiers else {}
        corporation_ids = [parsed['victim_corporation_id'], *[row['corporation_id'] for row in participants],
                           *[row.get('corporation_id') for row in characters.values()]]
        corporation_ids = list(dict.fromkeys(value for value in corporation_ids if type(value) is int and value > 0))
        corporations = self.get_corp_brief(corporation_ids) if corporation_ids else {}
        alliances = {}
        for row in corporations.values():
            if row.get('alliance_id') is not None and row.get('alliance_name'):
                alliances[row['alliance_id']] = {'name': row['alliance_name']}
        return {**decoded, 'identity_map': {'characters': characters, 'corporations': corporations,
                                           'alliances': alliances}}

    def get_kill_info(self, kill_id: int, *, enrich=None) -> Any:
        if type(kill_id) is not int or not 1 <= kill_id <= MAX_KILL_ID:
            raise ValueError('Kill ID is outside the signed 64-bit positive range.')
        if enrich is not None and type(enrich) is not bool:
            raise ValueError('Invalid Killboard enrichment setting.')
        def decode(result):
            # Validate the business extension before returning it to discovery;
            # no-report remains distinct from malformed/auth/network failure.
            decoded = decode_kill_info_response(result)
            if decoded and 'kill_id' in decoded:
                if type(decoded['kill_id']) is not int or decoded['kill_id'] != kill_id:
                    raise KillProtocolError('Kill response identifier does not match the request.')
            elif decoded and 'kill_blob' in decoded:
                observed_id = parse_kill_blob(decoded['kill_blob'])['kill_id']
                if observed_id is not None and observed_id != kill_id:
                    raise KillProtocolError('Kill response identifier does not match the request.')
            if ((self.enrich if enrich is None else enrich) and decoded and 'kill_blob' in decoded
                    and any(method in self.session.bundle['templates'] for method in OPTIONAL_METHODS)):
                try:
                    return self._enrich_report(decoded)
                except Exception as exc:
                    code = getattr(exc, 'code', '')
                    if (code not in ('rate_limited', 'unauthorized', 'network_error', 'budget_exhausted', 'malformed', 'service_rejected')
                            or (code == 'malformed' and not isinstance(exc, CollectorError))):
                        raise
                    # Retain only identity rows already decoded through the
                    # verified endpoints. The failing request has latched and
                    # closed this client's transport before returning here.
                    # An identity wire failure cannot invalidate the already
                    # decoded base KM; malformed base parsing itself is not
                    # a CollectorError and remains fatal above.
                    identities = copy.deepcopy(self._identities)
                    identities['alliances'] = {
                        row['alliance_id']: {'name': row['alliance_name']}
                        for row in identities['corporations'].values()
                        if row.get('alliance_id') is not None and row.get('alliance_name')
                    }
                    return BaseReportResult({**decoded, 'identity_map': identities}, code)
            return result
        return self._request('get_kill_info', kill_id, decode)


def build_client(*, before_rpc=None, enrich=True, cursor_path=None) -> KillboardClient:
    """Management-command factory using explicit ``KILLBOARD_SESSION_FILES``."""
    bundle, slot, index, pool_size, metadata = load_round_robin_session(cursor_path=cursor_path, with_audit=True)
    client = KillboardClient(bundle, before_rpc=before_rpc, enrich=enrich, session_slot=slot,
                            material_metadata=metadata)
    client.session.account_lease = account_lease('KILLBOARD', index, pool_size)
    return client
