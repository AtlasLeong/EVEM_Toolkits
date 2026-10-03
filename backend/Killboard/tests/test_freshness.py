"""Resumable freshness probing with real cursor, lease and persistence state."""
from unittest.mock import patch
from datetime import datetime, timezone
from decimal import Decimal

from django.test import TestCase
from django.core.management import call_command, CommandError

from Killboard.discovery import DiscoveryConfig, ProbeOutcome, ProbeStatus, RUN_LEASE_MS
from Killboard.collector_transport import CollectorError
from Killboard.freshness import FreshnessRunner, _merge, _validated_state
from Killboard.models import CollectionPolicy, KillReport, ProbeCursor, ProbeEvent, ProbeRun
from Killboard.parser import parse_kill_blob
from Killboard.protocol import decode_kill_info_response
from Killboard.tests.test_discovery import FakeClient, RateLimited, captured_response, response


class PrefixClient(FakeClient):
    def __init__(self, frontier, error_id=None):
        super().__init__({})
        self.frontier, self.error_id = frontier, error_id

    def get_kill_info(self, kill_id, *, enrich=None):
        self.calls.append(kill_id)
        if kill_id == self.error_id:
            raise RateLimited()
        return response(kill_id) if kill_id <= self.frontier else None


class ValuePrefixClient(PrefixClient):
    def __init__(self, frontier, *, value='1', values=None, captured=False):
        super().__init__(frontier)
        self.value, self.values = value, values or {}
        self.captured = captured
        self.enrichment_calls = []

    def get_kill_info(self, kill_id, *, enrich=None):
        self.enrichment_calls.append((kill_id, enrich))
        result = super().get_kill_info(kill_id, enrich=enrich)
        value = self.values.get(kill_id, self.value)
        if result is not None and self.captured:
            result = decode_kill_info_response(captured_response(kill_id))
            if value is not None:
                result['isk_lost'] = value
        elif result is not None and value is not None:
            result['kill_blob'] = result['kill_blob'].replace('<kill ', f'<kill iskLost="{value}" ')
        return result


