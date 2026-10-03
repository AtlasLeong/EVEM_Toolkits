"""Synthetic, offline tests for bounded read-only diagnostics."""

import json
from io import StringIO
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.test import SimpleTestCase, TestCase

from Killboard.diagnostics import (DISPOSITION_COUNTS, diagnostic_summary, material_identity,
                                   safe_diagnostics, validate_window_hours)
from Killboard.models import ProbeCursor, ProbeEvent, ProbeRun


NOW = 1800000000000


def identity(alias='a', version='b', pool='c'):
    return {'material_alias': 'm_' + alias * 24, 'material_version': 'v_' + version * 24,
            'pool_version': 'p_' + pool * 24}


def counters(**values):
    return {**dict.fromkeys(DISPOSITION_COUNTS, 0), **values}


class DiagnosticValidationTests(SimpleTestCase):
    def test_complete_material_contract_is_safe_and_partial_metadata_is_not_identity(self):
        metadata = identity()
        self.assertEqual(material_identity(metadata), tuple(metadata.values()))
        self.assertEqual(safe_diagnostics({**metadata, 'path': 'PRIVATE', 'token': 'PRIVATE'}), metadata)
        for value in ('m_' + 'a' * 23, 'm_' + 'g' * 24, 'm_' + 'a' * 24 + '\n', 'PRIVATE', [], None):
            bad = {**metadata, 'material_alias': value}
            self.assertIsNone(material_identity(bad))
            self.assertEqual(safe_diagnostics(bad), {})
        self.assertEqual(safe_diagnostics({'material_alias': metadata['material_alias']}), {})

    def test_wrong_types_counts_and_remote_text_fail_closed(self):
        self.assertEqual(safe_diagnostics({'stage': [], 'phase': {}, 'error_code': {},
                                           'session_slot': '/PRIVATE', 'disposition': ['PRIVATE'],
                                           'rpc_count': True, 'created_count': -1,
                                           'updated_count': 10000001}), {})
        self.assertEqual(safe_diagnostics({'session_slot': 'GS'}), {'session_slot': 'GS'})
        self.assertEqual(safe_diagnostics({'session_slot': 'GT'}), {})
        self.assertEqual(safe_diagnostics({'rpc_count': 0, 'error_code': 'service_rejected'}),
                         {'rpc_count': 0, 'error_code': 'service_rejected'})

    def test_window_is_fixed_and_validated(self):
        self.assertEqual(validate_window_hours(168), 168)
        for value in (True, 0, -1, 169, '24', None):
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_window_hours(value)


