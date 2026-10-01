"""Bounded latest-first collection; sparse ID search is never full coverage.

The frontier search inherits bootstrap's explicitly unverified contiguous-prefix
assumption. Inclusive pending ranges, not a jumped cursor, preserve older work.
All state/report/event changes occur under DiscoveryRunner's existing lease.
"""
from copy import deepcopy

from django.db import transaction
from django.utils import timezone

from .discovery import (DiscoveryRunner, ProbeOutcome, ProbeStatus, _safe_error_code,
                        _time_value, record_diagnostics)
from .collector_transport import CollectorError
from .models import ProbeEvent
from .services import disposition_for, persist_report


MAX_ID = 2**63 - 1


def _id(value):
    return type(value) is int and 1 <= value <= MAX_ID


def _merge(ranges):
    result = []
    for lower, upper in sorted(ranges):
        if result and lower <= result[-1][1] + 1:
            result[-1][1] = max(upper, result[-1][1])
        else:
            result.append([lower, upper])
    # Conservatively requeue the smallest scanned gaps when metadata grows.
    # This may duplicate work, but never drops unresolved history.
    while len(result) > 64:
        index = min(range(len(result) - 1), key=lambda i: result[i + 1][0] - result[i][1])
        result[index:index + 2] = [[result[index][0], result[index + 1][1]]]
    return result


def _remove(ranges, kill_id):
    result = []
    for lower, upper in ranges:
        if lower <= kill_id <= upper:
            if lower < kill_id:
                result.append([lower, kill_id - 1])
            if kill_id < upper:
                result.append([kill_id + 1, upper])
        else:
            result.append([lower, upper])
    return result


def _validated_state(cursor, start_id):
    if not cursor.strategy_state:
        seed = cursor.last_success_id
        history = cursor.next_probe_id or (seed + 1 if _id(seed) else start_id)
        if not _id(history):
            raise ValueError('missing_start_id')
        # A configured start is a collection position, not proof of existence.
        if not _id(seed):
            raise ValueError('missing_known_report')
        if history > seed + 1:
            raise ValueError('invalid_strategy_state')
        return {'version': 1, 'phase': 'locate', 'frontier': seed,
                'history_start': history, 'search': {'lower': seed, 'upper': None, 'step': 1},
                'pending_ranges': _merge([[history, seed]]) if history <= seed else [],
                'coverage_verified': False}
    value = deepcopy(cursor.strategy_state)
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('invalid_strategy_state')
    if value.get('phase') not in ('locate', 'scan') or value.get('coverage_verified') is not False:
        raise ValueError('invalid_strategy_state')
    frontier, history = value.get('frontier'), value.get('history_start')
    if not _id(frontier) or not _id(history) or history > frontier + 1:
        raise ValueError('invalid_strategy_state')
    search, ranges = value.get('search'), value.get('pending_ranges')
    if not isinstance(search, dict) or not _id(search.get('lower')):
        raise ValueError('invalid_strategy_state')
    upper, step = search.get('upper'), search.get('step')
    if (not _id(cursor.last_success_id) or not frontier <= search['lower'] <= cursor.last_success_id
            or not _id(step) or (upper is not None and (not _id(upper) or upper <= search['lower']))):
        raise ValueError('invalid_strategy_state')
    if not isinstance(ranges, list) or len(ranges) > 128:
        raise ValueError('invalid_strategy_state')
    for pair in ranges:
        if (not isinstance(pair, list) or len(pair) != 2 or not all(_id(item) for item in pair)
                or not history <= pair[0] <= pair[1] <= frontier):
            raise ValueError('invalid_strategy_state')
    value['pending_ranges'] = _merge(ranges)
    deferred = value.get('deferred_ids', {})
    if (not isinstance(deferred, dict) or len(deferred) > 128
            or any(not str(key).isascii() or not str(key).isdecimal()
                   or not _id(int(key)) or type(at) is not int or at < 0
                   for key, at in deferred.items())):
        raise ValueError('invalid_strategy_state')
    return value


