"""Single bounded read-only statistics pass; requires shared account leasing."""
import copy
import time
import random

import msgpack
from GameSessions.coordination import account_lease, CoordinationError
from Killboard.collector_transport import (KillboardSession, CollectorError, _timeout,
                                           _structured_stop, _transport_error, market)
from .session_bundle import validate_session, REQUIRED_METHODS, HOTSPOT_METHOD, MAX_SESSIONS
from .protocol import decode_statistics, AnomalyProtocolError

MAX_RPCS = 5
MAX_SECONDS = 90
AUDIT_STAGES = frozenset({'connection', 'authentication', 'statistics'})
AUDIT_REASONS = frozenset({'unauthorized', 'rate_limited', 'network_error', 'malformed',
                         'budget_exhausted', 'lease_lost', 'configuration_error', 'service_rejected',
                         'account_busy', 'timeout', 'connection_unavailable', 'session_closed',
                         'unsupported_rpc'})


def safe_audit(value):
    """Only locally normalized count/phase/reason may reach the worker journal."""
    if not isinstance(value, dict): return {}
    result = {}
    count = value.get('rpc_count')
    if type(count) is int and 0 <= count <= MAX_RPCS: result['rpc_count'] = count
    stage, reason = value.get('stage'), value.get('reason')
    if isinstance(stage, str) and stage in AUDIT_STAGES: result['stage'] = stage
    if isinstance(reason, str) and reason in AUDIT_REASONS: result['reason'] = reason
    return result


class HotspotSession(KillboardSession):
    """Reuse proven framing/latching, with a distinct strict capability schema."""
    def __init__(self, bundle, timeout=10, *, before_rpc=None, session_index=0, pool_size=1):
        if (type(pool_size) is not int or not 1 <= pool_size <= MAX_SESSIONS
                or type(session_index) is not int or not 0 <= session_index < pool_size):
            raise CollectorError('configuration_error')
        self.bundle = validate_session(bundle)
        self.timeout = _timeout(timeout)
        self.sock = self.client_id = self.proxy_id = None
        self.next_seq = self.next_server_seq = 0
        self._ended, self._failure = False, None
        self._audit = {'rpc_count': 0, 'stage': 'connection'}
        self.set_before_rpc(before_rpc)
        self.deadline = time.monotonic() + MAX_SECONDS
        try:
            self.account_lease = account_lease('ANOMALY', session_index, pool_size)
            if self.account_lease is None:
                raise CoordinationError()
        except CoordinationError as error:
            raise CollectorError(error.code) from None

    def __enter__(self):
        """Connection and handshake share a deadline capped by the whole pass."""
        self._check_session_ready()
        try:
            if time.monotonic() >= self.deadline:
                raise CollectorError('budget_exhausted')
            self.account_lease.__enter__()
            now = time.monotonic()
            if now >= self.deadline:
                raise CollectorError('budget_exhausted')
            if self.sock is not None:
                raise market.ProtocolError('Market session is already connected.')
            self.client_id = self.proxy_id = None
            self.next_seq = self.next_server_seq = 0
            # Do not reset this phase after connect: connection time consumes
            # the same bounded handshake allowance and the whole-pass budget.
            handshake_deadline = min(self.deadline, now + self.timeout)
            self.sock = market.socket.create_connection(tuple(self.bundle['endpoint']),
                                                        timeout=handshake_deadline - now)
            market._remaining(self.sock, handshake_deadline)
            hello = copy.deepcopy(self.bundle['hello'])
            hello['token'] = str(market.uuid.uuid4())
            self.sock.sendall(market._pack(1, hello))
            kind, response = market._read_frame(self.sock, handshake_deadline)
            if kind != 2 or not isinstance(response, dict) or type(response.get('accepted')) is not bool:
                raise market.ProtocolError('Invalid market handshake response.')
            if response['accepted'] is False:
                raise market.AuthenticationRejected('Market handshake rejected; operator authorization is required.')
            try:
                self.client_id = market._identifier(response['info']['node_info']['node_id'])
            except (KeyError, TypeError):
                raise market.ProtocolError('Invalid market handshake response.') from None
            if time.monotonic() >= self.deadline:
                raise CollectorError('budget_exhausted')
            self.authenticate()
            return self
        except BaseException as error:
            if isinstance(error, (market.socket.timeout, TimeoutError)):
                failure = CollectorError('network_error', 'timeout')
            elif isinstance(error, OSError):
                failure = CollectorError('network_error', 'connection_unavailable')
            else:
                failure = _transport_error(error)
                if isinstance(error, CollectorError):
                    failure = error
            self._latch_failure(failure)
            if not isinstance(error, Exception):
                raise
            raise failure from None

    def _perform_rpc(self, method, item_id=None, region_id=None):
        self._check_session_ready()
        if (method not in REQUIRED_METHODS or item_id is not None or region_id is not None
                or method not in self.bundle['templates']):
            raise CollectorError('malformed', 'unsupported_rpc')
        if self._audit['rpc_count'] >= MAX_RPCS:
            raise CollectorError('budget_exhausted')
        if time.monotonic() >= self.deadline:
            raise CollectorError('budget_exhausted')
        if self._audit['rpc_count']:
            remaining = self.deadline - time.monotonic()
            if remaining <= 0:
                raise CollectorError('budget_exhausted')
            time.sleep(min(random.uniform(1, 3), remaining))
            if time.monotonic() >= self.deadline:
                raise CollectorError('budget_exhausted')
        if self.before_rpc is not None:
            self.before_rpc()
        self.account_lease.before_rpc()
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise CollectorError('budget_exhausted')
        self.timeout = min(self.timeout, remaining)
        self._audit.update(last_rpc_method=method,
                           stage='statistics' if method == HOTSPOT_METHOD else 'authentication')
        self._audit['rpc_count'] += 1
        result = self._raw_rpc(method, None)
        stop = _structured_stop(result)
        if stop: raise CollectorError(stop)
        # Auth has its own observed result shapes. A successful statistics
        # response must have the captured outer transport boundary, even when
        # the list is empty; accepting bare [] could erase a good snapshot.
        if method == HOTSPOT_METHOD and (not isinstance(result, msgpack.ExtType) or result.code != 10):
            raise CollectorError('malformed')
        if isinstance(result, msgpack.ExtType) and result.code == 10:
            result = market._unpack(result.data)
        return result


def collect_once(bundle, *, session=None, timeout=10, session_index=0, pool_size=1, audit=None):
    """Exactly four captured auth calls and one full-statistics request, no retry."""
    session = session or HotspotSession(bundle, timeout=timeout, session_index=session_index, pool_size=pool_size)
    failure = None
    try:
        session.__enter__()
        return decode_statistics(session._rpc(HOTSPOT_METHOD))
    except AnomalyProtocolError:
        failure = CollectorError('malformed')
        session._latch_failure(failure)
        raise failure from None
    except CollectorError as error:
        failure = error
        raise
    except CoordinationError as error:
        failure = CollectorError(error.code)
        raise failure from None
    except Exception as error:
        failure = _transport_error(error)
        session._latch_failure(failure)
        raise failure from None
    finally:
        try:
            session.__exit__(None, None, None)
        finally:
            if isinstance(audit, dict):
                value = {**session._audit}
                if failure is not None: value['reason'] = failure.reason
                audit.clear()
                audit.update(safe_audit(value))
