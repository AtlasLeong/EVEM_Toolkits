"""Optional single-host account leases; never discover identities from credentials.

Operators explicitly map both collectors to non-secret account references. The
pre-provisioned SQLite file contains only leases, counts and rejection state.
It must be on local storage: this is not a distributed lock for multiple hosts.
"""
from contextlib import contextmanager
import json
import os
from pathlib import Path
import re
import sqlite3
import stat
import time
import uuid


APPLICATION_ID = 0x45564D53
STATE_VERSION = 2
LEASE_MS = 12 * 60 * 1000
WINDOW_MS = 5 * 60 * 1000
# Local conservative bounds, NOT an official game quota. Four auth RPCs plus
# the existing maximum forty Market items; KM's existing 36-RPC cap still applies.
MAX_ACCOUNT_RPCS = 44
RPC_INTERVAL_MS = 1000


class CoordinationError(Exception):
    code = 'configuration_error'

    def __init__(self):
        super().__init__('Game session coordination is unavailable.')


class AccountBusy(CoordinationError):
    code = 'account_busy'


class AccountLeaseLost(CoordinationError):
    code = 'lease_lost'


class AccountAuthPaused(CoordinationError):
    code = 'unauthorized'


class AccountServicePaused(CoordinationError):
    code = 'service_rejected'


class AccountRateLimited(CoordinationError):
    code = 'rate_limited'

    def __init__(self, retry_at_ms=None):
        super().__init__()
        self.retry_at_ms = retry_at_ms


class AccountBudgetExhausted(CoordinationError):
    code = 'budget_exhausted'


def _account_ref(value):
    if not isinstance(value, str) or re.fullmatch(r'[a-z][a-z0-9_-]{0,31}', value) is None:
        raise CoordinationError()
    return value


def _path(value):
    if not isinstance(value, (str, Path)) or not str(value).strip():
        raise CoordinationError()
    path = Path(value)
    if not path.is_absolute() or path.suffix != '.sqlite3':
        raise CoordinationError()
    for component in (path, *path.parents):
        if component.is_symlink():
            raise CoordinationError()
        try:
            info = component.lstat()
        except FileNotFoundError:
            continue
        if getattr(info, 'st_file_attributes', 0) & getattr(stat, 'FILE_ATTRIBUTE_REPARSE_POINT', 0x400):
            raise CoordinationError()
    return path


def provision(path):
    """Explicitly create NEW non-secret state; never replace an existing file."""
    path = _path(path)
    descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    connection = sqlite3.connect(path)
    try:
        connection.executescript(f'''
            PRAGMA application_id={APPLICATION_ID};
            PRAGMA user_version={STATE_VERSION};
            CREATE TABLE accounts (
                account_ref TEXT PRIMARY KEY,
                owner TEXT NOT NULL DEFAULT '', expires_ms INTEGER NOT NULL DEFAULT 0,
                next_rpc_ms INTEGER NOT NULL DEFAULT 0,
                window_ms INTEGER NOT NULL DEFAULT 0, rpc_count INTEGER NOT NULL DEFAULT 0,
                auth_paused INTEGER NOT NULL DEFAULT 0,
                service_paused INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE policy (
                id INTEGER PRIMARY KEY CHECK(id=1), cooldown_ms INTEGER NOT NULL DEFAULT 0,
                rate_failures INTEGER NOT NULL DEFAULT 0
            );
            INSERT INTO policy(id) VALUES(1);
        ''')
    finally:
        connection.close()


class Coordinator:
    def __init__(self, path, *, clock_ms=None, sleep=time.sleep):
        self.path = _path(path)
        self.clock_ms = clock_ms or (lambda: int(time.time() * 1000))
        self.sleep = sleep

    @contextmanager
    def transaction(self):
        connection = None
        try:
            before = self.path.lstat()
            if not stat.S_ISREG(before.st_mode) or before.st_size > 1024 * 1024:
                raise CoordinationError()
            if os.name == 'posix' and (before.st_mode & 0o007 or self.path.parent.stat().st_mode & 0o002):
                raise CoordinationError()
            connection = sqlite3.connect(self.path.as_uri() + '?mode=rw', uri=True, timeout=0)
            after = self.path.lstat()
            if (before.st_dev, before.st_ino) != (after.st_dev, after.st_ino):
                raise CoordinationError()
            connection.row_factory = sqlite3.Row
            if (connection.execute('PRAGMA application_id').fetchone()[0] != APPLICATION_ID
                    or connection.execute('PRAGMA user_version').fetchone()[0] != STATE_VERSION):
                raise CoordinationError()
            connection.execute('BEGIN IMMEDIATE')
            yield connection
            connection.commit()
        except sqlite3.OperationalError as exc:
            if (getattr(exc, 'sqlite_errorcode', None) in (5, 6)
                    or str(exc) in ('database is locked', 'database table is locked')):
                raise AccountBusy() from None
            raise CoordinationError() from None
        except (OSError, sqlite3.Error, ValueError):
            raise CoordinationError() from None
        finally:
            if connection is not None:
                connection.close()

    def lease(self, account_ref):
        return AccountLease(self, _account_ref(account_ref))

    def resume(self, account_ref, *, auth=True, service=False):
        """Operator acknowledgement only; performs no game login or token refresh."""
        account_ref = _account_ref(account_ref)
        with self.transaction() as db:
            row = db.execute('SELECT * FROM accounts WHERE account_ref=?', (account_ref,)).fetchone()
            if row and row['owner'] and row['expires_ms'] > self.clock_ms():
                raise AccountBusy()
            if auth:
                db.execute('UPDATE accounts SET auth_paused=0 WHERE account_ref=?', (account_ref,))
            if service:
                db.execute('UPDATE accounts SET service_paused=0 WHERE account_ref=?', (account_ref,))


