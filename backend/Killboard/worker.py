"""Local safety budgets; these are not claims about the game's rate limits."""

import math
import random
import time


class BudgetExhaustedError(Exception):
    code = 'budget_exhausted'


class LeaseLostError(Exception):
    code = 'lease_lost'


def paused_reason(cursor):
    if cursor.pause_reason in ('unauthorized', 'configuration_error', 'service_rejected'):
        return cursor.pause_reason
    if cursor.cooldown_until_ms and cursor.cooldown_until_ms > int(time.time()*1000):
        return 'cooldown'
    return ''


class CollectorPacer:
    def __init__(self, *, interval=5, max_rpcs=36, max_seconds=210,
                 request_margin=10, clock=time.monotonic, sleep=time.sleep,
                 heartbeat=None, jitter=0, random_delay=None):
        if not all(math.isfinite(value) for value in (interval, max_seconds, request_margin, jitter)):
            raise ValueError('collector budgets must be finite')
        if interval < 0 or jitter < 0 or type(max_rpcs) is not int or max_rpcs < 1:
            raise ValueError('invalid collector RPC budget')
        if request_margin < 0 or max_seconds <= request_margin:
            raise ValueError('collector deadline must reserve the request timeout')
        self.interval, self.jitter, self.max_rpcs = interval, jitter, max_rpcs
        self.max_seconds, self.request_margin = max_seconds, request_margin
        self.clock, self.sleep, self.heartbeat = clock, sleep, heartbeat
        self.random_delay = random_delay or (lambda maximum: random.uniform(0, maximum))
        self.started = clock()
        self.last = None
        self.count = 0

    def __call__(self):
        now = self.clock()
        if self.last is None:
            delay = 0
        else:
            elapsed = now - self.last
            delay = max(0, self.interval + self.random_delay(self.jitter) - elapsed)
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
