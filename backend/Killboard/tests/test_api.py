from decimal import Decimal

from django.apps import apps
from django.contrib.auth import get_user_model
from django.test import override_settings
from django.test import TestCase
from rest_framework.test import APIClient

from Killboard.models import CollectionPolicy, KillItem, KillParticipant, KillReport, ProbeCursor, ProbeEvent, ProbeRun, ShipClass


@override_settings(KILLBOARD_OWNER_EMAIL='owner@example.com')
class KillboardApiTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.owner = get_user_model().objects.create_user(username='owner', email='owner@example.com')
        self.other = get_user_model().objects.create_user(username='other', email='other@example.com')
        self.client.force_authenticate(self.owner)
        ShipClass.objects.create(key='battleship', label='战列舰', rank=4)
        report = KillReport.objects.create(
            kill_id=19748417,
            ship_type_id=9001,
            ship_name='测试战列舰',
            ship_class_key='battleship',
            ship_class_label='战列舰',
            system_id=30000299,
            system_name='测试星系',
            victim_character_id=42,
            victim_name='目标甲',
            kill_time_raw='2026-08-15T06:43:05',
            isk_lost=Decimal('229307984742.00'),
            participant_count=None,
            participant_count_source='unknown',
            participants_status='provided',
            equipment_status='provided',
            source='test',
        )
        KillParticipant.objects.create(
            report=report, character_id=9, character_name='', damage=100,
            is_final_blow=True, ship_type_id=123, weapon_type_id=456,
        )
        KillItem.objects.create(
            report=report, type_id=100, name='', slot='12',
            quantity_dropped=1, quantity_destroyed=0, quantity_unknown=5,
            status='dropped',
        )

    def test_owner_reports_list_is_paginated_and_hides_raw_fields(self):
        response = self.client.get('/api/killboard/reports/?page_size=25')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['kill_id'], '19748417')
        self.assertNotIn('raw_hash', response.data['results'][0])

    def test_reports_use_strict_twenty_billion_isk_lower_bound(self):
        KillReport.objects.create(
            kill_id=19748418, ship_name='等于阈值', system_id=30000299,
            isk_lost=Decimal('20000000000.00'), source='test',
        )
        KillReport.objects.create(
            kill_id=19748419, ship_name='低于阈值', system_id=30000299,
            isk_lost=Decimal('19999999999.99'), source='test',
        )
        response = self.client.get('/api/killboard/reports/?page_size=25')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual(response.data['results'][0]['kill_id'], '19748417')
        self.assertEqual(self.client.get('/api/killboard/reports/19748418/').status_code, 404)
        self.assertEqual(self.client.get('/api/killboard/reports/19748419/').status_code, 404)

    def test_anonymous_and_other_accounts_cannot_read_killboard(self):
        anonymous = APIClient()
        for url in (
            '/api/killboard/reports/?page_size=25',
            '/api/killboard/reports/19748417/',
            '/api/killboard/filters/',
            '/api/killboard/status/',
            '/api/killboard/collector/logs/',
        ):
            with self.subTest(url=url):
                response = anonymous.get(url)
                self.assertEqual(response.status_code, 401)
                self.assertEqual(response['Cache-Control'], 'no-store, private')
                self.assertIn('Authorization', response['Vary'])
                self.client.force_authenticate(self.other)
                response = self.client.get(url)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response['Cache-Control'], 'no-store, private')
                self.assertIn('Authorization', response['Vary'])
                self.client.force_authenticate(self.owner)

    def test_owner_access_capability_is_boolean_and_does_not_expose_email(self):
        owner = self.client.get('/api/killboard/access/')
        self.assertEqual(owner.status_code, 200)
        self.assertEqual(owner.data, {'can_view_killboard': True})
        self.assertNotIn('email', owner.data)
        self.assertEqual(owner['Cache-Control'], 'no-store, private')
        self.client.force_authenticate(self.other)
        other = self.client.get('/api/killboard/access/')
        self.assertEqual(other.status_code, 200)
        self.assertEqual(other.data, {'can_view_killboard': False})

    def test_owner_can_read_collector_logs_but_other_accounts_cannot(self):
        cursor = ProbeCursor.objects.create(name='latest', next_probe_id=19748418,
                                            last_success_id=19748417, pause_reason='rate_limited',
                                            failure_count=2)
        run = ProbeRun.objects.create(cursor=cursor, status=ProbeRun.Status.STOPPED,
                                      request_count=2, report_count=1, empty_count=1,
                                      stop_reason='rate_limited', error_code='rate_limited')
        ProbeEvent.objects.create(run=run, kill_id=19748418, status='rate_limited', error_code='rate_limited')
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['cursor']['pause_reason'], 'rate_limited')
        self.assertEqual(response.data['runs'][0]['request_count'], 2)
        self.assertEqual(response.data['events'][0]['status'], 'rate_limited')
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/killboard/collector/logs/').status_code, 403)

    def test_collector_logs_expose_only_safe_diagnostics_and_actual_persistence_counts(self):
        cursor = ProbeCursor.objects.create(name='latest', next_probe_id=20044044, strategy_state={
            'version': 1, 'phase': 'locate', 'frontier': 20044043, 'history_start': 20044044,
            'search': {'lower': 20044043, 'upper': None, 'step': 1024},
            'last_boundary_at_ms': 1790870000000,
            'pending_ranges': [[20044044, 20045043], [20046000, 20046002]],
            'deferred_ids': {'20044044': 1790870000000, 'PRIVATE': 'PRIVATE'},
            'coverage_verified': True, 'password': 'PRIVATE PASSWORD',
        })
        run = ProbeRun.objects.create(cursor=cursor, request_count=5, report_count=4, empty_count=1,
                                      diagnostics={'session_slot': 'B', 'rpc_count': 8,
                                                   'stage': 'identity', 'failure_rpc_method': 'get_public_info',
                                                   'created_count': 1, 'filtered_value_count': 3,
                                                   'strategy': 'latest_first', 'phase': 'locate',
                                                   'password': 'PRIVATE PASSWORD'})
        ProbeEvent.objects.create(run=run, kill_id=20044043, status='report',
                                  diagnostics={'session_slot': 'B', 'stage': 'kill_report',
                                               'last_rpc_method': 'get_kill_info', 'disposition': 'created',
                                               'response': 'PRIVATE BODY'})
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        diagnostics = response.data['runs'][0]['diagnostics']
        self.assertEqual(diagnostics['session_slot'], 'B')
        self.assertEqual(diagnostics['created_count'], 1)
        self.assertEqual(response.data['events'][0]['diagnostics']['disposition'], 'created')
        strategy = response.data['cursor']['strategy']
        self.assertFalse(strategy['coverage_verified'])
        self.assertEqual(strategy['pending_id_count'], 1003)
        self.assertEqual(strategy['pending_range_count'], 2)
        self.assertEqual(strategy['newest_candidate_id'], '20044043')
        self.assertEqual(strategy['historical_next_id'], '20044044')
        self.assertEqual(strategy['deferred_id_count'], 1)
        self.assertNotIn('PRIVATE', str(response.data))
        self.assertEqual(self.client.post('/api/killboard/collector/logs/').status_code, 405)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get('/api/killboard/collector/logs/').status_code, 403)
        self.assertEqual(APIClient().get('/api/killboard/collector/logs/').status_code, 401)

    def test_collector_logs_reject_unrecognized_diagnostic_values_and_remote_error_text(self):
        cursor = ProbeCursor.objects.create(name='latest', strategy_state={'phase': 'PRIVATE PHASE',
                                                                         'pending_ranges': 'PRIVATE DATA'})
        ProbeRun.objects.create(cursor=cursor, stop_reason='PRIVATE BODY', error_code='PRIVATE BODY',
                                diagnostics={'session_slot': '/private/key', 'rpc_count': 'PRIVATE DATA',
                                             'stage': 'PRIVATE METHOD', 'failure_rpc_method': 'PRIVATE METHOD',
                                             'error_code': 'PRIVATE BODY', 'created_count': -1})
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertNotIn('PRIVATE', str(response.data))
        self.assertEqual(response.data['runs'][0]['stop_reason'], 'unknown_error')
        self.assertNotIn('session_slot', response.data['runs'][0]['diagnostics'])

    def test_collector_audit_json_wrong_types_fail_closed_without_server_error(self):
        cursor = ProbeCursor.objects.create(name='latest', strategy_state={'phase': [],
                                                                          'pending_ranges': [[True, 2], [0, 5], [2, 1]]})
        ProbeRun.objects.create(cursor=cursor, diagnostics={'stage': {}, 'last_rpc_method': [],
                                                           'error_code': {}, 'disposition': []})
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['runs'][0]['diagnostics'], {})
        self.assertEqual(response.data['cursor']['strategy']['pending_id_count'], 0)

    def test_collector_logs_ignore_oversized_decimal_deferred_ids(self):
        ProbeCursor.objects.create(name='latest', strategy_state={
            'deferred_ids': {'9' * 5000: 1, '9' * 20: 1},
        })
        self.client.raise_request_exception = False
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['cursor']['strategy']['deferred_id_count'], 0)

    def test_collector_summary_extends_logs_without_using_the_displayed_rows_as_statistics(self):
        from unittest.mock import patch
        from Killboard.diagnostics import DISPOSITION_COUNTS
        now = 1800000000000
        cursor = ProbeCursor.objects.create(name='latest')
        identity = {'material_alias': 'm_' + 'a' * 24, 'material_version': 'v_' + 'b' * 24,
                    'pool_version': 'p_' + 'c' * 24}
        for index in range(31):
            ProbeRun.objects.create(cursor=cursor, created_at_ms=now - 1000, request_count=1, report_count=1,
                                    diagnostics={**identity, 'session_slot': 'A', 'rpc_count': 5,
                                                 **dict.fromkeys(DISPOSITION_COUNTS, 0), 'created_count': 1})
        with patch('Killboard.diagnostics.epoch_ms', return_value=now):
            response = self.client.get('/api/killboard/collector/logs/?window_hours=24')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.data['runs']), 30)
        summary = response.data['summary']
        self.assertEqual(summary['totals']['km_response_count'], 31)
        self.assertEqual(summary['totals']['dispositions']['created_count'], 31)
        self.assertEqual(summary['materials'][0]['material_alias'], identity['material_alias'])
        self.assertEqual(summary['materials'][0]['attempted_runs'], 31)
        self.assertEqual(summary['coverage']['stable_material_runs'], 31)
        self.assertFalse(summary['coverage']['truncated'])
        self.assertIsNone(summary['distinct_accounts'])
        self.assertFalse(summary['account_mapping_used'])
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        self.assertIn('Authorization', response['Vary'])

    def test_collector_logs_and_status_sanitize_event_status_errors_and_identity(self):
        from unittest.mock import patch
        cursor = ProbeCursor.objects.create(name='latest', next_probe_id=1)
        run = ProbeRun.objects.create(cursor=cursor, status='PRIVATE STATUS', stop_reason='service_rejected',
                                      error_code='lease_lost', request_count=1, diagnostics={
                                          'material_alias': 'm_' + 'a' * 24,
                                          'material_version': '/PRIVATE/session', 'pool_version': 'p_' + 'c' * 24,
                                          'rpc_count': 0, 'error_code': 'service_rejected', 'token': 'PRIVATE TOKEN'})
        ProbeEvent.objects.create(run=run, status='PRIVATE STATUS', error_code='PRIVATE BODY')
        response = self.client.get('/api/killboard/collector/logs/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['runs'][0]['status'], 'unknown_status')
        self.assertEqual(response.data['runs'][0]['stop_reason'], 'service_rejected')
        self.assertEqual(response.data['runs'][0]['error_code'], 'lease_lost')
        self.assertEqual(response.data['events'][0]['status'], 'unknown_status')
        self.assertEqual(response.data['events'][0]['error_code'], 'unknown_error')
        self.assertNotIn('material_alias', response.data['runs'][0]['diagnostics'])
        self.assertNotIn('PRIVATE', str(response.data))
        with self.settings(KILLBOARD_COLLECTION_ENABLED=True):
            status = self.client.get('/api/killboard/status/')
        self.assertEqual(status.data['state'], 'unknown_status')
        self.assertEqual(status.data['stop_reason'], 'service_rejected')
        self.assertNotIn('PRIVATE', str(status.data))

    def test_collector_summary_window_validation_is_bounded_and_does_not_echo_remote_input(self):
        for value in ('0', '169', '-1', '1.5', '999999999999999999', 'PRIVATE', '\u0661'):
            with self.subTest(value=value):
                response = self.client.get('/api/killboard/collector/logs/', {'window_hours': value})
                self.assertEqual(response.status_code, 400)
                self.assertNotIn('PRIVATE', str(response.data))
        response = self.client.get('/api/killboard/collector/logs/?window_hours=168')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['summary']['window']['hours'], 168)

    def test_owner_check_reloads_active_email_and_fails_closed_when_setting_missing(self):
        self.client.force_authenticate(self.owner)
        get_user_model().objects.filter(pk=self.owner.pk).update(email='changed@example.com')
        self.assertEqual(self.client.get('/api/killboard/reports/').status_code, 403)
        get_user_model().objects.filter(pk=self.owner.pk).update(email='owner@example.com', is_active=False)
        self.assertEqual(self.client.get('/api/killboard/reports/').status_code, 403)
        with self.settings(KILLBOARD_OWNER_EMAIL=''):
            get_user_model().objects.filter(pk=self.owner.pk).update(is_active=True)
            self.assertEqual(self.client.get('/api/killboard/reports/').status_code, 403)

    def test_detail_prefetches_participants_and_items_with_explicit_status(self):
        response = self.client.get('/api/killboard/reports/19748417/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['participants_status'], 'provided')
        self.assertEqual(response.data['equipment_status'], 'provided')
        self.assertEqual(response.data['participants'][0]['is_final_blow'], True)
        self.assertEqual(response.data['items'][0]['quantity_unknown'], 5)

    def test_detail_exposes_only_exact_verified_image_urls(self):
        report = KillReport.objects.get(kill_id=19748417)
        report.ship_type_id = 10500000601
        report.save(update_fields=['ship_type_id'])
        participant = report.participants.get()
        participant.ship_type_id = 10500000601
        participant.save(update_fields=['ship_type_id'])
        item = report.items.get()
        item.type_id = 10500000601
        item.save(update_fields=['type_id'])
        response = self.client.get('/api/killboard/reports/19748417/')
        self.assertRegex(response.data['ship_image_url'], r'^/images/game-items/[0-9a-f]{64}\.png$')
        self.assertEqual(response.data['participants'][0]['ship_image_url'], response.data['ship_image_url'])
        self.assertEqual(response.data['items'][0]['image_url'], response.data['ship_image_url'])
        self.assertEqual(response.data['items'][0]['image_role'], 'item-icon')

    def test_filters_validate_and_status_is_explicitly_not_configured(self):
        filters = self.client.get('/api/killboard/filters/')
        self.assertEqual(filters.status_code, 200)
        self.assertEqual(filters.data['ship_classes'][0]['key'], 'battleship')
        status = self.client.get('/api/killboard/status/')
        self.assertEqual(status.status_code, 200)
        self.assertEqual(status.data['state'], 'not_configured')
        invalid = self.client.get('/api/killboard/reports/?page_size=1000')
        self.assertEqual(invalid.status_code, 400)

    def test_participant_ship_names_are_enriched_without_extra_queries(self):
        report = KillReport.objects.get(kill_id=19748417)
        participant = report.participants.get()
        participant.ship_type_id = 10500000601
        participant.save(update_fields=['ship_type_id'])
        KillParticipant.objects.bulk_create([
            KillParticipant(report=report, character_name=f'角色{index}',
                            ship_type_id=10500000408, source_index=index + 1)
            for index in range(30)
        ])
        # Authentication, report, participants and equipment; an installed
        # TacticalBoard catalog adds one batched system-security lookup.
        # Participant ship enrichment must not add a query per row.
        expected_queries = 5 if apps.is_installed('TacticalBoard') else 4
        with self.assertNumQueries(expected_queries):
            response = self.client.get('/api/killboard/reports/19748417/')
        self.assertEqual(response.status_code, 200)
        by_ship = {row['ship_type_id']: row['ship_name'] for row in response.data['participants']}
        self.assertEqual(by_ship['10500000601'], '元帅级')
        self.assertEqual(by_ship['10500000408'], '万王宝座级海军型')
        participant.refresh_from_db()
        self.assertEqual(participant.ship_type_id, 10500000601)

    def test_unmapped_participant_ship_keeps_raw_id_and_empty_name(self):
        response = self.client.get('/api/killboard/reports/19748417/')
        row = response.data['participants'][0]
        self.assertEqual(row['ship_type_id'], '123')
        self.assertEqual(row.get('ship_name'), '')

    def test_unknown_report_is_404_and_write_methods_are_not_available(self):
        self.assertEqual(self.client.get('/api/killboard/reports/1/').status_code, 404)
        self.assertEqual(self.client.post('/api/killboard/reports/').status_code, 405)

    def test_status_reports_enabled_pause_and_candidate_without_private_paths(self):
        from Killboard.models import ProbeCursor, epoch_ms
        cursor = ProbeCursor.objects.create(name='latest', next_probe_id=200, candidate_id=199,
                                            candidate_at_ms=epoch_ms(), pause_reason='rate_limited',
                                            cooldown_until_ms=epoch_ms()+100000)
        with self.settings(KILLBOARD_COLLECTION_ENABLED=True):
            status = self.client.get('/api/killboard/status/').data
        self.assertFalse(status['collection_enabled'])
        self.assertTrue(status['configured'])
        self.assertEqual(status['state'], 'cooldown')
        self.assertEqual(status['candidate_kill_id'], '199')
        self.assertFalse(status['coverage_verified'])
        self.assertNotIn('session_files', status)

    def test_id_only_system_uses_verified_universe_name(self):
        from unittest.mock import patch
        from Killboard.security import security_meta
        with patch('Killboard.views.system_security_map', return_value={
            '30000299': {**security_meta(-0.25), 'system_name': '5T-KM3'}}):
            report = self.client.get('/api/killboard/reports/19748417/').data
        self.assertEqual(report['system_name'], '测试星系')
        KillReport.objects.filter(kill_id=19748417).update(system_name='')
        with patch('Killboard.views.system_security_map', return_value={
            '30000299': {**security_meta(-0.25), 'system_name': '5T-KM3'}}):
            report = self.client.get('/api/killboard/reports/19748417/').data
        self.assertEqual(report['system_name'], '5T-KM3')
