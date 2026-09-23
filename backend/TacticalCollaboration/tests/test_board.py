import json
from datetime import timedelta
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient
from TacticalBoard.models import BoardConstellations, BoardRegions, BoardStargates, BoardSystems
from TacticalCollaboration.models import Membership, Organization


class BoardCase(TestCase):
    @classmethod
    def setUpClass(cls):
        # Static production tables are unmanaged. Create only missing test tables.
        cls.created_tables = []
        existing = connection.introspection.table_names()
        with connection.schema_editor() as editor:
            for model in (BoardRegions, BoardConstellations, BoardSystems, BoardStargates):
                if model._meta.db_table not in existing:
                    editor.create_model(model)
                    cls.created_tables.append(model)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            for model in reversed(cls.created_tables):
                editor.delete_model(model)

    def setUp(self):
        cache.clear()
        User = get_user_model()
        self.owner = User.objects.create_user(username='owner')
        self.commander = User.objects.create_user(username='commander')
        self.scout = User.objects.create_user(username='scout')
        self.other = User.objects.create_user(username='other')
        self.org = Organization.objects.create(name='战区', founder=self.owner)
        for user, role in [(self.owner, 'founder'), (self.commander, 'commander'), (self.scout, 'scout'), (self.other, 'scout')]:
            Membership.objects.create(organization=self.org, user=user, role=role)
        for rid in (1, 2, 3, 4):
            BoardRegions.objects.create(region_id=rid, name=f'R{rid}', zh_name=f'星域{rid}')
            BoardConstellations.objects.create(constellation_id=rid, region_id=rid, name=f'C{rid}', zh_name=f'星座{rid}', x=rid, y=0, z=rid)
            BoardSystems.objects.create(system_id=rid, constellation_id=rid, name=f'S{rid}', zh_name=f'星系{rid}', x=rid, y=0, z=rid, security_status=0.5)
        for sid, target in [(1, 2), (2, 3), (3, 4)]:
            BoardStargates.objects.create(stargate_id=sid, system_id=sid, name='gate', destination_system_id=target)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.connection_id = str(uuid4())

    def url(self, path):
        return f'/api/tactical/organizations/{self.org.pk}/{path}/'

    def post(self, path, data):
        return self.client.post(self.url(path), json.dumps(data), content_type='application/json')

    def admit(self, user=None, connection_id=None):
        if user:
            self.client.force_authenticate(user)
        self.connection_id = connection_id or str(uuid4())
        response = self.post('presence', {'connection_id': self.connection_id})
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def cmd(self, action, **kwargs):
        data = {'request_id': str(uuid4()), 'action': action, **kwargs}
        if action.startswith(('report.', 'force.', 'scope.')):
            data.setdefault('connection_id', self.connection_id)
        return self.post('commands', data)

    def content(self, **kwargs):
        return {'system_id': 1, 'people': 80, 'ships': {'cruiser': 30, 'titan': None},
                'notes': '观测', 'observed_at': '2026-01-01T10:00:00Z', **kwargs}

    def snapshot(self):
        return self.client.get(self.url('snapshot'), {'connection_id': self.connection_id})