class FreshnessTests(TestCase):
    def cursor(self, name='latest'):
        return ProbeCursor.objects.create(name=name, last_success_id=100,
                                          next_probe_id=101)

    def run_pass(self, cursor, client, maximum=24):
        return FreshnessRunner(client, cursor=cursor, policy=None,
                               config=DiscoveryConfig(max_requests=maximum)).run()

    def value_policy(self):
        return CollectionPolicy.objects.create(name='value_only', min_ship_rank=0,
                                               min_isk_lost=Decimal('20000000000.00'))

    def test_known_value_filtered_locator_reports_do_not_repeat_in_the_same_round(self):
        cursor = self.cursor()
        client = ValuePrefixClient(105, values={105: '20000000000.00'})
        run = FreshnessRunner(client, cursor=cursor, policy=self.value_policy()).run()
        cursor.refresh_from_db()
        located_reports = list(run.events.filter(status='report', diagnostics__phase='locate')
                               .order_by('id').values_list('kill_id', flat=True))
        self.assertEqual(located_reports, [101, 105])
        for kill_id in located_reports:
            self.assertEqual(client.calls.count(kill_id), 1)
            self.assertNotIn((kill_id, True), client.enrichment_calls)
        self.assertEqual(set(run.events.filter(diagnostics__phase='scan')
                             .values_list('kill_id', flat=True)), {102, 103, 104})
        self.assertEqual(cursor.strategy_state['pending_ranges'], [])
        self.assertEqual(cursor.next_probe_id, 106)
        self.assertFalse(cursor.strategy_state['coverage_verified'])
        self.assertEqual(run.stop_reason, 'caught_up')
        self.assertEqual(run.request_count, len(client.calls))
        self.assertEqual(run.request_count, run.events.count())
        self.assertEqual(run.report_count, 5)
        self.assertEqual(run.diagnostics['filtered_value_count'], 5)
        self.assertEqual(run.diagnostics['scan_count'], 3)
        self.assertFalse(KillReport.objects.exists())

    def test_captured_base_without_identity_names_can_complete_value_filtered_work(self):
        decoded = decode_kill_info_response(captured_response(102))
        decoded['isk_lost'] = '1'
        parsed = parse_kill_blob(decoded['kill_blob'], summary=decoded)
        self.assertEqual(parsed['ship_name'], '')
        self.assertEqual(parsed['victim_name'], '')
        self.assertEqual(parsed['participants_status'], 'provided')
        self.assertEqual(parsed['isk_lost'], Decimal('1'))
        cursor = self.cursor()
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 100, 'history_start': 101,
            'pending_ranges': [], 'coverage_verified': False,
            'search': {'lower': 100, 'upper': 104, 'step': 64},
        }
        cursor.save()
        client = ValuePrefixClient(103, captured=True)
        run = FreshnessRunner(client, cursor=cursor, policy=self.value_policy()).run()
        cursor.refresh_from_db()
        self.assertEqual(client.calls, [104, 102, 103, 101])
        self.assertEqual(list(run.events.filter(diagnostics__phase='scan')
                              .values_list('kill_id', flat=True)), [101])
        self.assertEqual(cursor.strategy_state['pending_ranges'], [])
        self.assertEqual(cursor.strategy_state['frontier'], 103)
        self.assertEqual(run.request_count, len(client.calls))
        self.assertEqual(run.request_count, run.events.count())
        self.assertEqual(run.report_count, 3)
        self.assertEqual(run.diagnostics['filtered_value_count'], 3)
        self.assertEqual(run.stop_reason, 'caught_up')

    def test_unknown_value_and_above_threshold_reports_still_scan_with_enrichment(self):
        policy = self.value_policy()
        for name, value in (('unknown', None), ('eligible', '20000000000.01')):
            with self.subTest(value=value):
                cursor = self.cursor(name)
                client = ValuePrefixClient(101, value=value)
                run = FreshnessRunner(client, cursor=cursor, policy=policy).run()
                cursor.refresh_from_db()
                self.assertEqual(client.calls.count(101), 2)
                self.assertIn((101, False), client.enrichment_calls)
                self.assertIn((101, True), client.enrichment_calls)
                self.assertEqual(run.report_count, 2)
                self.assertEqual(run.request_count, len(client.calls))
                self.assertEqual(cursor.strategy_state['pending_ranges'], [])
                self.assertEqual(KillReport.objects.filter(kill_id=101).exists(), value is not None)

    def test_reports_without_a_value_threshold_still_scan(self):
        policy = CollectionPolicy.objects.create(name='no_threshold', min_ship_rank=0)
        for name, active_policy in (('no_policy', None), ('no_threshold', policy)):
            with self.subTest(policy=name):
                cursor = self.cursor(name)
                client = ValuePrefixClient(101)
                run = FreshnessRunner(client, cursor=cursor, policy=active_policy).run()
                self.assertEqual(client.calls.count(101), 2)
                self.assertIn((101, True), client.enrichment_calls)
                self.assertEqual(run.report_count, 2)

    def test_filtered_locator_markers_do_not_survive_an_unfinished_round_on_the_same_runner(self):
        cursor = self.cursor()
        client = ValuePrefixClient(101)
        runner = FreshnessRunner(client, cursor=cursor, policy=self.value_policy(),
                                 config=DiscoveryConfig(max_requests=1))
        first = runner.run()
        cursor.refresh_from_db()
        self.assertEqual(client.calls, [101])
        self.assertEqual(first.stop_reason, 'max_requests')
        self.assertEqual(cursor.strategy_state['phase'], 'locate')
        self.assertNotIn('_located_value_filtered_ids', cursor.strategy_state)
        client.calls.clear()
        client.enrichment_calls.clear()
        client.value = '20000000000.01'
        runner.config = DiscoveryConfig(max_requests=24)
        second = runner.run()
        cursor.refresh_from_db()
        self.assertIn((101, True), client.enrichment_calls)
        self.assertEqual(client.calls.count(101), 1)
        self.assertEqual(second.request_count, len(client.calls))
        self.assertEqual(cursor.strategy_state['pending_ranges'], [])
        self.assertEqual(KillReport.objects.get(kill_id=101).isk_lost, Decimal('20000000000.01'))

    def test_value_filtered_report_with_deferred_limit_retains_recovery_work(self):
        cursor = self.cursor()
        cursor.failure_count = 2
        cursor.save()
        client = ValuePrefixClient(101)
        runner = FreshnessRunner(client, cursor=cursor, policy=self.value_policy())
        original_fetch = runner._fetch

        def deferred(kill_id, **kwargs):
            outcome = original_fetch(kill_id, **kwargs)
            return ProbeOutcome(ProbeStatus.REPORT, payload=outcome.payload,
                                deferred_stop_code='rate_limited')

        with patch.object(runner, '_fetch', side_effect=deferred):
            limited = runner.run()
        cursor.refresh_from_db()
        self.assertEqual(limited.stop_reason, 'rate_limited')
        self.assertEqual(cursor.failure_count, 3)
        self.assertEqual(client.calls, [101])
        self.assertEqual(cursor.strategy_state['phase'], 'locate')
        client.calls.clear()
        client.enrichment_calls.clear()
        paused = runner.run()
        self.assertEqual(paused.stop_reason, 'cooldown')
        self.assertEqual(client.calls, [])
        cursor.cooldown_until_ms = 1
        cursor.save(update_fields=['cooldown_until_ms'])
        recovered = runner.run()
        cursor.refresh_from_db()
        self.assertIn((101, True), client.enrichment_calls)
        self.assertEqual(recovered.request_count, len(client.calls))
        self.assertEqual(cursor.strategy_state['pending_ranges'], [])
        self.assertEqual(cursor.failure_count, 0)

    def test_deferred_stop_at_the_boundary_keeps_all_unscanned_locator_reports_pending(self):
        cursor = self.cursor()
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 100, 'history_start': 101,
            'pending_ranges': [], 'coverage_verified': False,
            'search': {'lower': 100, 'upper': 104, 'step': 64},
        }
        cursor.save()
        client = ValuePrefixClient(103)
        runner = FreshnessRunner(client, cursor=cursor, policy=self.value_policy())
        original_fetch = runner._fetch

        def deferred_boundary(kill_id, **kwargs):
            outcome = original_fetch(kill_id, **kwargs)
            if kill_id == 103:
                return ProbeOutcome(ProbeStatus.REPORT, payload=outcome.payload,
                                    deferred_stop_code='rate_limited')
            return outcome

        with patch.object(runner, '_fetch', side_effect=deferred_boundary):
            run = runner.run()
        cursor.refresh_from_db()
        self.assertEqual(client.calls, [104, 102, 103])
        self.assertEqual(run.stop_reason, 'rate_limited')
        self.assertEqual(cursor.strategy_state['phase'], 'scan')
        self.assertEqual(cursor.strategy_state['pending_ranges'], [[101, 103]])
        self.assertEqual(cursor.next_probe_id, 101)
        self.assertEqual(run.request_count, len(client.calls))

    def test_search_resumes_and_prioritizes_newest_without_losing_history(self):
        cursor = self.cursor()
        first = PrefixClient(1000)
        run = self.run_pass(cursor, first, maximum=4)
        cursor.refresh_from_db()
        self.assertEqual(run.request_count, 4)
        self.assertEqual(cursor.strategy_state['phase'], 'locate')
        self.assertEqual(cursor.strategy_state['history_start'], 101)
        self.assertEqual(cursor.next_probe_id, 101)
        self.assertFalse(cursor.strategy_state['coverage_verified'])
        second = PrefixClient(1000)
        self.run_pass(cursor, second)
        cursor.refresh_from_db()
        self.assertEqual(cursor.strategy_state['frontier'], 1000)
        self.assertEqual(cursor.candidate_id, 1000)
        scan_events = ProbeEvent.objects.filter(run__cursor=cursor,
                                                diagnostics__phase='scan')
        self.assertEqual(scan_events.order_by('id').first().kill_id, 1000)
        self.assertTrue(scan_events.filter(kill_id=101).exists())
        self.assertTrue(cursor.strategy_state['pending_ranges'])
        self.assertEqual(cursor.strategy_state['history_start'], 101)
        self.assertGreaterEqual(cursor.last_success_id, 1000)

    def test_rate_limit_is_not_empty_does_not_advance_and_next_run_is_offline(self):
        cursor = self.cursor()
        first = PrefixClient(200, error_id=101)
        run = self.run_pass(cursor, first)
        cursor.refresh_from_db()
        self.assertEqual(run.stop_reason, 'rate_limited')
        self.assertEqual(run.empty_count, 0)
        self.assertEqual(first.calls, [101])
        self.assertEqual(cursor.next_probe_id, 101)
        second = PrefixClient(200)
        self.run_pass(cursor, second)
        self.assertEqual(second.calls, [])

    def test_stale_empty_upper_is_revalidated_on_resume(self):
        cursor = self.cursor()
        cursor.last_success_id = 120
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 100,
            'history_start': 101, 'pending_ranges': [], 'coverage_verified': False,
            'search': {'lower': 120, 'upper': 130, 'step': 64},
        }
        cursor.save()
        client = PrefixClient(150)
        self.run_pass(cursor, client)
        cursor.refresh_from_db()
        self.assertEqual(client.calls[0], 130)
        self.assertEqual(cursor.strategy_state['frontier'], 150)

    def test_descending_scan_does_not_reverse_success_time_or_maximum_id(self):
        cursor = self.cursor()
        client = PrefixClient(105)
        self.run_pass(cursor, client)
        cursor.refresh_from_db()
        self.assertEqual(cursor.last_success_id, 105)
        self.assertNotIn('time_reversed', list(ProbeRun.objects.values_list('stop_reason', flat=True)))
        self.assertEqual(KillReport.objects.filter(kill_id__gte=101, kill_id__lte=105).count(), 5)
        self.assertEqual(cursor.strategy_state['pending_ranges'], [])

    def test_invalid_state_fails_closed_without_requests(self):
        cursor = self.cursor()
        cursor.strategy_state = {'version': 1, 'phase': 'scan', 'pending_ranges': [[200, 10]]}
        cursor.save()
        client = PrefixClient(200)
        run = self.run_pass(cursor, client)
        self.assertEqual(run.stop_reason, 'invalid_strategy_state')
        self.assertEqual(client.calls, [])

    def test_verified_base_with_deferred_failure_retains_pending_enrichment(self):
        cursor = self.cursor()
        cursor.failure_count, cursor.cooldown_until_ms = 2, 1
        cursor.save()
        client = PrefixClient(101)
        original_fetch = FreshnessRunner._fetch
        def partial(runner, kill_id, **kwargs):
            outcome = original_fetch(runner, kill_id, **kwargs)
            if kwargs.get('enrich') is not False and outcome.status is ProbeStatus.REPORT:
                return ProbeOutcome(ProbeStatus.REPORT, payload=outcome.payload,
                                    deferred_stop_code='rate_limited')
            return outcome
        with patch.object(FreshnessRunner, '_fetch', partial):
            run = self.run_pass(cursor, client)
        cursor.refresh_from_db()
        self.assertTrue(KillReport.objects.filter(kill_id=101).exists())
        self.assertEqual(run.stop_reason, 'rate_limited')
        self.assertEqual(cursor.strategy_state['pending_ranges'], [[101, 101]])
        self.assertEqual(cursor.failure_count, 3)

    def test_dry_run_rolls_back_every_state_row(self):
        cursor = self.cursor()
        runner = FreshnessRunner(PrefixClient(105), cursor=cursor,
                                 config=DiscoveryConfig(max_requests=10))
        runner.run(dry_run=True)
        cursor.refresh_from_db()
        self.assertEqual(cursor.strategy_state, {})
        self.assertFalse(ProbeRun.objects.exists())
        self.assertFalse(KillReport.objects.exists())

    def test_failed_upper_revalidation_does_not_publish_boundary(self):
        cursor = self.cursor()
        cursor.last_success_id = 120
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 100,
            'history_start': 101, 'pending_ranges': [], 'coverage_verified': False,
            'search': {'lower': 120, 'upper': 121, 'step': 64},
        }
        cursor.save()
        self.run_pass(cursor, PrefixClient(150, error_id=121))
        cursor.refresh_from_db()
        self.assertIsNone(cursor.candidate_id)
        self.assertEqual(cursor.strategy_state['phase'], 'locate')
        self.assertEqual(cursor.strategy_state['frontier'], 100)

    def test_record_preserves_a_renewed_database_lease(self):
        cursor = self.cursor()
        runner = FreshnessRunner(PrefixClient(101), cursor=cursor)
        run = runner._create_run(cursor)
        runner.active_run = run
        renewed = datetime(2026, 10, 2, 12, 0, tzinfo=timezone.utc)
        state = {'version': 1, 'phase': 'scan', 'frontier': 101, 'history_start': 101,
                 'search': {'lower': 101, 'upper': 102, 'step': 64},
                 'pending_ranges': [[101, 101]], 'coverage_verified': False}
        with patch('Killboard.discovery.timezone.now', return_value=renewed):
            runner.heartbeat()
        runner._record_fresh(run, cursor, state, 101, runner._fetch(101), 'scan')
        run.refresh_from_db()
        self.assertEqual(run.lease_expires_at_ms, int(renewed.timestamp() * 1000) + RUN_LEASE_MS)

    def test_range_compaction_requeues_gaps_without_losing_pending_ids(self):
        ranges = [[101 + index * 3, 101 + index * 3] for index in range(128)]
        result = _merge(ranges)
        self.assertLessEqual(len(result), 64)
        for lower, upper in ranges:
            self.assertTrue(any(left <= lower <= upper <= right for left, right in result))

    def test_invisible_pending_id_does_not_starve_other_reports(self):
        cursor = self.cursor()
        cursor.last_success_id = 105
        cursor.strategy_state = {
            'version': 1, 'phase': 'scan', 'frontier': 105,
            'history_start': 101, 'pending_ranges': [[101, 105]],
            'search': {'lower': 105, 'upper': 106, 'step': 64}, 'coverage_verified': False,
        }
        cursor.save()
        client = FakeClient({value: response(value) for value in range(101, 105)})
        run = self.run_pass(cursor, client)
        cursor.refresh_from_db()
        self.assertEqual(cursor.strategy_state['pending_ranges'], [[105, 105]])
        self.assertTrue(KillReport.objects.filter(kill_id=104).exists())
        self.assertEqual(run.stop_reason, 'waiting_visibility')
        second = FakeClient({value: response(value) for value in range(101, 105)})
        self.run_pass(cursor, second)
        self.assertNotIn(105, second.calls)

    def test_locator_reserves_history_work_when_search_is_still_pending(self):
        cursor = self.cursor()
        cursor.last_success_id = 105
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 105,
            'history_start': 101, 'pending_ranges': [[101, 105]],
            'search': {'lower': 105, 'upper': None, 'step': 1}, 'coverage_verified': False,
        }
        cursor.save()
        client = PrefixClient(1000000000)
        run = self.run_pass(cursor, client, maximum=16)
        self.assertEqual(run.diagnostics['locate_count'], 12)
        self.assertEqual(run.diagnostics['scan_count'], 4)
        cursor.refresh_from_db()
        self.assertEqual(cursor.strategy_state['phase'], 'locate')
        self.assertEqual(_validated_state(cursor, None)['history_start'], 101)

    def test_known_transport_decode_failure_counts_attempt_without_empty_or_progress(self):
        cursor = self.cursor()
        client = FakeClient({101: CollectorError('malformed', 'decoder_failure')})
        run = self.run_pass(cursor, client)
        self.assertEqual(run.request_count, 1)
        self.assertEqual(run.empty_count, 0)
        self.assertEqual(run.stop_reason, 'malformed')

    def test_management_command_defaults_to_rollback_and_cannot_clear_pause(self):
        cursor = self.cursor()
        with patch('Killboard.management.commands.killboard_collect.Command._client',
                   return_value=PrefixClient(101)):
            call_command('killboard_collect', cursor='latest', client='injected', max_requests=3)
        cursor.refresh_from_db()
        self.assertEqual(cursor.strategy_state, {})
        self.assertFalse(ProbeRun.objects.exists())
        with self.assertRaises(CommandError):
            call_command('killboard_collect', cursor='latest', client='injected', resume=True, write=True)

    def test_saved_search_cannot_claim_a_report_beyond_last_observed_success(self):
        cursor = self.cursor()
        cursor.strategy_state = {
            'version': 1, 'phase': 'locate', 'frontier': 100,
            'history_start': 101, 'pending_ranges': [], 'coverage_verified': False,
            'search': {'lower': 120, 'upper': None, 'step': 64},
        }
        cursor.save()
        client = PrefixClient(200)
        run = self.run_pass(cursor, client)
        self.assertEqual(run.stop_reason, 'invalid_strategy_state')
        self.assertEqual(client.calls, [])

    def test_a_healthy_bounded_round_resets_consecutive_failures_without_needing_full_coverage(self):
        cursor = self.cursor()
        cursor.failure_count = 2
        cursor.pause_reason = 'rate_limited'
        cursor.cooldown_until_ms = 1
        cursor.save()
        run = self.run_pass(cursor, PrefixClient(1000), maximum=4)
        cursor.refresh_from_db()
        self.assertEqual(run.stop_reason, 'max_requests')
        self.assertEqual(cursor.failure_count, 0)
        self.assertEqual(cursor.pause_reason, '')

    def test_seed_is_not_advertised_as_a_located_latest_candidate(self):
        from Killboard.views import _strategy_summary
        cursor = self.cursor()
        state = _validated_state(cursor, None)
        self.assertIsNone(_strategy_summary(state)['newest_candidate_id'])