class AccountLease:
    def __init__(self, coordinator, account_ref):
        self.coordinator, self.account_ref = coordinator, account_ref
        self.owner = uuid.uuid4().hex
        self.acquired = False

    def _owned(self, db, now):
        row = db.execute('SELECT * FROM accounts WHERE account_ref=?', (self.account_ref,)).fetchone()
        if not row or row['owner'] != self.owner or row['expires_ms'] <= now:
            raise AccountLeaseLost()
        return row

    def __enter__(self):
        if self.acquired:
            raise AccountBusy()
        now = self.coordinator.clock_ms()
        with self.coordinator.transaction() as db:
            policy = db.execute('SELECT * FROM policy WHERE id=1').fetchone()
            if policy['cooldown_ms'] > now:
                raise AccountRateLimited(policy['cooldown_ms'])
            db.execute('INSERT OR IGNORE INTO accounts(account_ref) VALUES(?)', (self.account_ref,))
            row = db.execute('SELECT * FROM accounts WHERE account_ref=?', (self.account_ref,)).fetchone()
            if row['auth_paused']:
                raise AccountAuthPaused()
            if row['service_paused']:
                raise AccountServicePaused()
            if row['owner'] and row['expires_ms'] > now:
                raise AccountBusy()
            db.execute('UPDATE accounts SET owner=?, expires_ms=? WHERE account_ref=?',
                       (self.owner, now + LEASE_MS, self.account_ref))
        self.acquired = True
        return self

    def __exit__(self, *_exc):
        if self.acquired:
            try:
                with self.coordinator.transaction() as db:
                    db.execute('UPDATE accounts SET owner=\'\', expires_ms=0 WHERE account_ref=? AND owner=?',
                               (self.account_ref, self.owner))
            except CoordinationError:
                # Preserve the rejection that stopped the run. A failed release
                # leaves the persisted lease until expiry, which fails closed.
                if not _exc or _exc[0] is None:
                    raise
            finally:
                self.acquired = False

    def before_rpc(self):
        while True:
            now = self.coordinator.clock_ms()
            with self.coordinator.transaction() as db:
                row = self._owned(db, now)
                policy = db.execute('SELECT * FROM policy WHERE id=1').fetchone()
                if policy['cooldown_ms'] > now:
                    raise AccountRateLimited(policy['cooldown_ms'])
                if row['auth_paused']:
                    raise AccountAuthPaused()
                if row['service_paused']:
                    raise AccountServicePaused()
                delay = max(0, row['next_rpc_ms'] - now)
                if not delay:
                    window, count = row['window_ms'], row['rpc_count']
                    if now >= window + WINDOW_MS:
                        window, count = now, 0
                    if count >= MAX_ACCOUNT_RPCS:
                        raise AccountBudgetExhausted()
                    db.execute('UPDATE accounts SET window_ms=?, rpc_count=?, next_rpc_ms=?, expires_ms=? '
                               'WHERE account_ref=? AND owner=?',
                               (window, count + 1, now + RPC_INTERVAL_MS, now + LEASE_MS,
                                self.account_ref, self.owner))
                    return
            self.coordinator.sleep(delay / 1000)

    def pause_auth(self):
        with self.coordinator.transaction() as db:
            self._owned(db, self.coordinator.clock_ms())
            db.execute('UPDATE accounts SET auth_paused=1 WHERE account_ref=?', (self.account_ref,))

    def pause_service(self):
        with self.coordinator.transaction() as db:
            self._owned(db, self.coordinator.clock_ms())
            db.execute('UPDATE accounts SET service_paused=1 WHERE account_ref=?', (self.account_ref,))

    def pause_rate(self):
        now = self.coordinator.clock_ms()
        with self.coordinator.transaction() as db:
            self._owned(db, now)
            policy = db.execute('SELECT * FROM policy WHERE id=1').fetchone()
            failures = policy['rate_failures'] + 1
            cooldown = max(policy['cooldown_ms'], now + min(60, 15 * 2 ** min(failures - 1, 2)) * 60000)
            db.execute('UPDATE policy SET cooldown_ms=?, rate_failures=? WHERE id=1', (cooldown, failures))
            return cooldown

    def complete(self):
        with self.coordinator.transaction() as db:
            now = self.coordinator.clock_ms()
            self._owned(db, now)
            db.execute('UPDATE policy SET rate_failures=0 WHERE id=1 AND cooldown_ms<=?', (now,))


def account_lease(prefix, index, pool_size):
    """Explicit mapping or disabled; partial configuration fails closed."""
    path = os.environ.get('GAME_SESSION_COORDINATOR_FILE', '')
    encoded = os.environ.get(prefix + '_SESSION_ACCOUNT_IDS', '')
    if not path and not encoded:
        return None
    if not path or not encoded:
        raise CoordinationError()
    try:
        refs = json.loads(encoded)
        if (not isinstance(refs, list) or len(refs) != pool_size
                or type(index) is not int or not 0 <= index < pool_size):
            raise CoordinationError()
        refs = [_account_ref(ref) for ref in refs]
        if len(set(refs)) != len(refs):
            raise CoordinationError()
    except (ValueError, TypeError):
        raise CoordinationError() from None
    return Coordinator(path).lease(refs[index])