class PresenceTests(BoardCase):
    def test_display_name_prefers_game_id_then_full_name_then_username(self):
        from TacticalCollaboration.services import display_name
        self.owner.first_name, self.owner.last_name = '北境', '统帅'
        self.assertEqual(display_name(self.owner), '北境 统帅')
        self.owner.eve_id = '飞行员七'
        self.assertEqual(display_name(self.owner), '飞行员七')
        self.owner.eve_id = ''
        self.owner.first_name = self.owner.last_name = ''
        self.assertEqual(display_name(self.owner), 'owner')

    def test_roster_uses_last_heartbeat_and_latest_report_submission_not_observation(self):
        from TacticalCollaboration.models import ConnectionLease, Report, ReportRevision
        self.admit(self.scout)
        report = self.cmd('report.create', report_kind='system_count', **self.content(ships={'cruiser': None, 'titan': None})).data['result']
        submitted = timezone.now() - timedelta(minutes=2)
        ReportRevision.objects.filter(report_id=report['id']).update(created_at=submitted)
        # Command-layer confirmation changes current Report.updated_at; it must
        # not falsely make this scout appear to have submitted fresh intelligence.
        Report.objects.filter(pk=report['id']).update(updated_at=timezone.now())
        ConnectionLease.objects.filter(user=self.scout).update(last_seen_at=timezone.now() - timedelta(seconds=31))
        self.client.force_authenticate(self.commander)
        roster = self.client.get(self.url('members')).data['online']
        scout = next(member for member in roster if member['user_id'] == self.scout.pk)
        self.assertEqual(scout.get('connection_status'), 'reconnecting')
        self.assertEqual(scout.get('last_reported_at'), submitted.isoformat())
        ConnectionLease.objects.filter(user=self.scout).update(last_seen_at=timezone.now())
        roster = self.client.get(self.url('members')).data['online']
        self.assertEqual(roster[0]['connection_status'], 'online')
        self.client.force_authenticate(self.scout)
        self.assertNotIn('online', self.snapshot().data)
        self.assertNotIn('last_reported_at', json.dumps(self.snapshot().data))

    def test_socket_generation_supersedes_old_transport_without_revoking_http_lease(self):
        from TacticalCollaboration import services
        from rest_framework.exceptions import PermissionDenied
        self.admit()
        self.assertTrue(callable(getattr(services, 'claim_socket', None)), 'durable socket-generation claim missing')
        first, second = str(uuid4()), str(uuid4())
        services.claim_socket(self.owner, self.org.pk, self.connection_id, first)
        self.assertEqual(services.socket_snapshot(self.owner, self.org.pk, self.connection_id, first)['online_count'], 1)
        services.claim_socket(self.owner, self.org.pk, self.connection_id, second)
        with self.assertRaises(PermissionDenied):
            services.socket_snapshot(self.owner, self.org.pk, self.connection_id, first)
        with self.assertRaises(PermissionDenied):
            services.socket_heartbeat(self.owner, self.org.pk, self.connection_id, first)
        # HTTP renewing the logical tab must not reactivate the superseded WS.
        services.admit(self.owner, self.org.pk, self.connection_id)
        self.assertEqual(services.socket_snapshot(self.owner, self.org.pk, self.connection_id, second)['online_count'], 1)
        self.assertEqual(self.snapshot().status_code, 200)

    def test_socket_claim_rejects_replayed_flood_and_expired_or_removed_members(self):
        from TacticalCollaboration import services
        from rest_framework.exceptions import PermissionDenied, Throttled
        self.admit(self.scout)
        self.assertTrue(callable(getattr(services, 'claim_socket', None)), 'durable socket-generation claim missing')
        latest = None
        for _ in range(12):
            latest = str(uuid4())
            services.claim_socket(self.scout, self.org.pk, self.connection_id, latest)
        with self.assertRaises(Throttled):
            services.claim_socket(self.scout, self.org.pk, self.connection_id, str(uuid4()))
        # A rejected replacement leaves the most recently admitted socket live.
        services.socket_heartbeat(self.scout, self.org.pk, self.connection_id, latest)
        from TacticalCollaboration.models import ConnectionLease
        ConnectionLease.objects.filter(connection_id=self.connection_id).update(expires_at=timezone.now() - timedelta(seconds=1))
        with self.assertRaises(PermissionDenied):
            services.socket_heartbeat(self.scout, self.org.pk, self.connection_id, latest)
        Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
        with self.assertRaises(PermissionDenied):
            services.claim_socket(self.scout, self.org.pk, self.connection_id, str(uuid4()))

    def test_inactive_user_stale_actor_rejected(self):
        from TacticalCollaboration.services import snapshot
        from rest_framework.exceptions import PermissionDenied
        self.admit()
        get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
        with self.assertRaises(PermissionDenied):
            snapshot(self.owner, self.org.pk, self.connection_id)

    def test_requires_admission_and_separates_count_from_roster(self):
        self.assertEqual(self.snapshot().status_code, 403)
        self.admit(self.scout)
        state = self.snapshot()
        self.assertEqual(state.status_code, 200)
        self.assertEqual(state.data['online_count'], 1)
        self.assertNotIn('online', state.data)
        self.admit(self.owner)
        state = self.snapshot().data
        self.assertEqual(state['online_count'], 2)
        self.assertEqual(len(state['online']), 2)
        self.assertNotIn('email', json.dumps(state))

    def test_same_user_tabs_count_once_and_close_only_owned_tab(self):
        first = self.admit().data['connection_id']
        second = self.admit().data['connection_id']
        self.assertEqual(self.snapshot().data['online_count'], 1)
        self.client.delete(self.url('presence'), {'connection_id': first}, format='json')
        self.assertEqual(self.snapshot().status_code, 200)
        self.client.force_authenticate(self.scout)
        self.assertEqual(self.post('presence', {'connection_id': second}).status_code, 409)
        self.client.delete(self.url('presence'), {'connection_id': second}, format='json')
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.snapshot().status_code, 200)

    def test_four_connection_limit_and_expiry(self):
        for _ in range(4):
            self.admit()
        self.assertEqual(self.post('presence', {'connection_id': str(uuid4())}).status_code, 429)
        from TacticalCollaboration.models import ConnectionLease
        ConnectionLease.objects.all().update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.snapshot().status_code, 403)
        self.admit()
        self.assertEqual(self.snapshot().data['online_count'], 1)

    def test_distinct_account_limit_100_and_existing_renew(self):
        from TacticalCollaboration.models import ConnectionLease
        users = [get_user_model().objects.create_user(username=f'capacity{i}') for i in range(99)]
        Membership.objects.bulk_create([Membership(organization=self.org, user=u) for u in users])
        ConnectionLease.objects.bulk_create([ConnectionLease(organization=self.org, user=u, connection_id=uuid4(), expires_at=timezone.now() + timedelta(seconds=60)) for u in users])
        self.admit(self.owner)
        self.assertEqual(self.snapshot().data['online_count'], 100)
        self.assertEqual(self.post('presence', {'connection_id': self.connection_id}).status_code, 200)
        self.client.force_authenticate(self.scout)
        full = self.post('presence', {'connection_id': str(uuid4())})
        self.assertEqual(full.status_code, 409)
        self.assertEqual(full.data.get('code'), 'board_full')

    def test_removal_immediately_revokes_all_tabs_and_retains_membership(self):
        self.admit(self.scout)
        scout_connection = self.connection_id
        self.client.force_authenticate(self.commander)
        member = Membership.objects.get(organization=self.org, user=self.scout)
        self.assertEqual(self.cmd('member.remove', member_id=member.id).status_code, 200)
        self.client.force_authenticate(self.scout)
        self.assertEqual(self.post('presence', {'connection_id': scout_connection}).status_code, 403)
        self.assertEqual(self.snapshot().status_code, 403)
        self.client.force_authenticate(self.commander)
        roster = self.client.get(self.url('members')).data
        self.assertEqual(roster['online_count'], 0)
        self.assertEqual(next(m for m in roster['members'] if m['id'] == member.id)['status'], 'removed')


