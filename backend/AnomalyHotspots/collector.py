"""Single bounded read-only statistics pass; requires shared account leasing."""
import time
import random

import msgpack
from GameSessions.coordination import account_lease, CoordinationError
from Killboard.collector_transport import (KillboardSession, CollectorError, _timeout,
                                           _structured_stop, _transport_error, market)
from .session_bundle import validate_session, REQUIRED_METHODS, HOTSPOT_METHOD
from .protocol import decode_statistics, AnomalyProtocolError

MAX_RPCS = 5
MAX_SECONDS = 90


class HotspotSession(KillboardSession):
    """Reuse proven framing/latching, with a distinct strict capability schema."""
    def __init__(self, bundle, timeout=10, *, before_rpc=None):
        self.bundle = validate_session(bundle)
        self.timeout = _timeout(timeout)
        self.sock = self.client_id = self.proxy_id = None
        self.next_seq = self.next_server_seq = 0
        self._ended, self._failure = False, None
        self._audit = {'rpc_count': 0, 'stage': 'connection'}
        self.set_before_rpc(before_rpc)
        self.deadline = time.monotonic() + MAX_SECONDS
        try:
            self.account_lease = account_lease('ANOMALY', 0, 1)
            if self.account_lease is None:
                raise CoordinationError()
        except CoordinationError as error:
            raise CollectorError(error.code) from None

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
            time.sleep(random.uniform(1, 3))
        if self.before_rpc is not None:
            self.before_rpc()
        self.account_lease.before_rpc()
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise CollectorError('budget_exhausted')
        self.timeout = min(self.timeout, remaining)
        self._audit.update(last_rpc_method=method,
                           stage='kill_report' if method == HOTSPOT_METHOD else 'authentication')
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


def collect_once(bundle, *, session=None, timeout=10):
    """Exactly four captured auth calls and one full-statistics request, no retry."""
    session = session or HotspotSession(bundle, timeout=timeout)
    try:
        session.__enter__()
        return decode_statistics(session._rpc(HOTSPOT_METHOD))
    except AnomalyProtocolError:
        failure = CollectorError('malformed')
        session._latch_failure(failure)
        raise failure from None
    except CollectorError:
        raise
    except CoordinationError as error:
        raise CollectorError(error.code) from None
    except Exception as error:
        failure = _transport_error(error)
        session._latch_failure(failure)
        raise failure from None
    finally:
        session.__exit__(None, None, None)