class FreshnessRunner(DiscoveryRunner):
    """One session, one global cooldown, a resumable frontier and history queue."""
    LOCATE_BUDGET = 12
    RECENT_WINDOW = 64

    def _fetch(self, kill_id, *, enrich=None):
        try:
            return super()._fetch(kill_id, enrich=enrich)
        except CollectorError as exc:
            if exc.code != 'malformed':
                raise
            # A classified wire-decode failure is an attempted KM request, not
            # an empty ID. Programmer/cancellation exceptions still propagate.
            return ProbeOutcome(ProbeStatus.MALFORMED, error_code='malformed')

    @transaction.atomic
    def _save_state(self, run, cursor, state):
        self._owned(run, cursor)
        cursor.strategy_state = deepcopy(state)
        ranges = state['pending_ranges']
        # Public historical position only advances over actually scanned IDs.
        cursor.next_probe_id = ranges[0][0] if ranges else state['frontier'] + 1
        cursor.updated_at_ms = int(timezone.now().timestamp() * 1000)
        cursor.save()

    @transaction.atomic
    def _record_fresh(self, run, cursor, state, probe_id, outcome, phase, history=False):
        self._owned(run, cursor)
        run.request_count += 1
        disposition = ''
        if outcome.status is ProbeStatus.REPORT:
            parsed = outcome.payload
            report, created = persist_report(parsed, policy=self.policy,
                                             source='kill_api_latest' if phase == 'locate' else self.source)
            disposition = disposition_for(parsed, self.policy, report, created)
            run.report_count += 1
            if cursor.last_success_id is None or probe_id > cursor.last_success_id:
                cursor.last_success_id = probe_id
                observed_time = _time_value(parsed.get('kill_time_raw'))
                if observed_time is not None:
                    cursor.last_success_kill_time = observed_time
            if phase == 'scan' and not outcome.deferred_stop_code:
                state['pending_ranges'] = _remove(state['pending_ranges'], probe_id)
                state.setdefault('deferred_ids', {}).pop(str(probe_id), None)
            # Success clears an expired pause, not failures accumulated during
            # this run; deferred enrichment still applies its transport stop.
            cursor.pause_reason, cursor.cooldown_until_ms = '', None
        elif outcome.status is ProbeStatus.EMPTY:
            run.empty_count += 1
            if phase == 'scan':
                # A hole inside the assumed prefix is unresolved, not collected.
                deferred = state.setdefault('deferred_ids', {})
                deferred[str(probe_id)] = int(timezone.now().timestamp() * 1000) + 30 * 60 * 1000
                if len(deferred) > 128:
                    # Dropping only a retry delay makes an ID eligible sooner;
                    # its pending range is never removed.
                    del deferred[min(deferred, key=deferred.get)]
        else:
            run.stop_reason = run.error_code = outcome.status.value
            self.pause(cursor, run.stop_reason)
        if outcome.deferred_stop_code:
            run.stop_reason = run.error_code = outcome.deferred_stop_code
            self.pause(cursor, outcome.deferred_stop_code)
        diagnostic = record_diagnostics(run, self.client, disposition,
                                        enrichment_deferred=bool(outcome.deferred_stop_code))
        diagnostic.update({'phase': phase, 'history': history})
        run.diagnostics['strategy'] = 'latest_first'
        run.diagnostics['phase'] = phase
        key = 'locate_count' if phase == 'locate' else 'scan_count'
        run.diagnostics[key] = run.diagnostics.get(key, 0) + 1
        if history:
            run.diagnostics['history_count'] = run.diagnostics.get('history_count', 0) + 1
        self._save_state(run, cursor, state)
        run.save(update_fields=['request_count', 'report_count', 'empty_count',
                                'stop_reason', 'error_code', 'diagnostics'])
        ProbeEvent.objects.create(run=run, kill_id=probe_id, status=outcome.status.value,
                                  error_code=_safe_error_code(outcome.deferred_stop_code or outcome.error_code),
                                  diagnostics=diagnostic, observed_at_ms=cursor.updated_at_ms)

    @transaction.atomic
    def _locate_record(self, run, cursor, state, probe_id, outcome):
        search = state['search']
        if outcome.status is ProbeStatus.REPORT:
            search['lower'] = max(search['lower'], probe_id)
            if search['upper'] is not None and probe_id >= search['upper']:
                search['upper'] = None
                search['step'] = 64
            elif search['upper'] is None:
                search['step'] = min(MAX_ID, max(64, search['step'] * 2))
        elif outcome.status is ProbeStatus.EMPTY:
            search['upper'] = probe_id
        if (outcome.status in (ProbeStatus.REPORT, ProbeStatus.EMPTY)
                and search['upper'] is not None and search['upper'] == search['lower'] + 1):
            candidate = search['lower']
            if candidate > state['frontier']:
                state['pending_ranges'] = _merge(state['pending_ranges'] + [[state['frontier'] + 1, candidate]])
            state['frontier'], state['phase'] = candidate, 'scan'
            state['last_boundary_at_ms'] = int(timezone.now().timestamp() * 1000)
            cursor.candidate_id, cursor.candidate_at_ms = candidate, state['last_boundary_at_ms']
        self._record_fresh(run, cursor, state, probe_id, outcome, 'locate')

    def _run_locked(self, run, cursor):
        self.active_run = run
        run.diagnostics = {'strategy': 'latest_first'}
        paused = self.paused_reason(cursor)
        if paused:
            run.stop_reason = paused
            self._finish(run, cursor)
            return
        try:
            state = _validated_state(cursor, self.config.start_id)
        except ValueError as exc:
            run.stop_reason = str(exc)
            self._finish(run, cursor)
            return
        # Every new round first checks for newer reports; unfinished brackets
        # continue across rounds. Revalidate a previous empty upper because it
        # may now exist, or differ for this round's account.
        if state['phase'] == 'scan':
            state['phase'] = 'locate'
            state['search'] = {'lower': state['frontier'], 'upper': None, 'step': 1}
        revalidate_upper = state['search']['upper']
        self._save_state(run, cursor, state)
        if self.client_factory:
            try:
                self.client = self.client_factory()
            except Exception:
                with transaction.atomic():
                    self._owned(run, cursor)
                    cursor.pause_reason, cursor.cooldown_until_ms = 'configuration_error', None
                    cursor.save(update_fields=['pause_reason', 'cooldown_until_ms'])
                run.stop_reason = 'configuration_error'
                self._finish(run, cursor)
                return
        located, scanned = 0, 0
        while run.request_count < self.config.max_requests and not run.stop_reason:
            phase, history = state['phase'], False
            if phase == 'locate' and located >= self.LOCATE_BUDGET:
                if not state['pending_ranges']:
                    run.stop_reason = 'locate_budget'
                    break
                # Preserve the unfinished bracket while reserving useful work
                # for the existing recent/history queue in this same session.
                phase = 'scan'
            if phase == 'locate':
                search = state['search']
                if revalidate_upper is not None:
                    probe_id, revalidate_upper = revalidate_upper, None
                elif search['upper'] is not None:
                    probe_id = (search['lower'] + search['upper']) // 2
                else:
                    probe_id = min(MAX_ID, search['lower'] + search['step'])
                    if probe_id <= search['lower']:
                        run.stop_reason = 'id_limit'
                        break
            else:
                ranges = state['pending_ranges']
                if not ranges:
                    run.stop_reason = 'caught_up'
                    break
                scanned += 1
                recent_floor = max(state['history_start'], state['frontier'] - self.RECENT_WINDOW + 1)
                history = scanned % 4 == 0 and ranges[0][0] < recent_floor
                deferred = state.get('deferred_ids', {})
                now_ms = int(timezone.now().timestamp() * 1000)
                probe_id = None
                for lower, upper in (ranges if history else reversed(ranges)):
                    candidate = lower if history else upper
                    while lower <= candidate <= upper:
                        if deferred.get(str(candidate), 0) <= now_ms:
                            probe_id = candidate
                            break
                        candidate += 1 if history else -1
                    if probe_id is not None:
                        break
                if probe_id is None:
                    run.stop_reason = 'waiting_visibility'
                    break
            self.heartbeat()
            self.pending_id = probe_id
            outcome = self._fetch(probe_id, enrich=phase != 'locate')
            if phase == 'locate':
                located += 1
                self._locate_record(run, cursor, state, probe_id, outcome)
            else:
                self._record_fresh(run, cursor, state, probe_id, outcome, phase, history)
            self.pending_id = None
        run.stop_reason = run.stop_reason or 'max_requests'
        if run.stop_reason == 'caught_up':
            cursor.failure_count = 0
            cursor.save(update_fields=['failure_count'])
        self._finish(run, cursor)