class ReportForceTests(BoardCase):
    def test_count_report_moves_without_changing_observation_or_losing_history(self):
        from TacticalCollaboration.models import ReportRevision
        self.admit(self.scout)
        report = self.cmd('report.create', report_kind='system_count',
                          **self.content(ships={'cruiser': None})).data['result']
        moved = self.cmd('report.move', report_id=report['id'], expected_version=1,
                         destination_system_id=4)
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual((moved.data['result']['system_id'], moved.data['result']['people'],
                          moved.data['result']['observed_at'], moved.data['result']['version']),
                         (4, 80, report['observed_at'], 2))
        self.assertEqual(ReportRevision.objects.filter(report_id=report['id']).count(), 2)
        self.assertEqual(self.cmd('report.move', report_id=report['id'], expected_version=1,
                                  destination_system_id=3).status_code, 409)
        self.assertEqual(self.snapshot().data['reports'][0]['system_id'], 4)
        self.assertEqual(self.cmd('report.withdraw', report_id=report['id'], expected_version=2).status_code, 200)

    def test_count_report_move_and_withdraw_permissions_and_version(self):
        from TacticalCollaboration.models import ReportRevision
        self.admit(self.scout)
        report = self.cmd('report.create', report_kind='system_count',
                          **self.content(ships={'cruiser': None})).data['result']
        self.admit(self.other)
        self.assertEqual(self.cmd('report.move', report_id=report['id'], expected_version=1,
                                  destination_system_id=2).status_code, 403)
        self.assertEqual(self.cmd('report.withdraw', report_id=report['id'], expected_version=1).status_code, 403)
        self.admit(self.commander)
        moved = self.cmd('report.move', report_id=report['id'], expected_version=1,
                         destination_system_id=2)
        self.assertEqual(moved.status_code, 200, moved.content)
        withdrawn = self.cmd('report.withdraw', report_id=report['id'], expected_version=2)
        self.assertEqual(withdrawn.status_code, 200, withdrawn.content)
        self.assertEqual((withdrawn.data['result']['status'], withdrawn.data['result']['version']), ('withdrawn', 3))
        self.assertEqual(ReportRevision.objects.filter(report_id=report['id']).count(), 3)
        self.assertEqual(self.cmd('report.withdraw', report_id=report['id'], expected_version=2).status_code, 409)
        self.assertEqual(self.cmd('report.move', report_id=report['id'], expected_version=3,
                                  destination_system_id=3).status_code, 409)
        self.admit(self.scout)
        self.assertEqual(self.cmd('report.update', report_id=report['id'], expected_version=3,
                                  **self.content(ships={'cruiser': None})).status_code, 409)
        self.assertEqual(self.snapshot().data['reports'][0]['status'], 'withdrawn')

    def test_count_only_commands_cannot_change_fleet_observations(self):
        self.admit(self.commander)
        report = self.cmd('report.create', **self.content()).data['result']
        self.assertEqual(self.cmd('report.move', report_id=report['id'], expected_version=1,
                                  destination_system_id=2).status_code, 400)
        self.assertEqual(self.cmd('report.withdraw', report_id=report['id'], expected_version=1).status_code, 400)

    def test_archive_requires_command_role_and_current_version_preserves_history(self):
        from TacticalCollaboration.models import AuditLog, Force, ForceSource, ReportRevision
        self.admit()
        report = self.cmd('report.create', **self.content()).data['result']
        force = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='撤离部队').data['result']
        self.admit(self.scout)
        self.assertEqual(self.cmd('force.archive', force_id=force['id'], expected_version=1).status_code, 403)
        self.admit(self.commander)
        self.assertEqual(self.cmd('force.archive', force_id=force['id'], expected_version=2).status_code, 409)
        request_id = str(uuid4())
        response = self.cmd('force.archive', force_id=force['id'], expected_version=1, request_id=request_id)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual({key: value for key, value in response.data['result'].items() if key != 'state_version'},
                         {'id': force['id'], 'version': 2, 'archived': True})
        replay = self.cmd('force.archive', force_id=force['id'], expected_version=1, request_id=request_id)
        self.assertEqual(replay.data, response.data)
        self.assertEqual(self.snapshot().data['forces'], [])
        self.assertEqual(Force.objects.filter(pk=force['id']).count(), 1)
        self.assertEqual(ForceSource.objects.filter(force_id=force['id']).count(), 1)
        self.assertEqual(ReportRevision.objects.filter(report_id=report['id']).count(), 1)
        self.assertEqual(AuditLog.objects.filter(action='force.archive').count(), 1)
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=2, destination_system_id=2, kind='gate_move').status_code, 409)
        self.assertEqual(self.cmd('force.update', force_id=force['id'], expected_version=2, name='复活', side='enemy', **self.content()).status_code, 409)
        self.assertEqual(self.cmd('force.archive', force_id=force['id'], expected_version=2).status_code, 409)
        next_report = self.cmd('report.create', **self.content()).data['result']
        self.assertEqual(self.cmd('report.confirm', report_id=next_report['id'], expected_version=1, name='复活', force_id=force['id'], force_expected_version=2).status_code, 409)
        self.admit(self.scout)
        self.assertEqual(self.snapshot().data['forces'], [])

    def test_archive_needs_live_lease_and_receipt_cannot_bypass_demotion(self):
        self.admit(self.commander)
        force = self.cmd('force.create', name='秘密撤离', side='friendly', **self.content()).data['result']
        request_id = str(uuid4())
        response = self.cmd('force.archive', force_id=force['id'], expected_version=1, request_id=request_id)
        self.assertEqual(response.status_code, 200, response.content)
        member = Membership.objects.get(organization=self.org, user=self.commander)
        self.client.force_authenticate(self.owner)
        self.cmd('member.role', member_id=member.id, role='scout')
        self.client.force_authenticate(self.commander)
        self.assertEqual(self.cmd('force.archive', force_id=force['id'], expected_version=1, request_id=request_id).status_code, 403)
        self.client.force_authenticate(self.owner)
        self.connection_id = str(uuid4())
        self.assertEqual(self.cmd('force.archive', force_id=force['id'], expected_version=2).status_code, 403)

    def test_duplicate_request_creates_once_mismatched_payload_conflicts(self):
        self.admit()
        rid = str(uuid4())
        result = self.cmd('report.create', request_id=rid, **self.content())
        again = self.cmd('report.create', request_id=rid, **self.content())
        self.assertEqual(result.data, again.data)
        self.assertEqual(self.cmd('report.create', request_id=rid, **self.content(people=20)).status_code, 409)
        self.assertEqual(len(self.snapshot().data['reports']), 1)

    def test_corrected_report_requires_explicit_replacement_and_preserves_adoption(self):
        self.admit()
        report = self.cmd('report.create', **self.content()).data['result']
        force = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='舰队').data['result']
        self.cmd('report.update', report_id=report['id'], expected_version=1, **self.content(people=7))
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=2, name='舰队').status_code, 409)
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=2, name='舰队', force_id=force['id'], force_expected_version=1).status_code, 200)
        from TacticalCollaboration.models import ForceSource
        self.assertEqual(ForceSource.objects.count(), 2)

    def test_manual_correction_reason_is_persisted_in_audit(self):
        from TacticalCollaboration.models import AuditLog
        self.admit()
        force = self.cmd('force.create', name='敌方', side='enemy', **self.content()).data['result']
        self.cmd('force.move', force_id=force['id'], expected_version=1, destination_system_id=4, kind='correction', reason='斥候核实')
        audit = AuditLog.objects.filter(action='force.move').get()
        self.assertEqual(audit.metadata['reason'], '斥候核实')

    def test_promoted_scout_can_no_longer_be_removed_by_commander(self):
        member = Membership.objects.get(organization=self.org, user=self.scout)
        self.cmd('member.role', member_id=member.id, role='commander')
        self.client.force_authenticate(self.commander)
        self.assertEqual(self.cmd('member.remove', member_id=member.id).status_code, 403)
        self.assertEqual(self.cmd('member.role', member_id=member.id, role='scout').status_code, 403)

    def test_removed_member_requires_founder_restore_and_retains_report_author(self):
        self.admit(self.scout)
        self.cmd('report.create', report_kind='system_count', **self.content(ships={'cruiser': None, 'titan': None}))
        member = Membership.objects.get(organization=self.org, user=self.scout)
        self.client.force_authenticate(self.commander)
        self.cmd('member.remove', member_id=member.id)
        self.assertEqual(self.cmd('member.restore', member_id=member.id).status_code, 403)
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.cmd('member.restore', member_id=member.id).status_code, 200)
        member.refresh_from_db()
        self.assertEqual((member.status, member.role), ('active', 'scout'))
        self.admit(self.scout)
        self.assertEqual(self.snapshot().data['reports'][0]['author_id'], self.scout.id)

    def test_old_year_rejected_for_mysql_compatibility(self):
        self.admit()
        self.assertEqual(self.cmd('report.create', **self.content(observed_at='0001-01-01T00:00:00Z')).status_code, 400)

    def test_scout_sees_all_enemy_reports_no_friendly_metadata(self):
        self.admit(self.owner)
        friendly = self.cmd('force.create', name='SECRET_BASE', side='friendly', **self.content(notes='SECRET_NOTE'))
        self.assertEqual(friendly.status_code, 200, friendly.content)
        self.cmd('force.create', name='敌方', side='enemy', **self.content())
        self.cmd('report.create', **self.content(notes='COMMAND_RAW'))
        self.admit(self.other)
        self.cmd('report.create', report_kind='system_count', **self.content(notes='OTHER_SCOUT_RAW', ships={'cruiser': None, 'titan': None}))
        self.admit(self.scout)
        self.cmd('report.create', report_kind='system_count', **self.content(notes='SCOUT_OWN', ships={'cruiser': None, 'titan': None}))
        state = self.snapshot().data
        encoded = json.dumps(state)
        self.assertNotIn('SECRET', encoded)
        self.assertEqual(len(state['forces']), 1)
        self.assertEqual({report['notes'] for report in state['reports']},
                         {'COMMAND_RAW', 'OTHER_SCOUT_RAW', 'SCOUT_OWN'})
        # Only the public current observation pointer/author is exposed, never
        # private adoption history, command identities, or audit metadata.
        self.assertEqual(set(state['forces'][0]), {
            'id', 'version', 'system_id', 'system_name', 'people', 'ships', 'notes',
            'observed_at', 'updated_at', 'name', 'side', 'source_report_id',
            'source_author_id', 'source_author_name', 'in_scope',
        })
        self.assertIsNone(state['forces'][0]['source_report_id'])
        self.assertNotIn('confirmer', encoded)
        self.assertNotIn('metadata', encoded)
        self.assertNotIn('online', state)

    def test_pending_report_with_author_is_immediate_in_http_and_socket_snapshots(self):
        from TacticalCollaboration import services
        self.admit(self.scout)
        scout_connection = self.connection_id
        generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, scout_connection, generation)
        self.assertEqual(services.socket_snapshot(self.scout, self.org.pk, scout_connection, generation)['reports'], [])
        self.admit(self.other)
        report = self.cmd('report.create', report_kind='system_count', **self.content(notes='SHARED_PENDING', ships={'cruiser': None, 'titan': None})).data['result']
        report_snapshot = {key: value for key, value in report.items() if key != 'state_version'}
        for actor in (self.owner, self.commander, self.scout):
            with self.subTest(role=actor.username):
                self.admit(actor)
                state = self.snapshot().data
                self.assertEqual(state['reports'], [{**report_snapshot, 'in_scope': False}])
                self.assertEqual(state['reports'][0]['status'], 'pending')
                self.assertEqual(state['reports'][0]['author_id'], self.other.pk)
                self.assertEqual(state['reports'][0]['author_name'], self.other.username)
                self.assertEqual(state['forces'], [])
        state = services.socket_snapshot(self.scout, self.org.pk, scout_connection, generation)
        self.assertEqual(state['reports'], [{**report_snapshot, 'in_scope': False}])
        self.assertNotIn('online', state)

    def test_shared_report_visibility_does_not_grant_edit_permission(self):
        self.admit(self.commander)
        other_report = self.cmd('report.create', **self.content()).data['result']
        self.admit(self.scout)
        own_report = self.cmd('report.create', report_kind='system_count', **self.content(ships={'cruiser': None, 'titan': None})).data['result']
        visible_ids = {report['id'] for report in self.snapshot().data['reports']}
        self.assertEqual(visible_ids, {other_report['id'], own_report['id']})
        denied = self.cmd('report.update', report_id=other_report['id'], expected_version=1,
                          **self.content(people=9))
        self.assertEqual(denied.status_code, 403)
        allowed = self.cmd('report.update', report_id=own_report['id'], expected_version=1,
                           **self.content(people=9, ships={'cruiser': None, 'titan': None}))
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.data['result']['version'], 2)
        self.assertEqual(self.cmd('report.update', report_id=own_report['id'], expected_version=1,
                                  **self.content(people=10, ships={'cruiser': None, 'titan': None})).status_code, 409)

    def test_shared_enemy_report_does_not_expand_linked_friendly_deployment(self):
        from TacticalCollaboration import services
        self.admit(self.owner)
        report = self.cmd('report.create', **self.content(notes='ORIGINAL_ENEMY_OBSERVATION')).data['result']
        force = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='敌方').data['result']
        changed = self.cmd('force.update', force_id=force['id'], expected_version=1,
                           name='SECRET_FRIENDLY', side='friendly',
                           **self.content(system_id=4, notes='SECRET_LOCATION', people=654321))
        self.assertEqual(changed.status_code, 200)
        self.admit(self.scout)
        generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, self.connection_id, generation)
        states = [self.snapshot().data,
                  services.socket_snapshot(self.scout, self.org.pk, self.connection_id, generation)]
        for state in states:
            with self.subTest(transport='http' if state is states[0] else 'socket'):
                self.assertEqual(state['forces'], [])
                self.assertEqual(len(state['reports']), 1)
                visible = state['reports'][0]
                self.assertEqual((visible['id'], visible['system_id'], visible['people'], visible['notes']),
                                 (report['id'], 1, 80, 'ORIGINAL_ENEMY_OBSERVATION'))
                self.assertEqual(set(visible), {'id', 'version', 'system_id', 'system_name', 'people', 'ships',
                                               'notes', 'observed_at', 'updated_at', 'author_id', 'author_name', 'status', 'report_kind', 'in_scope'})
                self.assertNotIn('SECRET', json.dumps(state))
                self.assertNotIn('654321', json.dumps(state))

    def test_report_author_only_versioned_revisions_and_confirmation_does_not_follow_correction(self):
        from TacticalCollaboration.models import Force, ForceSource, ReportRevision
        self.admit(self.commander)
        report = self.cmd('report.create', **self.content()).data['result']
        self.assertEqual(report['version'], 1)
        self.admit(self.owner)
        forbidden = self.cmd('report.update', report_id=report['id'], expected_version=1, **self.content(people=9))
        self.assertEqual(forbidden.status_code, 403)
        self.admit(self.commander)
        force = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='敌舰队').data['result']
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='重复').status_code, 409)
        self.admit(self.commander)
        changed = self.cmd('report.update', report_id=report['id'], expected_version=1, **self.content(people=75))
        self.assertEqual(changed.status_code, 200, changed.content)
        self.assertEqual(changed.data['result']['status'], 'corrected')
        self.assertEqual(Force.objects.get(pk=force['id']).people, 80)
        self.assertEqual(ReportRevision.objects.filter(report_id=report['id']).count(), 2)
        self.assertEqual(ForceSource.objects.get(force_id=force['id']).revision.version, 1)
        self.assertEqual(self.cmd('report.update', report_id=report['id'], expected_version=1, **self.content()).status_code, 409)

    def test_confirm_into_existing_requires_version_replaces_not_sums(self):
        self.admit(self.commander)
        force = self.cmd('force.create', name='敌方', side='enemy', **self.content()).data['result']
        report = self.cmd('report.create', **self.content(people=75)).data['result']
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='目标', force_id=force['id']).status_code, 400)
        result = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='目标', force_id=force['id'], force_expected_version=1)
        self.assertEqual(result.status_code, 200, result.content)
        self.assertEqual(result.data['result']['people'], 75)

    def test_move_validates_adjacency_preserves_identity_observed_time_and_counts(self):
        self.admit()
        force = self.cmd('force.create', name='敌方', side='enemy', **self.content()).data['result']
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=1, destination_system_id=4, kind='gate_move').status_code, 400)
        move = self.cmd('force.move', force_id=force['id'], expected_version=1, destination_system_id=2, kind='gate_move')
        self.assertEqual(move.status_code, 200, move.content)
        updated = move.data['result']
        self.assertEqual((updated['id'], updated['people'], updated['observed_at']), (force['id'], force['people'], force['observed_at']))
        self.assertEqual(updated['version'], 2)
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=1, destination_system_id=3, kind='gate_move').status_code, 409)
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=2, destination_system_id=4, kind='correction').status_code, 400)
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=2, destination_system_id=4, kind='correction', reason='核实位置').status_code, 200)

    def test_scout_commands_cannot_modify_or_confirm_forces(self):
        self.admit(self.scout)
        self.assertEqual(self.cmd('force.create', name='敌方', side='enemy', **self.content()).status_code, 403)
        report = self.cmd('report.create', report_kind='system_count', **self.content(ships={'cruiser': None, 'titan': None})).data['result']
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='x').status_code, 403)

    def test_live_lease_required_on_all_tactical_writes(self):
        self.assertEqual(self.cmd('report.create', **self.content()).status_code, 403)
        self.assertEqual(self.cmd('force.create', name='敌方', side='enemy', **self.content()).status_code, 403)
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=0).status_code, 403)

    def test_bad_numbers_unknown_keys_bad_time_and_surrogates_rejected(self):
        self.admit(self.scout)
        for invalid in [{'people': True}, {'people': -1}, {'ships': {'titan': 1.5}}, {'ships': {'hack': 1}},
                        {'notes': '\ud800'}, {'observed_at': 'tomorrow'}, {'observed_at': '2999-01-01T00:00:00Z'},
                        {'system_id': 999}, {'people': 1000001}]:
            with self.subTest(invalid=invalid):
                payload = self.content(ships={'cruiser': None, 'titan': None})
                payload.update(invalid)
                self.assertEqual(self.cmd('report.create', report_kind='system_count',
                                          **payload).status_code, 400)

    def test_unknown_remains_null_and_zero_is_not_unknown(self):
        self.admit()
        response = self.cmd('report.create', **self.content(people=None, ships={'titan': None, 'cruiser': 0}))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(response.data['result']['people'])
        self.assertEqual(response.data['result']['ships'], {'titan': None, 'cruiser': 0})

    def test_replay_after_demotion_cannot_return_private_force(self):
        self.admit(self.commander)
        request_id = str(uuid4())
        first = self.cmd('force.create', request_id=request_id, name='SECRET', side='friendly', **self.content())
        self.assertEqual(first.status_code, 200)
        commander_connection = self.connection_id
        self.client.force_authenticate(self.owner)
        member = Membership.objects.get(user=self.commander, organization=self.org)
        self.cmd('member.role', member_id=member.id, role='scout')
        self.client.force_authenticate(self.commander)
        self.connection_id = commander_connection
        retry = self.cmd('force.create', request_id=request_id, name='SECRET', side='friendly', **self.content())
        self.assertEqual(retry.status_code, 403)
        self.assertNotIn('SECRET', json.dumps(self.snapshot().data))

    def test_cross_organization_object_ids_never_authorized(self):
        self.admit()
        force = self.cmd('force.create', name='敌方', side='enemy', **self.content()).data['result']
        another = Organization.objects.create(name='another', founder=self.owner)
        Membership.objects.create(organization=another, user=self.owner, role='founder')
        self.org = another
        self.admit()
        self.assertEqual(self.cmd('force.move', force_id=force['id'], expected_version=1, destination_system_id=2, kind='gate_move').status_code, 404)