class DiagnosticSummaryTests(TestCase):
    def setUp(self):
        self.cursor = ProbeCursor.objects.create(name='latest')

    def run_row(self, *, diagnostics=None, requests=1, reports=0, empty=0,
                stop='max_requests', created=None, started=None, **values):
        return ProbeRun.objects.create(
            cursor=self.cursor, request_count=requests, report_count=reports, empty_count=empty,
            diagnostics={} if diagnostics is None else diagnostics, stop_reason=stop,
            created_at_ms=NOW - 1000 if created is None else created,
            started_at_ms=started, **values,
        )

    def summary(self, **options):
        return diagnostic_summary(self.cursor, now_ms=NOW, **options)

    def test_success_value_filter_and_persistence_are_separate_axes(self):
        observations = (137, 35, 35, 66, 68, 76)
        created = (1, 2, 0, 0, 3, 1)
        updated = (0, 0, 0, 0, 1, 0)
        for index, reports in enumerate(observations):
            metadata = identity(alias='abcdef'[index])
            self.run_row(diagnostics={**metadata, 'session_slot': 'ABCDEF'[index], 'rpc_count': reports + 4,
                                      **counters(created_count=created[index], updated_count=updated[index],
                                                 filtered_value_count=reports - created[index] - updated[index])},
                         requests=reports, reports=reports)
        summary = self.summary()
        totals = summary['totals']
        self.assertEqual(totals['km_response_count'], 417)
        self.assertEqual(totals['dispositions']['filtered_value_count'], 409)
        self.assertEqual(totals['dispositions']['created_count'], 7)
        self.assertEqual(totals['dispositions']['updated_count'], 1)
        self.assertEqual(totals['attempted_runs'], 6)
        self.assertEqual(len(summary['materials']), 6)
        self.assertTrue(all(row['runs_with_km'] == 1 for row in summary['materials']))
        self.assertIsNone(summary['distinct_accounts'])
        self.assertIsNone(summary['account_mapping_present'])
        self.assertFalse(summary['account_mapping_used'])
        self.assertFalse(summary['coverage']['coverage_verified'])

    def test_identity_survives_slot_changes_and_versions_do_not_merge(self):
        for slot in ('A', 'F'):
            self.run_row(diagnostics={**identity(), 'session_slot': slot, 'rpc_count': 4})
        self.run_row(diagnostics={**identity(version='d'), 'session_slot': 'A', 'rpc_count': 4})
        self.run_row(diagnostics={**identity(pool='e'), 'session_slot': 'A', 'rpc_count': 4})
        self.run_row(diagnostics={**identity(alias='f'), 'session_slot': 'A', 'rpc_count': 4})
        summary = self.summary()
        self.assertEqual(len(summary['materials']), 4)
        self.assertEqual(sorted(row['runs'] for row in summary['materials']), [1, 1, 1, 2])
        self.assertEqual(summary['legacy_slots'], [])

    def test_legacy_slot_missing_fields_and_unattributed_rows_are_not_rewritten(self):
        stable = self.run_row(diagnostics={**identity(), 'session_slot': 'A', 'rpc_count': 3})
        legacy = self.run_row(diagnostics={'session_slot': 'A'}, requests=2, reports=2)
        unrecorded = self.run_row(diagnostics=['PRIVATE'], reports=1)
        summary = self.summary()
        self.assertEqual(len(summary['materials']), 1)
        self.assertEqual(summary['legacy_slots'][0]['attribution'], 'legacy_slot')
        self.assertNotIn('material_alias', summary['legacy_slots'][0])
        self.assertEqual(summary['coverage']['legacy_slot_runs'], 1)
        self.assertEqual(summary['coverage']['unattributed_runs'], 1)
        self.assertEqual(summary['coverage']['missing_diagnostics_runs'], 1)
        self.assertEqual(summary['totals']['attempted_runs'], 1)
        self.assertEqual(summary['totals']['unknown_attempt_runs'], 2)
        self.assertIsNone(summary['totals']['rpc_count'])
        self.assertIsNone(summary['totals']['dispositions']['created_count'])
        self.assertEqual(summary['totals']['known_dispositions']['created_count'], 0)
        self.assertEqual(summary['totals']['unclassified_km_response_count'], 3)
        for row in (stable, legacy, unrecorded):
            original = row.diagnostics
            row.refresh_from_db()
            self.assertEqual(row.diagnostics, original)
        self.assertNotIn('PRIVATE', json.dumps(summary))

    def test_zero_rpc_cooldown_is_not_attempt_or_new_limit_and_streak_uses_attempts(self):
        self.run_row(diagnostics={**identity(), 'rpc_count': 4, **counters(created_count=1)}, reports=1)
        self.run_row(diagnostics={**identity(), 'rpc_count': 5}, stop='rate_limited')
        self.run_row(diagnostics={**identity(), 'rpc_count': 0}, requests=0, stop='cooldown')
        self.run_row(diagnostics={**identity(), 'rpc_count': 0}, requests=0, stop='rate_limited')
        self.run_row(diagnostics={}, requests=0, stop='cooldown')
        summary = self.summary()
        material = summary['materials'][0]
        self.assertEqual(material['attempted_runs'], 2)
        self.assertEqual(material['trailing_zero_km_runs'], 1)
        self.assertEqual(material['skipped_cooldown_runs'], 2)
        self.assertEqual(material['failure_counts']['rate_limited'], 1)
        self.assertEqual(summary['totals']['skipped_cooldown_runs'], 3)
        self.assertEqual(summary['totals']['failure_counts']['rate_limited'], 1)

    def test_successful_km_and_deferred_enrichment_failure_are_both_visible_once(self):
        run = self.run_row(diagnostics={**identity(), 'rpc_count': 6,
                                        **counters(created_count=1), 'enrichment_deferred_count': 1},
                           reports=1, stop='rate_limited')
        ProbeEvent.objects.create(run=run, status='report', error_code='rate_limited',
                                  diagnostics={**identity(), 'disposition': 'created', 'stage': 'identity'},
                                  observed_at_ms=NOW - 500)
        summary = self.summary()
        self.assertEqual(summary['totals']['km_response_count'], 1)
        self.assertEqual(summary['totals']['dispositions']['created_count'], 1)
        self.assertEqual(summary['totals']['failure_counts']['rate_limited'], 1)
        self.assertEqual(summary['event_outcomes'], {'report': 1})
        self.assertEqual(summary['event_failure_counts']['rate_limited'], 1)

    def test_network_failure_before_first_rpc_and_legacy_failure_are_not_zero_failures(self):
        self.run_row(diagnostics={**identity(), 'rpc_count': 0}, stop='network_error')
        self.run_row(diagnostics={'session_slot': 'B'}, stop='rate_limited')
        summary = self.summary()
        self.assertEqual(summary['totals']['attempted_runs'], 0)
        self.assertEqual(summary['totals']['unknown_attempt_runs'], 1)
        self.assertEqual(summary['totals']['failure_counts']['network_error'], 1)
        self.assertEqual(summary['totals']['failure_counts']['rate_limited'], 1)
        self.assertEqual(summary['materials'][0]['failure_counts']['network_error'], 1)
        self.assertEqual(summary['legacy_slots'][0]['failure_counts']['rate_limited'], 1)

    def test_latest_success_time_is_explicitly_a_run_time_estimate(self):
        self.run_row(diagnostics={'rpc_count': 5}, reports=1, finished_at_ms=NOW - 10)
        summary = self.summary()
        self.assertEqual(summary['totals']['last_km_run_at_ms'], NOW - 10)
        self.assertEqual(summary['window']['last_km_time_basis'],
                         'run_finished_at_ms_or_started_at_ms_or_created_at_ms')

    def test_missing_rpc_on_zero_request_partial_or_legacy_round_is_unknown(self):
        self.run_row(diagnostics={}, requests=0, stop='max_requests')
        summary = self.summary()
        self.assertIsNone(summary['totals']['rpc_count'])
        self.assertEqual(summary['totals']['missing_rpc_runs'], 1)
        self.assertEqual(summary['totals']['unknown_attempt_runs'], 1)
        self.assertEqual(summary['totals']['attempted_runs'], 0)
        self.assertIsNone(summary['totals']['trailing_zero_km_runs'])

    def test_legacy_time_reversal_report_event_does_not_rewrite_run_counter(self):
        run = self.run_row(diagnostics={'rpc_count': 5}, requests=1, reports=0, stop='time_reversed')
        ProbeEvent.objects.create(run=run, status='report', observed_at_ms=NOW - 1)
        summary = self.summary()
        self.assertEqual(summary['totals']['km_response_count'], 0)
        self.assertEqual(summary['event_outcomes']['report'], 1)
        self.assertEqual(summary['totals']['trailing_zero_km_runs'], 1)
        self.assertEqual(summary['counter_basis']['km_response_count'], 'retained_run_report_count')
        self.assertTrue(summary['counter_basis']['run_report_counts_may_differ_from_report_events'])
        run.refresh_from_db()
        self.assertEqual(run.report_count, 0)

    def test_all_failure_categories_empty_and_unknown_remote_values_are_distinct(self):
        for status in ('rate_limited', 'unauthorized', 'malformed', 'network_error',
                       'configuration_error', 'service_rejected', 'lease_lost', 'empty'):
            run = self.run_row(diagnostics={'rpc_count': 5}, empty=int(status == 'empty'), stop=status)
            ProbeEvent.objects.create(run=run, status=status, error_code=status, observed_at_ms=NOW - 1)
        run = self.run_row(diagnostics={'rpc_count': 5}, stop='PRIVATE SECRET')
        ProbeEvent.objects.create(run=run, status='PRIVATE SECRET', error_code='PRIVATE SECRET',
                                  diagnostics={'error_code': 'PRIVATE SECRET'})
        summary = self.summary()
        for status in ('rate_limited', 'unauthorized', 'malformed', 'network_error',
                       'configuration_error', 'service_rejected', 'lease_lost'):
            self.assertEqual(summary['totals']['failure_counts'][status], 1)
            self.assertEqual(summary['event_failure_counts'][status], 1)
        self.assertEqual(summary['totals']['empty_count'], 1)
        self.assertEqual(summary['event_outcomes']['empty'], 1)
        self.assertEqual(summary['event_outcomes']['unknown_status'], 1)
        self.assertNotIn('PRIVATE', json.dumps(summary))

    def test_start_window_has_inclusive_lower_and_exclusive_upper_and_created_fallback(self):
        lower = NOW - 24 * 3600000
        self.run_row(diagnostics={'rpc_count': 1}, started=lower, created=lower - 1)
        self.run_row(diagnostics={'rpc_count': 1}, created=lower)
        self.run_row(diagnostics={'rpc_count': 1}, started=lower - 1)
        self.run_row(diagnostics={'rpc_count': 1}, started=NOW)
        summary = self.summary()
        self.assertEqual(summary['totals']['runs'], 2)
        self.assertEqual(summary['coverage']['retained_runs'], 4)
        self.assertEqual(summary['window']['basis'], 'run_started_at_ms_or_created_at_ms')

    def test_summary_is_not_the_latest_thirty_runs_or_hundred_events(self):
        for index in range(31):
            run = self.run_row(diagnostics={'rpc_count': 4, **counters(created_count=1)}, reports=1)
            ProbeEvent.objects.bulk_create([ProbeEvent(run=run, status='report', observed_at_ms=NOW - 1)
                                           for _ in range(4)])
        summary = self.summary()
        self.assertEqual(summary['totals']['km_response_count'], 31)
        self.assertEqual(summary['coverage']['included_events'], 124)
        self.assertFalse(summary['coverage']['truncated'])

    def test_row_and_group_caps_expose_omissions_without_claiming_complete_coverage(self):
        for index in range(4):
            run = self.run_row(diagnostics={**identity(alias='abcd'[index]), 'rpc_count': 4},
                               created=NOW - 4 + index)
            ProbeEvent.objects.create(run=run, status='empty', observed_at_ms=NOW - 4 + index)
        with patch('Killboard.diagnostics.MAX_RUNS', 2), patch('Killboard.diagnostics.MAX_EVENTS', 1), \
                patch('Killboard.diagnostics.MAX_GROUPS', 1):
            summary = self.summary()
        coverage = summary['coverage']
        self.assertTrue(coverage['truncated'])
        self.assertEqual(coverage['window_runs'], 4)
        self.assertEqual(coverage['included_runs'], 2)
        self.assertEqual(coverage['omitted_runs'], 2)
        self.assertEqual(coverage['included_events'], 1)
        self.assertEqual(coverage['omitted_events'], 3)
        self.assertEqual(coverage['omitted_groups'], 1)
        self.assertEqual(summary['totals']['runs'], 2)

    def test_readonly_command_has_safe_json_summary_and_never_constructs_client(self):
        self.run_row(diagnostics={**identity(), 'rpc_count': 5, **counters(filtered_value_count=1),
                                  'password': 'PRIVATE SECRET'}, reports=1, stop='service_rejected')
        before = list(ProbeRun.objects.values())
        with patch('Killboard.diagnostics.epoch_ms', return_value=NOW), \
                patch('socket.create_connection', side_effect=AssertionError('Network forbidden')), \
                patch('Killboard.session_bundle.load_round_robin_session',
                      side_effect=AssertionError('Session reads forbidden')), \
                patch('Killboard.collector_transport.build_client',
                      side_effect=AssertionError('Client construction forbidden')):
            output = StringIO()
            call_command('killboard_diagnostics', stdout=output)
            payload = json.loads(output.getvalue())
            self.assertEqual(payload['totals']['km_response_count'], 1)
            self.assertNotIn('PRIVATE', output.getvalue())
            text = StringIO()
            call_command('killboard_diagnostics', format='summary', stdout=text)
            self.assertIn('service_rejected', text.getvalue())
            self.assertIn('account_mapping=not_consulted', text.getvalue())
            self.assertIn('filtered_npc_count', text.getvalue())
            self.assertIn('filtered_policy_count', text.getvalue())
            self.assertIn('material=m_', text.getvalue())
            self.assertIn('missing_diagnostics_runs=', text.getvalue())
            with self.assertRaises(CommandError):
                call_command('killboard_diagnostics', window_hours=169, stdout=StringIO())
        self.assertEqual(before, list(ProbeRun.objects.values()))
        self.assertEqual(ProbeCursor.objects.count(), 1)
        self.assertEqual(ProbeEvent.objects.count(), 0)

    def test_unattributed_totals_do_not_consume_group_cap_or_count_as_omitted_groups(self):
        self.run_row(diagnostics={**identity(), 'rpc_count': 4}, created=NOW - 4)
        self.run_row(diagnostics={'session_slot': 'A', 'rpc_count': 4}, created=NOW - 3)
        self.run_row(diagnostics={}, created=NOW - 2)
        with patch('Killboard.diagnostics.MAX_GROUPS', 1):
            summary = self.summary()
        self.assertEqual(summary['coverage']['attribution_groups'], 2)
        self.assertEqual(summary['coverage']['omitted_groups'], 1)
        self.assertEqual(summary['coverage']['group_scope'], 'material_and_legacy_slot')
        self.assertEqual(summary['unattributed']['runs'], 1)
        self.assertEqual(len(summary['materials']) + len(summary['legacy_slots']), 1)
        self.assertEqual(summary['totals']['runs'], 3)

        ProbeRun.objects.exclude(diagnostics={}).delete()
        with patch('Killboard.diagnostics.MAX_GROUPS', 1):
            summary = self.summary()
        self.assertEqual(summary['coverage']['attribution_groups'], 0)
        self.assertEqual(summary['coverage']['omitted_groups'], 0)
        self.assertFalse(summary['coverage']['truncated'])
        self.assertEqual(summary['unattributed']['runs'], 1)

    def test_no_cursor_returns_empty_readonly_summary(self):
        summary = diagnostic_summary(None, now_ms=NOW)
        self.assertEqual(summary['totals']['runs'], 0)
        self.assertEqual(summary['materials'], [])
        self.assertEqual(summary['coverage']['retained_runs'], 0)
