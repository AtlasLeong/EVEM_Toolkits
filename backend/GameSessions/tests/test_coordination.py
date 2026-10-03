import os
from contextlib import closing
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from GameSessions.coordination import (AccountAuthPaused, AccountBudgetExhausted, AccountBusy,
                                      AccountLeaseLost, AccountRateLimited, CoordinationError,
                                      AccountServicePaused,
                                      Coordinator, LEASE_MS, MAX_ACCOUNT_RPCS, WINDOW_MS,
                                      account_lease, provision)


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'synthetic-coordination.sqlite3'
        provision(self.path)
        self.now = 1000
        self.coordinator = Coordinator(self.path, clock_ms=lambda: self.now, sleep=self.advance)

    def advance(self, seconds):
        self.now += int(seconds * 1000)

    def test_other_process_cannot_claim_same_account(self):
        code = ('from GameSessions.coordination import *; import sys; '
                'c=Coordinator(sys.argv[1],clock_ms=lambda:1000); '
                '\ntry:c.lease("shared-a").__enter__()'
                '\nexcept AccountBusy:sys.exit(0)'
                '\nelse:sys.exit(1)')
        with self.coordinator.lease('shared-a'):
            result = subprocess.run([sys.executable, '-c', code, str(self.path)],
                                    capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        with self.coordinator.lease('shared-a'):
            pass

    def test_sqlite_writer_contention_is_busy_without_waiting(self):
        with self.coordinator.transaction():
            with self.assertRaises(AccountBusy):
                Coordinator(self.path).lease('shared-a').__enter__()

    def test_expired_owner_is_fenced_and_cannot_release_new_lease(self):
        old = self.coordinator.lease('shared-a')
        old.__enter__()
        self.now += LEASE_MS + 1
        new = self.coordinator.lease('shared-a')
        new.__enter__()
        with self.assertRaises(AccountLeaseLost):
            old.before_rpc()
        old.__exit__()
        with self.assertRaises(AccountBusy):
            self.coordinator.lease('shared-a').__enter__()
        new.__exit__()

    def test_request_budget_and_spacing_survive_reopen_and_collector_change(self):
        with self.coordinator.lease('shared-a') as market:
            for _ in range(20):
                market.before_rpc()
        reopened = Coordinator(self.path, clock_ms=lambda: self.now, sleep=self.advance)
        with reopened.lease('shared-a') as km:
            for _ in range(MAX_ACCOUNT_RPCS - 20):
                km.before_rpc()
            with self.assertRaises(AccountBudgetExhausted):
                km.before_rpc()
        self.assertGreaterEqual(self.now, (MAX_ACCOUNT_RPCS - 1) * 1000)
        self.now += WINDOW_MS
        with reopened.lease('shared-a') as km:
            km.before_rpc()

    def test_rate_rejection_blocks_every_mapped_account_and_persists(self):
        with self.coordinator.lease('shared-a') as lease:
            until = lease.pause_rate()
        self.assertEqual(until, self.now + 15 * 60000)
        with self.assertRaises(AccountRateLimited):
            Coordinator(self.path, clock_ms=lambda: self.now).lease('different-b').__enter__()
        self.now = until
        with self.coordinator.lease('shared-a') as lease:
            second_until = lease.pause_rate()
        self.assertEqual(second_until, self.now + 30 * 60000)

    def test_auth_rejection_requires_explicit_recovery_and_does_not_age_out(self):
        with self.coordinator.lease('shared-a') as lease:
            lease.pause_auth()
        self.now += 24 * 60 * 60000
        with self.assertRaises(AccountAuthPaused):
            self.coordinator.lease('shared-a').__enter__()
        self.coordinator.resume('shared-a')
        with self.coordinator.lease('shared-a'):
            with self.assertRaises(AccountBusy):
                self.coordinator.resume('shared-a')

    def test_service_refusal_survives_restart_and_auth_resume_does_not_clear_it(self):
        with self.coordinator.lease('shared-a') as lease:
            lease.pause_service()
            with self.assertRaises(AccountServicePaused):
                lease.before_rpc()
        self.now += 24 * 60 * 60000
        self.coordinator.resume('shared-a')  # authentication replacement acknowledgement only
        with self.assertRaises(AccountServicePaused):
            Coordinator(self.path, clock_ms=lambda: self.now).lease('shared-a').__enter__()
        self.coordinator.resume('shared-a', auth=False, service=True)
        with self.coordinator.lease('shared-a'):
            pass

    def test_older_coordination_schema_is_refused_without_adoption(self):
        with closing(sqlite3.connect(self.path)) as db:
            db.execute('PRAGMA user_version=1')
        before = self.path.read_bytes()
        with self.assertRaises(CoordinationError):
            self.coordinator.lease('shared-a').__enter__()
        self.assertEqual(self.path.read_bytes(), before)

    def test_offline_cli_requires_separate_service_and_auth_acknowledgements(self):
        with self.coordinator.lease('shared-a') as lease:
            lease.pause_auth()
            lease.pause_service()
        command = [sys.executable, '-m', 'GameSessions', 'resume', '--state-file', str(self.path),
                   '--account-id', 'shared-a']
        refused = subprocess.run(command, capture_output=True, timeout=15)
        self.assertEqual(refused.returncode, 1)
        service = subprocess.run(command + ['--confirm-resolved-service-restriction'],
                                 capture_output=True, timeout=15)
        self.assertEqual(service.returncode, 0)
        with self.assertRaises(AccountAuthPaused):
            self.coordinator.lease('shared-a').__enter__()
        auth = subprocess.run(command + ['--confirm-authorized-session-replacement'],
                              capture_output=True, timeout=15)
        self.assertEqual(auth.returncode, 0)
        with self.coordinator.lease('shared-a'):
            pass

    def test_partial_ambiguous_duplicate_or_secret_like_mapping_fails_closed(self):
        for env in (
            {'GAME_SESSION_COORDINATOR_FILE': str(self.path)},
            {'MARKET_SESSION_ACCOUNT_IDS': '["shared-a"]'},
            {'GAME_SESSION_COORDINATOR_FILE': str(self.path), 'MARKET_SESSION_ACCOUNT_IDS': '["a","a"]'},
            {'GAME_SESSION_COORDINATOR_FILE': str(self.path), 'MARKET_SESSION_ACCOUNT_IDS': '["' + 'x' * 64 + '"]'},
        ):
            with self.subTest(env=tuple(env)), patch.dict(os.environ, env, clear=True):
                with self.assertRaises(CoordinationError) as caught:
                    account_lease('MARKET', 0, 1)
                self.assertNotIn(str(self.path), str(caught.exception))
        with patch.dict(os.environ, {}, clear=True):
            self.assertIsNone(account_lease('MARKET', 0, 1))

    def test_unrelated_database_is_not_modified_or_adopted(self):
        other = Path(self.temp.name) / 'unrelated.sqlite3'
        with closing(sqlite3.connect(other)) as db:
            db.execute('CREATE TABLE unrelated(value TEXT)')
        before = other.read_bytes()
        with self.assertRaises(CoordinationError):
            Coordinator(other).lease('shared-a').__enter__()
        self.assertEqual(other.read_bytes(), before)
        with self.assertRaises(FileExistsError):
            provision(self.path)

    def test_state_never_contains_captured_material(self):
        with self.coordinator.lease('shared-a') as lease:
            lease.before_rpc()
            lease.pause_auth()
        with closing(sqlite3.connect(self.path)) as db:
            columns = [row[1] for row in db.execute('PRAGMA table_info(accounts)')]
        self.assertEqual(set(columns), {'account_ref', 'owner', 'expires_ms', 'next_rpc_ms',
                                        'window_ms', 'rpc_count', 'auth_paused', 'service_paused'})