class ScopeTests(BoardCase):
    def test_optional_nonfinite_fields_are_null_and_cache_remains_json_safe(self):
        self.org.region_ids = [1]
        self.org.save(update_fields=['region_ids'])
        for model, field, key in ((BoardSystems, 'y', 'systems'), (BoardSystems, 'security_status', 'systems'),
                                  (BoardConstellations, 'x', 'constellations')):
            with self.subTest(field=field):
                cache.clear()
                original = getattr(model.objects.get(pk=1), field)
                model.objects.filter(pk=1).update(**{field: float('inf')})
                for _ in range(2):
                    response = self.client.get(self.url('map'))
                    self.assertEqual(response.status_code, 200)
                    graph = response.json()
                    self.assertIsNone(graph[key][0][field])
                    self.assertEqual(graph['warnings'], [{'code': 'nonfinite_fields', 'count': 1}])
                model.objects.filter(pk=1).update(**{field: original})

    def test_nonfinite_coordinates_do_not_render_and_all_filtered_scope_is_empty(self):
        self.org.region_ids = [1]
        self.org.save(update_fields=['region_ids'])
        for value in (float('inf'), -float('inf'), None):
            with self.subTest(coordinate=value):
                cache.clear()
                BoardSystems.objects.filter(pk=1).update(x=value)
                graph = self.client.get(self.url('map')).data
                self.assertEqual(graph['systems'], [])
                self.assertEqual(graph['stargates'], [])
                self.assertEqual(graph['data_source']['kind'], 'empty')
                self.assertEqual(graph['warnings'], [{'code': 'missing_coordinates', 'count': 1}])

    def test_invalid_internal_coordinate_does_not_remove_other_valid_boundary(self):
        self.org.region_ids = [1, 2]
        self.org.save(update_fields=['region_ids'])
        BoardSystems.objects.filter(pk=2).update(z=None)
        BoardStargates.objects.create(stargate_id=15, system_id=1, destination_system_id=3, name='exit')
        graph = self.client.get(self.url('map')).data
        self.assertEqual([s['system_id'] for s in graph['systems']], [1])
        self.assertEqual(graph['boundary_exits'], [{'system_id': 1, 'destination_system_id': 3, 'destination_name': '星系3'}])

    def test_static_map_declares_source_and_keeps_names_security_and_hierarchy(self):
        self.org.region_ids = [1]
        self.org.save(update_fields=['region_ids'])
        graph = self.client.get(self.url('map')).data
        self.assertIn('data_source', graph)
        self.assertEqual(graph['data_source']['kind'], 'static-board')
        self.assertTrue(graph['data_source']['is_real'])
        system = graph['systems'][0]
        self.assertEqual((system['name'], system['zh_name'], system['security_status']), ('S1', '星系1', .5))
        self.assertEqual((system['region_id'], system['constellation_id']), (1, 1))
        self.assertEqual(graph['warnings'], [])

    def test_empty_map_does_not_claim_real_data_is_loaded(self):
        graph = self.client.get(self.url('map')).data
        self.assertIn('data_source', graph)
        self.assertEqual(graph['data_source']['kind'], 'empty')
        self.assertFalse(graph['data_source']['is_real'])

    def test_local_fixture_and_mixed_maps_never_claim_to_be_real(self):
        BoardSystems.objects.create(system_id=99001001, constellation_id=1, name='演习', x=1, z=1)
        self.org.region_ids = [1]
        self.org.save(update_fields=['region_ids'])
        with self.settings(TACTICAL_LOCAL_DEMO=True):
            graph = self.client.get(self.url('map')).data
            self.assertIn('data_source', graph)
            self.assertEqual(graph['data_source']['kind'], 'mixed')
            self.assertFalse(graph['data_source']['is_real'])
            BoardStargates.objects.filter(system_id=1).delete()
            BoardSystems.objects.filter(pk=1).delete()
            cache.clear()
            graph = self.client.get(self.url('map')).data
            self.assertEqual(graph['data_source']['kind'], 'synthetic-demo')

    def test_static_scope_cache_reuses_graph_but_still_checks_membership(self):
        self.admit()
        self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=1)
        with CaptureQueriesContext(connection) as first:
            self.client.get(self.url('map'))
        with CaptureQueriesContext(connection) as second:
            self.client.get(self.url('map'))
        self.assertLess(len(second), len(first))
        Membership.objects.filter(organization=self.org, user=self.owner).update(status='removed')
        self.assertEqual(self.client.get(self.url('map')).status_code, 403)

    def test_reverse_duplicate_gates_and_null_coordinates_are_safe(self):
        self.admit()
        BoardStargates.objects.create(stargate_id=10, system_id=2, name='reverse', destination_system_id=1)
        BoardSystems.objects.filter(pk=2).update(x=None, z=None)
        self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=1)
        graph = self.client.get(self.url('map')).data
        self.assertEqual(graph['stargates'], [])
        self.assertEqual([s['system_id'] for s in graph['systems']], [1])
        self.assertEqual(graph['warnings'], [{'code': 'missing_coordinates', 'count': 1}])

    def test_empty_scope_returns_no_global_graph(self):
        response = self.client.get(self.url('map'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['systems'], [])
        self.assertEqual(response.data['stargates'], [])

    def test_scope_actual_region_subset_hops_and_boundary_exits(self):
        self.admit()
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=1).status_code, 200)
        graph = self.client.get(self.url('map')).data
        self.assertEqual({s['system_id'] for s in graph['systems']}, {1, 2})
        self.assertEqual(graph['stargates'], [{'system_id': 1, 'destination_system_id': 2}])
        self.assertEqual(graph['boundary_exits'], [{'system_id': 2, 'destination_system_id': 3, 'destination_name': '星系3'}])
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[2], border_hops=0).status_code, 409)
        self.assertEqual(self.cmd('scope.update', expected_version=2, region_ids=[1], border_hops=2).status_code, 200)
        self.assertEqual(len(self.client.get(self.url('map')).data['systems']), 3)

    def test_scope_change_preserves_outside_force_and_scout_cannot_change(self):
        self.admit()
        self.cmd('force.create', name='外部', side='enemy', **self.content(system_id=4))
        self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=0)
        self.assertEqual(len(self.snapshot().data['forces']), 1)
        self.admit(self.scout)
        self.assertEqual(self.cmd('scope.update', expected_version=2, region_ids=[2], border_hops=0).status_code, 403)

    def test_catalog_requires_membership_and_bounded_system_search(self):
        self.assertEqual(self.client.get(self.url('catalog'), {'kind': 'regions'}).status_code, 200)
        search = self.client.get(self.url('catalog'), {'kind': 'systems', 'q': '星系2'})
        self.assertEqual(search.data['results'][0]['id'], 2)
        self.assertEqual(self.client.get(self.url('catalog'), {'kind': 'systems', 'q': ''}).data['results'], [])
        outsider = get_user_model().objects.create_user(username='outsider')
        self.client.force_authenticate(outsider)
        self.assertEqual(self.client.get(self.url('map')).status_code, 403)
