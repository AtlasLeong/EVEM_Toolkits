"""Recovery is one natural-run probe, with no extra game calls in these tests."""

from unittest.mock import patch

from django.test import TestCase

from Market.batch_policy import FALLBACK_DURATION_MS
from Market.collector_protocol import (
    NetworkError, ProtocolTimeout, RateLimitedError, ServiceRejectedError,
)
from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot
from Market.session_bundle import NeedsAuthError
from Market.tests.test_capacity import SyntheticLease, TimedSession, VirtualClock


class MarketBatchRecoveryTests(TestCase):
    def setUp(self):
        self.config = MarketConfig.objects.create(
            next_due_at_ms=1000, session_status='ready', updated_at_ms=1000,
            batch_fallback_until_ms=1000 + FALLBACK_DURATION_MS,
            batch_fallback_reason='network_error',
        )
        MarketItem.objects.bulk_create([
            MarketItem(id=item_id, name=f'Recovery item {item_id}', scope='global')
            for item_id in range(1, 150)
        ])

    def arm_recovery(self, count=3, **overrides):
        values = {
            'enabled': True,
            'max_items_per_run': 80,
            'next_due_at_ms': 1000,
            'session_status': 'ready',
            'cooldown_until_ms': None,
            'updated_at_ms': 1000,
            'batch_fallback_until_ms': 1000 + FALLBACK_DURATION_MS,
            'batch_fallback_reason': 'network_error',
            'capacity_failure_count': 0,
            'batch_recovery_success_count': count,
            'batch_recovery_probe_attempted': False,
            'batch_recovery_success_at_ms': 1000 if count else None,
        }
        values.update(overrides)
        MarketConfig.objects.filter(pk=1).update(**values)

    def collect(self, *, now_ms=None, entry_error=None, on_quote=None,
                quote_seconds=0.25, shared=False, bundle_loader=None,
                longest_interval=False):
        from Market.worker import collect_due

        # A new clock/session/config read models a fresh short-lived worker.
        config = MarketConfig.objects.get(pk=1)
        clock = VirtualClock(
            config.next_due_at_ms if now_ms is None else now_ms,
            delay_ms=2000, longest_interval=longest_interval,
        )
        session = TimedSession(
            clock, quote_seconds=quote_seconds, entry_error=entry_error,
            on_quote=on_quote,
        )
        lease = SyntheticLease(clock) if shared else None
        with patch('socket.create_connection', side_effect=AssertionError('No real network in recovery tests')):
            run = collect_due(
                clock_ms=clock.clock_ms, monotonic=clock.monotonic,
                bundle_loader=bundle_loader or (lambda: {'synthetic': True}),
                session_factory=lambda _bundle: session,
                lease_factory=lambda *_args: lease,
                randint=clock.randint, sleep=clock.sleep,
            )
        if run is not None:
            run.refresh_from_db()
        return run, clock, session, lease

    def assert_full_plan(self, run, count):
        self.assertEqual(
            (run.status, run.success_count, run.failure_count, run.item_limit, run.expected_count),
            ('succeeded', count, 0, count, count),
        )
        self.assertEqual(PriceSnapshot.objects.filter(run=run).count(), count)

    def test_three_complete_scheduled_forties_persist_and_only_next_natural_run_probes(self):
        fallback_until = self.config.batch_fallback_until_ms
        self.assertIsNone(self.config.batch_recovery_success_count)
        self.assertIsNone(self.config.batch_recovery_probe_attempted)
        self.assertIsNone(self.config.batch_recovery_success_at_ms)
        self.config.session_status = 'error'
        self.config.save(update_fields=['session_status'])

        for expected_streak in range(1, 4):
            run, clock, session, _lease = self.collect()
            self.assert_full_plan(run, 40)
            self.assertFalse(run.batch_recovery_probe)
            config = MarketConfig.objects.get(pk=1)
            self.assertEqual(config.batch_recovery_success_count, expected_streak)
            self.assertEqual(config.batch_recovery_success_at_ms, run.finished_at_ms)
            self.assertEqual(config.updated_at_ms, run.finished_at_ms)
            self.assertEqual(config.batch_fallback_until_ms, fallback_until)
            self.assertEqual(config.next_due_at_ms, run.finished_at_ms + 2100 * 1000)
            self.assertEqual(len(session.queries), 40)
            self.assertEqual(len(clock.sleeps), 39)

        state_at_first_io = []

        def inspect_before_loading_session():
            config = MarketConfig.objects.get(pk=1)
            running = CollectionRun.objects.get(status='running')
            state_at_first_io.append((
                config.batch_recovery_probe_attempted,
                config.batch_recovery_success_count,
                running.batch_recovery_probe,
                running.item_limit,
                running.expected_count,
            ))
            return {'synthetic': True}

        run, clock, session, _lease = self.collect(
            bundle_loader=inspect_before_loading_session, longest_interval=True,
        )

        self.assertEqual(state_at_first_io, [(True, 0, True, 80, 80)])
        self.assert_full_plan(run, 80)
        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual(len(session.queries), 80)
        self.assertEqual(session.max_active_queries, 1)
        self.assertEqual(session.auth_rpcs, 4)
        self.assertEqual(len(clock.sleeps), 79)
        self.assertTrue(all(2 <= delay[1] <= 3 for delay in clock.sleeps))
        self.assertLess(clock.elapsed, 480)
        config = MarketConfig.objects.get(pk=1)
        self.assertIsNone(config.batch_fallback_until_ms)
        self.assertEqual(config.batch_fallback_reason, '')
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertIsNone(config.batch_recovery_success_at_ms)
        self.assertEqual(config.next_due_at_ms, run.finished_at_ms + 3060 * 1000)

    def test_failed_probe_returns_to_forty_without_repeated_probes_after_healthy_runs(self):
        self.arm_recovery()
        failed, _clock, session, _lease = self.collect(entry_error=NetworkError('synthetic'))

        self.assertEqual((failed.item_limit, failed.expected_count), (80, 80))
        self.assertEqual((failed.status, failed.success_count), ('failed', 0))
        self.assertTrue(failed.batch_recovery_probe)
        self.assertEqual(session.queries, [])
        protected_until = failed.finished_at_ms + FALLBACK_DURATION_MS
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_fallback_until_ms, protected_until)

        for _ in range(4):
            run, _clock, _session, _lease = self.collect()
            self.assert_full_plan(run, 40)
            self.assertFalse(run.batch_recovery_probe)
            config = MarketConfig.objects.get(pk=1)
            self.assertTrue(config.batch_recovery_probe_attempted)
            self.assertEqual(config.batch_recovery_success_count, 0)
            self.assertEqual(config.batch_fallback_until_ms, protected_until)

        self.assertEqual(CollectionRun.objects.filter(batch_recovery_probe=True).count(), 1)

    def test_partial_network_probe_keeps_successful_quotes_and_latches_forty_immediately(self):
        self.arm_recovery()

        def fail_fourth_query(_item_id, index):
            if index == 4:
                raise ProtocolTimeout('synthetic')

        run, _clock, session, _lease = self.collect(on_quote=fail_fourth_query)

        self.assertEqual((run.status, run.success_count, run.failure_count), ('partial', 3, 1))
        self.assertEqual((run.item_limit, run.expected_count, run.error_code), (80, 80, 'timeout'))
        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual(len(session.queries), 4)
        self.assertEqual(PriceSnapshot.objects.filter(run=run).count(), 3)
        self.assertEqual(LatestPrice.objects.count(), 3)
        self.assertEqual(MarketItem.objects.filter(last_attempt_at_ms__isnull=False).count(), 4)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.capacity_failure_count, 1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)
        self.assertEqual(config.batch_fallback_reason, 'timeout')

    def test_successful_underfilled_probe_does_not_claim_eighty_item_recovery(self):
        self.arm_recovery()
        MarketItem.objects.filter(id__gt=70).update(enabled=False)

        run, _clock, session, _lease = self.collect()

        self.assertEqual((run.status, run.success_count, run.failure_count), ('succeeded', 70, 0))
        self.assertEqual((run.item_limit, run.expected_count), (80, 70))
        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual(len(session.queries), 70)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)

    def test_manual_run_cannot_spend_or_extend_earned_scheduled_credit(self):
        self.arm_recovery(enabled=False, next_due_at_ms=999999999)
        queued = CollectionRun.objects.create(trigger='manual', status='queued')

        run, _clock, _session, _lease = self.collect(now_ms=1000)

        self.assertEqual(run.pk, queued.pk)
        self.assertEqual(run.trigger, 'manual')
        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertIsNone(config.batch_recovery_success_at_ms)

    def test_partial_forty_interrupts_streak_and_next_full_forty_starts_from_one(self):
        self.arm_recovery(count=2)

        def invalid_first_quote(_item_id, index):
            if index == 1:
                raise ValueError('synthetic')

        partial, _clock, _session, _lease = self.collect(on_quote=invalid_first_quote)
        self.assertEqual((partial.status, partial.success_count, partial.failure_count), ('partial', 39, 1))
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertIsNone(config.batch_recovery_success_at_ms)

        full, _clock, _session, _lease = self.collect()

        self.assert_full_plan(full, 40)
        self.assertFalse(full.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 1)
        self.assertFalse(config.batch_recovery_probe_attempted)

    def test_underfilled_successful_forty_interrupts_streak(self):
        self.arm_recovery(count=2)
        MarketItem.objects.filter(id__gt=39).update(enabled=False)

        run, _clock, _session, _lease = self.collect()

        self.assertEqual((run.status, run.success_count, run.expected_count), ('succeeded', 39, 39))
        self.assertEqual(run.item_limit, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertIsNone(config.batch_recovery_success_at_ms)

    def test_old_writer_or_configuration_edit_invalidates_timestamp_anchored_credit(self):
        self.arm_recovery()
        # An old release updates this existing field but knows no recovery fields.
        MarketConfig.objects.filter(pk=1).update(updated_at_ms=1001)

        run, _clock, _session, _lease = self.collect()

        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 1)
        self.assertEqual(config.batch_recovery_success_at_ms, run.finished_at_ms)

    def test_other_protective_reasons_never_earn_or_spend_probe_credit(self):
        for reason in ('shared_budget', 'runtime_budget', 'budget_exhausted', 'lease_expired',
                       'rate_limited', 'service_rejected', 'needs_auth'):
            with self.subTest(reason=reason):
                self.arm_recovery(batch_fallback_reason=reason)
                run, _clock, _session, _lease = self.collect()
                self.assert_full_plan(run, 40)
                self.assertFalse(run.batch_recovery_probe)
                config = MarketConfig.objects.get(pk=1)
                self.assertFalse(config.batch_recovery_probe_attempted)
                self.assertEqual(config.batch_recovery_success_count, 0)
                self.assertEqual(config.batch_fallback_reason, reason)

    def test_timeout_fallback_can_earn_the_same_scheduled_recovery_credit(self):
        self.arm_recovery(count=2, batch_fallback_reason='timeout')
        run, _clock, _session, _lease = self.collect()
        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 3)
        self.assertEqual(config.batch_recovery_success_at_ms, run.finished_at_ms)

    def test_operator_forty_cap_is_never_overridden_by_recovery_credit(self):
        self.arm_recovery(max_items_per_run=40)

        run, _clock, _session, _lease = self.collect()

        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.max_items_per_run, 40)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)

    def test_not_due_does_not_consume_probe_or_open_session(self):
        self.arm_recovery(next_due_at_ms=2000)
        run, _clock, session, _lease = self.collect(now_ms=1999)

        self.assertIsNone(run)
        self.assertFalse(session.entered)
        self.assertEqual(session.queries, [])
        self.assertFalse(CollectionRun.objects.exists())
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 3)
        self.assertFalse(config.batch_recovery_probe_attempted)

    def test_active_rate_cooldown_blocks_queued_manual_and_natural_probe(self):
        self.arm_recovery(cooldown_until_ms=2000)
        queued = CollectionRun.objects.create(trigger='manual')

        run, _clock, session, _lease = self.collect(now_ms=1000)

        self.assertIsNone(run)
        self.assertFalse(session.entered)
        queued.refresh_from_db()
        self.assertEqual(queued.status, 'queued')
        config = MarketConfig.objects.get(pk=1)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.cooldown_until_ms, 2000)

    def test_auth_and_service_blocked_schedule_cannot_probe(self):
        for status in ('needs_auth', 'blocked'):
            with self.subTest(status=status):
                self.arm_recovery(session_status=status)
                run, _clock, session, _lease = self.collect()
                self.assertIsNone(run)
                self.assertFalse(session.entered)
                config = MarketConfig.objects.get(pk=1)
                self.assertFalse(config.batch_recovery_probe_attempted)

    def test_auth_rate_and_service_probe_failures_preserve_their_protections(self):
        cases = (
            (NeedsAuthError('synthetic'), 'needs_auth', 'needs_auth'),
            (RateLimitedError('synthetic'), 'rate_limited', 'cooldown'),
            (ServiceRejectedError('synthetic'), 'failed', 'blocked'),
        )
        for error, status, config_status in cases:
            with self.subTest(error=error.code):
                self.arm_recovery()
                run, _clock, session, _lease = self.collect(entry_error=error)
                self.assertTrue(run.batch_recovery_probe)
                self.assertEqual(run.status, status)
                self.assertEqual(session.queries, [])
                config = MarketConfig.objects.get(pk=1)
                self.assertEqual(config.session_status, config_status)
                self.assertTrue(config.batch_recovery_probe_attempted)
                self.assertEqual(config.batch_recovery_success_count, 0)
                self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)
                if config_status == 'cooldown':
                    self.assertGreater(config.cooldown_until_ms, run.finished_at_ms)
                    self.assertGreaterEqual(config.next_due_at_ms, config.cooldown_until_ms)
                else:
                    self.assertIsNone(config.next_due_at_ms)

    def test_soft_budget_still_stops_probe_before_eighty_and_consumes_only_one_attempt(self):
        self.arm_recovery()

        run, clock, session, _lease = self.collect(quote_seconds=10)

        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual(run.status, 'partial')
        self.assertEqual(run.error_code, 'runtime_budget')
        self.assertLess(run.success_count, 80)
        self.assertLess(len(session.queries), 80)
        self.assertLess(clock.elapsed, 480)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_reason, 'runtime_budget')
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)

    def test_shared_account_cap_truncates_probe_and_cannot_clear_fallback(self):
        self.arm_recovery()

        run, _clock, session, lease = self.collect(shared=True)

        self.assertTrue(run.batch_recovery_probe)
        self.assert_full_plan(run, 40)
        self.assertEqual(len(session.queries), 40)
        self.assertEqual(session.auth_rpcs, 4)
        self.assertEqual(lease.rpc_count, 44)
        self.assertEqual(lease.completions, 1)
        self.assertEqual(run.batch_fallback_reason, 'shared_budget')
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_reason, 'shared_budget')
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)

    def test_crash_after_consuming_probe_cannot_repeat_it_after_lease_expiry(self):
        from Market.worker import _claim_run, _prepare_batch_policy

        self.arm_recovery()
        abandoned = _claim_run(1000)
        policy = _prepare_batch_policy(abandoned, 1000)
        self.assertEqual(policy['max_items_per_run'], 80)
        abandoned.refresh_from_db()
        self.assertTrue(abandoned.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)

        # The next process only recovers the lease; it never contacts a second
        # account or spends a second probe to finish the abandoned attempt.
        run, _clock, _session, _lease = self.collect(
            now_ms=abandoned.lease_expires_at_ms + 1,
        )

        abandoned.refresh_from_db()
        self.assertEqual((abandoned.status, abandoned.error_code), ('failed', 'lease_expired'))
        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_reason, 'lease_expired')

    def test_lease_recovery_discards_unspent_streak(self):
        self.arm_recovery()
        CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='abandoned',
            lease_expires_at_ms=999,
        )

        run, _clock, _session, _lease = self.collect(now_ms=1000)

        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_fallback_reason, 'lease_expired')

    def test_probe_failure_after_protection_expires_during_run_still_renews_consumed_latch(self):
        self.arm_recovery(batch_fallback_until_ms=1100)

        def fail_fourth_query(_item_id, index):
            if index == 4:
                raise NetworkError('synthetic')

        run, _clock, _session, _lease = self.collect(on_quote=fail_fourth_query)

        self.assertGreater(run.finished_at_ms, 1100)
        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual(run.status, 'partial')
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)

    def test_old_writer_during_healthy_forty_invalidates_credit_before_finish(self):
        self.arm_recovery(count=2)

        def old_release_write(_item_id, index):
            if index == 1:
                MarketConfig.objects.filter(pk=1).update(updated_at_ms=1001)

        run, _clock, _session, _lease = self.collect(on_quote=old_release_write)

        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual(config.batch_recovery_success_count, 1)
        self.assertEqual(config.batch_recovery_success_at_ms, run.finished_at_ms)

    def test_probe_losing_lease_returns_without_writes_and_cannot_repeat_after_recovery(self):
        self.arm_recovery()

        def supersede_lease(_item_id, index):
            if index == 1:
                CollectionRun.objects.filter(status='running').update(
                    lease_owner='superseding-worker', lease_expires_at_ms=1500,
                )

        result, _clock, session, _lease = self.collect(on_quote=supersede_lease)

        self.assertIsNone(result)
        self.assertEqual(len(session.queries), 1)
        self.assertFalse(PriceSnapshot.objects.exists())
        abandoned = CollectionRun.objects.get(status='running')
        self.assertTrue(abandoned.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)

        recovered, _clock, _session, _lease = self.collect(now_ms=1501)

        abandoned.refresh_from_db()
        self.assertEqual((abandoned.status, abandoned.error_code), ('failed', 'lease_expired'))
        self.assert_full_plan(recovered, 40)
        self.assertFalse(recovered.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)

    def test_normal_shared_budget_forty_does_not_earn_transport_recovery_credit(self):
        self.arm_recovery(count=2)

        run, _clock, session, lease = self.collect(shared=True)

        self.assert_full_plan(run, 40)
        self.assertFalse(run.batch_recovery_probe)
        self.assertEqual(len(session.queries), 40)
        self.assertEqual(lease.rpc_count, 44)
        config = MarketConfig.objects.get(pk=1)
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_reason, 'shared_budget')

    def test_empty_probe_preserves_one_attempt_without_opening_session(self):
        self.arm_recovery()
        MarketItem.objects.update(enabled=False)

        run, _clock, session, _lease = self.collect()

        self.assertTrue(run.batch_recovery_probe)
        self.assertEqual((run.status, run.item_limit, run.expected_count), ('failed', 80, 0))
        self.assertEqual(run.error_code, 'no_enabled_items')
        self.assertFalse(session.entered)
        self.assertEqual(session.queries, [])
        config = MarketConfig.objects.get(pk=1)
        self.assertTrue(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertEqual(config.batch_fallback_until_ms, run.finished_at_ms + FALLBACK_DURATION_MS)

    def test_natural_expiry_clears_consumed_marker_and_returns_to_configured_eighty(self):
        self.arm_recovery(
            count=0, batch_recovery_probe_attempted=True,
            batch_fallback_until_ms=1000,
        )

        run, _clock, _session, _lease = self.collect(now_ms=1000)

        self.assert_full_plan(run, 80)
        self.assertFalse(run.batch_recovery_probe)
        config = MarketConfig.objects.get(pk=1)
        self.assertIsNone(config.batch_fallback_until_ms)
        self.assertEqual(config.batch_fallback_reason, '')
        self.assertFalse(config.batch_recovery_probe_attempted)
        self.assertEqual(config.batch_recovery_success_count, 0)
        self.assertIsNone(config.batch_recovery_success_at_ms)

    def test_two_normal_eighty_rounds_cover_all_one_hundred_forty_nine_items(self):
        self.arm_recovery(count=0, batch_fallback_until_ms=None, batch_fallback_reason='')

        first, _clock, first_session, _lease = self.collect()
        second, _clock, second_session, _lease = self.collect()

        self.assert_full_plan(first, 80)
        self.assert_full_plan(second, 80)
        first_ids = [item_id for item_id, _scope in first_session.queries]
        second_ids = [item_id for item_id, _scope in second_session.queries]
        self.assertEqual(first_ids, list(range(1, 81)))
        self.assertEqual(second_ids[:69], list(range(81, 150)))
        self.assertEqual(set(first_ids + second_ids), set(range(1, 150)))
        self.assertEqual(LatestPrice.objects.count(), 149)
        self.assertFalse(MarketItem.objects.filter(last_attempt_at_ms__isnull=True).exists())

    def test_failing_item_advances_cursor_so_all_one_hundred_forty_nine_get_a_turn(self):
        self.arm_recovery(count=0, batch_fallback_until_ms=None, batch_fallback_reason='')

        def invalid_first_quote(_item_id, index):
            if index == 1:
                raise ValueError('synthetic')

        first, _clock, first_session, _lease = self.collect(on_quote=invalid_first_quote)
        second, _clock, second_session, _lease = self.collect()

        self.assertEqual((first.status, first.success_count, first.failure_count), ('partial', 79, 1))
        self.assert_full_plan(second, 80)
        first_ids = [item_id for item_id, _scope in first_session.queries]
        second_ids = [item_id for item_id, _scope in second_session.queries]
        self.assertEqual(second_ids[:69], list(range(81, 150)))
        self.assertEqual(set(first_ids + second_ids), set(range(1, 150)))
        self.assertFalse(MarketItem.objects.filter(last_attempt_at_ms__isnull=True).exists())
