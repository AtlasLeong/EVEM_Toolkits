"""Offline regression evidence for paced, fail-closed collection passes."""

from unittest.mock import patch

from django.core.management import call_command
from django.test import TestCase

from Killboard.discovery import DiscoveryConfig, DiscoveryRunner
from Killboard.models import ProbeCursor, epoch_ms
from Killboard.tests.test_discovery import FakeClient, RateLimited, Unauthorized, response


class Clock:
    def __init__(self):
        self.value = 0.0
        self.sleeps = []

    def now(self):
        return self.value

    def sleep(self, seconds):
        self.sleeps.append(seconds)
        self.value += seconds


class WorkerTests(TestCase):
    def test_rate_rejection_persists_cooldown_and_next_pass_sends_nothing(self):
        cursor = ProbeCursor.objects.create(name='latest', next_probe_id=100)
        first = DiscoveryRunner(FakeClient({100: RateLimited()}), cursor=cursor,
                                config=DiscoveryConfig(max_requests=1)).run()
        cursor.refresh_from_db()
        self.assertEqual(first.stop_reason, 'rate_limited')
        self.assertEqual(cursor.next_probe_id, 100)
        self.assertEqual(cursor.pause_reason, 'rate_limited')
        self.assertGreater(cursor.cooldown_until_ms, epoch_ms())
        self.assertEqual(cursor.failure_count, 1)
        second_client = FakeClient({100: response(100)})
        second = DiscoveryRunner(second_client, cursor=cursor,
                                 config=DiscoveryConfig(max_requests=1)).run()
        self.assertEqual(second.stop_reason, 'cooldown')
        self.assertEqual(second.request_count, 0)
        self.assertEqual(second_client.calls, [])

    def test_auth_rejection_requires_explicit_resume_not_another_account(self):
        cursor = ProbeCursor.objects.create(name='auth', next_probe_id=100)
        DiscoveryRunner(FakeClient({100: Unauthorized()}), cursor=cursor,
                        config=DiscoveryConfig(max_requests=1)).run()
        cursor.refresh_from_db()
        self.assertEqual(cursor.pause_reason, 'unauthorized')
        self.assertIsNone(cursor.cooldown_until_ms)
        another = FakeClient({100: response(100)})
        run = DiscoveryRunner(another, cursor=cursor,
                              config=DiscoveryConfig(max_requests=1)).run()
        self.assertEqual(run.stop_reason, 'unauthorized')
        self.assertEqual(another.calls, [])

    def test_inherited_character_entry_service_refusal_pauses_next_scheduled_pass(self):
        from Killboard.collector_transport import KillboardClient
        from Killboard.tests.test_collector_transport import WireSocket, frame, response as rpc_response
        from Killboard.tests.test_session_bundle import synthetic_bundle
        cursor = ProbeCursor.objects.create(name='service-refused', next_probe_id=100)
        wire = WireSocket(frame(2, {'accepted': True, 'info': {'node_info': {'node_id': 42}}})
                          + rpc_response(1, [0, {'client_id': 77, 'proxy_node_id': 88}])
                          + rpc_response(2, ['synthetic-service-refusal']))
        with patch('socket.create_connection', return_value=wire) as connect:
            first = DiscoveryRunner(KillboardClient(synthetic_bundle()), cursor=cursor,
                                    config=DiscoveryConfig(max_requests=2)).run()
            cursor.refresh_from_db()
            self.assertEqual((first.stop_reason, cursor.pause_reason), ('service_rejected', 'service_rejected'))
            self.assertIsNone(cursor.cooldown_until_ms)
            later = FakeClient({100: response(100)})
            second = DiscoveryRunner(later, cursor=cursor, config=DiscoveryConfig(max_requests=2)).run()
            self.assertEqual((second.stop_reason, second.request_count), ('service_rejected', 0))
            self.assertEqual(later.calls, [])
            self.assertEqual(connect.call_count, 1)
        self.assertTrue(wire.closed)

    def test_deferred_service_refusal_retains_verified_base_report_and_pauses(self):
        from Killboard.collector_transport import BaseReportResult
        from Killboard.models import KillReport
        from Killboard.protocol import decode_kill_info_response
        from Killboard.tests.test_discovery import captured_response
        cursor = ProbeCursor.objects.create(name='deferred-service', next_probe_id=100)
        base = decode_kill_info_response(captured_response(100))
        client = FakeClient({100: BaseReportResult(base, 'service_rejected'), 101: response(101)})
        run = DiscoveryRunner(client, cursor=cursor, config=DiscoveryConfig(max_requests=2)).run()
        cursor.refresh_from_db()
        self.assertTrue(KillReport.objects.filter(kill_id=100).exists())
        self.assertEqual((run.stop_reason, cursor.pause_reason, cursor.next_probe_id), ('service_rejected', 'service_rejected', 101))
        self.assertEqual(client.calls, [100])

    def test_repeated_rate_rejections_increase_local_backoff(self):
        cursor = ProbeCursor.objects.create(name='rate', next_probe_id=100)
        DiscoveryRunner(FakeClient({100: RateLimited()}), cursor=cursor,
                        config=DiscoveryConfig(max_requests=1)).run()
        ProbeCursor.objects.filter(pk=cursor.pk).update(cooldown_until_ms=epoch_ms()-1)
        cursor.refresh_from_db()
        DiscoveryRunner(FakeClient({100: RateLimited()}), cursor=cursor,
                        config=DiscoveryConfig(max_requests=1)).run()
        cursor.refresh_from_db()
        self.assertEqual(cursor.failure_count, 2)
        self.assertGreater(cursor.cooldown_until_ms - epoch_ms(), 29*60*1000)

    def test_management_command_always_closes_its_client(self):
        client = FakeClient({100: None})
        client.close = lambda: setattr(client, 'closed', True)
        with patch('Killboard.management.commands.killboard_probe.Command._client', return_value=client):
            call_command('killboard_probe', start_id=100, max_requests=1, write=True)
        self.assertTrue(getattr(client, 'closed', False))

    def test_probe_command_accepts_rpc_jitter(self):
        from Killboard.models import ProbeRun
        client = FakeClient({100: None})
        with patch('Killboard.management.commands.killboard_probe.Command._client', return_value=client):
            call_command('killboard_probe', cursor='jitter', start_id=100, max_requests=1,
                         rpc_jitter=2, write=True)
        self.assertTrue(ProbeRun.objects.filter(cursor__name='jitter').exists())

    def test_probe_command_passes_active_policy_value_threshold_to_supported_client(self):
        from decimal import Decimal
        from Killboard.models import CollectionPolicy
        for name, threshold in (('high_value_all', Decimal('20000000000.00')),
                                ('custom_threshold', Decimal('123.45')),
                                ('custom_no_threshold', None)):
            with self.subTest(policy=name):
                if name != 'high_value_all':
                    CollectionPolicy.objects.create(name=name, min_ship_rank=0, min_isk_lost=threshold)
                client = FakeClient({100: None})
                observed = []
                client.set_enrichment_min_isk = observed.append
                with patch('Killboard.management.commands.killboard_probe.Command._client', return_value=client):
                    call_command('killboard_probe', policy=name, cursor=name, start_id=100,
                                 max_requests=1, write=True)
                self.assertEqual(observed, [threshold])

    def test_low_value_reports_advance_full_pass_without_using_identity_rpc_budget(self):
        from Killboard.collector_transport import CollectorError, KillboardClient
        from Killboard.models import KillReport
        from Killboard.tests.test_collector_transport import WireSocket, envelope, response as wire_response, sent_rpc, successful_login
        from Killboard.session_bundle import REQUIRED_METHODS
        from Killboard.tests.test_session_bundle import with_profiles
        stream = successful_login()
        for index in range(24):
            stream += wire_response(index + 5, envelope({
                'kill_blob': '<other/>', 'kill_id': 100 + index, 'victim_character_id': 101,
                'isk_lost': '20000000000.00',
            }))
        wire = WireSocket(stream)
        client = KillboardClient(with_profiles())
        with patch('Market.collector_protocol.socket.create_connection', return_value=wire), \
                patch('Killboard.management.commands.killboard_probe.Command._client', return_value=client):
            try:
                call_command('killboard_probe', cursor='capacity', start_id=100, max_requests=24,
                             rpc_interval=0, rpc_budget=36, write=True)
            except CollectorError:
                self.fail('Discarded reports must not request unprovided identity responses')
        cursor = ProbeCursor.objects.get(name='capacity')
        self.assertEqual(cursor.next_probe_id, 124)
        self.assertEqual(cursor.last_success_id, 123)
        self.assertFalse(KillReport.objects.exists())
        self.assertEqual([sent_rpc(raw)[3][0] for raw in wire.sent[1:]],
                         [*REQUIRED_METHODS[:4], *(['get_kill_info'] * 24)])
        self.assertTrue(wire.closed)

    def test_pacer_waits_between_all_rpcs_and_enforces_total_budget(self):
        from Killboard.worker import CollectorPacer, BudgetExhaustedError
        clock = Clock()
        beats = []
        pacer = CollectorPacer(interval=5, max_rpcs=2, max_seconds=100,
                               clock=clock.now, sleep=clock.sleep,
                               heartbeat=lambda: beats.append(True))
        pacer()
        pacer()
        self.assertEqual(clock.sleeps, [5])
        self.assertEqual(len(beats), 2)
        with self.assertRaises(BudgetExhaustedError):
            pacer()
        self.assertEqual(clock.sleeps, [5])

    def test_pacer_adds_bounded_random_delay_between_rpcs(self):
        from Killboard.worker import CollectorPacer
        clock = Clock()
        values = iter((0.75, 1.25))
        pacer = CollectorPacer(interval=5, jitter=2, max_rpcs=3, max_seconds=100,
                               clock=clock.now, sleep=clock.sleep,
                               random_delay=lambda maximum: next(values))
        pacer()
        pacer()
        self.assertEqual(clock.sleeps, [5.75])
        pacer()
        self.assertEqual(clock.sleeps, [5.75, 6.25])

    def test_pacer_deadline_reserves_request_timeout(self):
        from Killboard.worker import CollectorPacer, BudgetExhaustedError
        clock = Clock()
        pacer = CollectorPacer(interval=5, max_rpcs=10, max_seconds=20,
                               request_margin=10, clock=clock.now, sleep=clock.sleep)
        pacer()
        clock.value = 11
        with self.assertRaises(BudgetExhaustedError):
            pacer()
        self.assertEqual(clock.sleeps, [])

    def test_pacer_rechecks_deadline_after_delayed_heartbeat(self):
        from Killboard.worker import CollectorPacer, BudgetExhaustedError
        clock = Clock()
        pacer = CollectorPacer(interval=5, max_rpcs=10, max_seconds=20,
                               clock=clock.now, sleep=clock.sleep,
                               heartbeat=lambda: setattr(clock, 'value', 15))
        with self.assertRaises(BudgetExhaustedError):
            pacer()
        self.assertEqual(pacer.count, 0)

    def test_budget_exhaustion_is_not_empty_and_keeps_the_pending_id(self):
        from Killboard.worker import BudgetExhaustedError
        cursor = ProbeCursor.objects.create(name='budget', next_probe_id=100)
        run = DiscoveryRunner(FakeClient({100: BudgetExhaustedError()}), cursor=cursor,
                              config=DiscoveryConfig(max_requests=1)).run()
        cursor.refresh_from_db()
        self.assertEqual(run.stop_reason, 'budget_exhausted')
        self.assertEqual(run.empty_count, 0)
        self.assertEqual(cursor.next_probe_id, 100)

    def test_lease_is_shorter_than_the_next_timer_tick(self):
        from Killboard.discovery import RUN_LEASE_MS
        self.assertLess(RUN_LEASE_MS, 5*60*1000)

    def test_resume_is_explicit_and_dry_run_cannot_clear_persistent_pause(self):
        cursor = ProbeCursor.objects.create(name='resume', next_probe_id=100,
                                            pause_reason='unauthorized', failure_count=1)
        client = FakeClient({100: None})
        with patch('Killboard.management.commands.killboard_probe.Command._client', return_value=client):
            call_command('killboard_probe', cursor='resume', max_requests=1,
                         resume=True, write=False)
        cursor.refresh_from_db()
        self.assertEqual(cursor.pause_reason, 'unauthorized')

    def test_paused_command_does_not_even_load_another_session(self):
        ProbeCursor.objects.create(name='latest', next_probe_id=100, pause_reason='unauthorized')
        with patch('Killboard.management.commands.killboard_probe.Command._client') as factory:
            call_command('killboard_probe', cursor='latest', write=True)
        factory.assert_not_called()
    def test_bootstrap_initializes_only_explicit_recent_window(self):
        client = FakeClient({key: response(key) if key <= 110 else None for key in range(100, 121)})
        client.close = lambda: setattr(client, 'closed', True)
        with patch('Killboard.management.commands.killboard_bootstrap.Command._client', return_value=client):
            call_command('killboard_bootstrap', known_id=100, upper_id=120,
                         assume_contiguous=True, initialize=True, recent_count=4, write=True)
        cursor = ProbeCursor.objects.get(name='latest')
        self.assertEqual(cursor.candidate_id, 110)
        self.assertEqual(cursor.next_probe_id, 107)
        self.assertIsNone(cursor.last_success_id)
        self.assertTrue(client.closed)

    def test_bootstrap_rate_limit_pauses_same_latest_cursor(self):
        client = FakeClient({100: RateLimited()})
        with patch('Killboard.management.commands.killboard_bootstrap.Command._client', return_value=client):
            call_command('killboard_bootstrap', known_id=100, upper_id=120,
                         assume_contiguous=True, write=True)
        cursor = ProbeCursor.objects.get(name='latest')
        self.assertEqual(cursor.pause_reason, 'rate_limited')
        self.assertIsNone(cursor.next_probe_id)

    def test_bootstrap_cannot_overwrite_existing_collection_position(self):
        from django.core.management import CommandError
        ProbeCursor.objects.create(name='latest', next_probe_id=100)
        with self.assertRaises(CommandError):
            call_command('killboard_bootstrap', known_id=100, upper_id=120,
                         assume_contiguous=True, initialize=True, write=True)

    def test_reclaimed_run_cannot_write_stale_result_or_overwrite_failure(self):
        from Killboard.models import ProbeRun
        from Killboard.worker import LeaseLostError
        cursor = ProbeCursor.objects.create(name='race', next_probe_id=100)
        client = FakeClient({100: response(100)})
        original = client.get_kill_info
        def reclaimed(kill_id):
            ProbeRun.objects.filter(cursor=cursor, status='running').update(
                status='failed', stop_reason='lease_expired', lease_owner='', lease_expires_at_ms=None)
            ProbeCursor.objects.filter(pk=cursor.pk).update(next_probe_id=200, pause_reason='unauthorized')
            return original(kill_id)
        client.get_kill_info = reclaimed
        with patch('Killboard.discovery.persist_report') as persist:
            with self.assertRaises(LeaseLostError):
                DiscoveryRunner(client, cursor=cursor, config=DiscoveryConfig(max_requests=1)).run()
            persist.assert_not_called()
        cursor.refresh_from_db()
        self.assertEqual((cursor.next_probe_id, cursor.pause_reason), (200, 'unauthorized'))
        self.assertEqual(ProbeRun.objects.get(cursor=cursor).stop_reason, 'lease_expired')

    def test_partial_empty_boundary_is_rechecked_after_budget_stop(self):
        cursor = ProbeCursor.objects.create(name='partial-empty', next_probe_id=100)
        DiscoveryRunner(FakeClient({100: None, 101: None}), cursor=cursor,
                        config=DiscoveryConfig(max_requests=2)).run()
        cursor.refresh_from_db()
        self.assertEqual(cursor.next_probe_id, 100)

    def test_crash_recovery_rechecks_unpublished_empty_boundary(self):
        from Killboard.models import ProbeRun
        cursor = ProbeCursor.objects.create(name='crash-empty', next_probe_id=100)
        with self.assertRaises(KeyboardInterrupt):
            DiscoveryRunner(FakeClient({100: None, 101: KeyboardInterrupt()}), cursor=cursor,
                            config=DiscoveryConfig(max_requests=2)).run()
        ProbeRun.objects.filter(cursor=cursor).update(lease_expires_at_ms=epoch_ms()-1)
        next_client = FakeClient({100: response(100)})
        DiscoveryRunner(next_client, cursor=cursor, config=DiscoveryConfig(max_requests=1)).run()
        self.assertEqual(next_client.calls, [100])

    def test_paused_pass_does_not_rewind_previous_empty_count(self):
        cursor = ProbeCursor.objects.create(name='paused-empty', next_probe_id=100,
                                            consecutive_empty_count=3, pause_reason='unauthorized')
        DiscoveryRunner(None, cursor=cursor).run()
        cursor.refresh_from_db()
        self.assertEqual(cursor.next_probe_id, 100)

    def test_invalid_session_configuration_pauses_before_next_factory(self):
        with patch('Killboard.management.commands.killboard_probe.Command._client', side_effect=ValueError('private detail')):
            call_command('killboard_probe', cursor='invalid', start_id=100, write=True)
        cursor = ProbeCursor.objects.get(name='invalid')
        self.assertEqual(cursor.pause_reason, 'configuration_error')
        with patch('Killboard.management.commands.killboard_probe.Command._client') as factory:
            call_command('killboard_probe', cursor='invalid', write=True)
        factory.assert_not_called()

    def test_unexpected_transport_failure_is_audited_without_exception_text(self):
        from Killboard.models import ProbeEvent, ProbeRun
        cursor = ProbeCursor.objects.create(name='audit-failure', next_probe_id=100)
        with self.assertRaises(ValueError):
            DiscoveryRunner(FakeClient({100: ValueError('private credential material')}), cursor=cursor,
                            config=DiscoveryConfig(max_requests=1)).run()
        run = ProbeRun.objects.get(cursor=cursor)
        self.assertEqual(run.status, 'failed')
        event = ProbeEvent.objects.get(run=run)
        self.assertEqual(event.kill_id, 100)
        self.assertEqual(event.status, 'failed')
        self.assertNotIn('private', event.error_code)
