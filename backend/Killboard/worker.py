"""Local safety budgets; these are not claims about the game's rate limits."""

import math
import time


class BudgetExhaustedError(Exception):
    code = 'budget_exhausted'


class LeaseLostError(Exception):
    code = 'lease_lost'


def paused_reason(cursor):
    if cursor.pause_reason in ('unauthorized', 'configuration_error'):
        return cursor.pause_reason
    if cursor.cooldown_until_ms and cursor.cooldown_until_ms > int(time.time()*1000):
        return 'cooldown'
    return ''


class CollectorPacer:
    def __init__(self, *, interval=5, max_rpcs=36, max_seconds=210,
                 request_margin=10, clock=time.monotonic, sleep=time.sleep,
                 heartbeat=None):
        if not all(math.isfinite(value) for value in (interval, max_seconds, request_margin)):
            raise ValueError('collector budgets must be finite')
        if interval < 0 or type(max_rpcs) is not int or max_rpcs < 1:
            raise ValueError('invalid collector RPC budget')
        if request_margin < 0 or max_seconds <= request_margin:
            raise ValueError('collector deadline must reserve the request timeout')
        self.interval, self.max_rpcs = interval, max_rpcs
        self.max_seconds, self.request_margin = max_seconds, request_margin
        self.clock, self.sleep, self.heartbeat = clock, sleep, heartbeat
        self.started = clock()
        self.last = None
        self.count = 0

    def __call__(self):
        now = self.clock()
        delay = max(0, self.interval - (now - self.last)) if self.last is not None else 0
        if self.count >= self.max_rpcs or now + delay + self.request_margin > self.started + self.max_seconds:
            raise BudgetExhaustedError()
        if delay:
            self.sleep(delay)
        if self.heartbeat:
            self.heartbeat()
        self.last = self.clock()
        if self.last + self.request_margin > self.started + self.max_seconds:
            raise BudgetExhaustedError()
        self.count += 1
