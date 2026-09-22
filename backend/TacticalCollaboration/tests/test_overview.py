from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from TacticalBoard.models import BoardStargates, BoardSystems
from TacticalCollaboration.models import Force, JoinApplication, Membership, Organization
from .test_board import BoardCase


class OverviewTests(BoardCase):
    def create_rows(self):
        self.admit()
        for system_id in range(1, 5):
            self.assertEqual(self.cmd('force.create', name=f'舰队{system_id}', side='enemy',
                                     **self.content(system_id=system_id)).status_code, 200)
            self.assertEqual(self.cmd('report.create', report_kind='system_count',
                                     **self.content(system_id=system_id)).status_code, 200)

    def assert_scope(self, expected):
        state = self.snapshot().data
        graph = self.client.get(self.url('map')).data
        self.assertEqual({row['system_id'] for row in graph['systems']}, set(expected))
        for kind in ('forces', 'reports'):
            self.assertEqual(len(state[kind]), 4)
            for row in state[kind]:
                self.assertIs(type(row.get('in_scope')), bool)
                self.assertEqual(row['in_scope'], row['system_id'] in expected)
        self.assertEqual(state['scope'], graph['scope'])
        self.assertNotIn('systems', state)

    def test_snapshot_scope_matches_map_regions_and_border_hops(self):
        self.create_rows()
        for version, (regions, hops, expected) in enumerate(
                [([1], 0, {1}), ([1], 1, {1, 2}), ([1], 2, {1, 2, 3}),
                 ([1, 4], 0, {1, 4}), ([], 2, set())], start=1):
            with self.subTest(regions=regions, hops=hops):
                response = self.cmd('scope.update', expected_version=version, region_ids=regions, border_hops=hops)
                self.assertEqual(response.status_code, 200, response.content)
                self.assert_scope(expected)

    def test_invalid_coordinates_and_orphan_gates_do_not_mark_drawable_scope(self):
        self.create_rows()
        BoardSystems.objects.filter(pk=2).update(x=None)
        BoardSystems.objects.filter(pk=3).update(z=float('inf'))
        BoardStargates.objects.create(stargate_id=20, system_id=1, destination_system_id=999, name='orphan')
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=2).status_code, 200)
        self.assert_scope({1})
        graph = self.client.get(self.url('map')).data
        self.assertEqual(graph['warnings'], [{'code': 'missing_coordinates', 'count': 2}])

    def test_empty_scope_keeps_all_organization_rows_but_marks_them_outside(self):
        self.create_rows()
        self.assert_scope(set())

    def test_cached_geometry_never_caches_live_scope_version_or_authorization(self):
        self.create_rows()
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=1).status_code, 200)
        self.assert_scope({1, 2})
        self.assertEqual(self.cmd('scope.update', expected_version=2, region_ids=[4], border_hops=0).status_code, 200)
        self.assert_scope({4})
        self.assertEqual(self.cmd('scope.update', expected_version=3, region_ids=[1], border_hops=1).status_code, 200)
        self.assert_scope({1, 2})
        self.assertEqual(self.snapshot().data['scope']['version'], 4)
        Membership.objects.filter(organization=self.org, user=self.owner).update(status='removed')
        self.assertEqual(self.snapshot().status_code, 403)
        self.assertEqual(self.client.get(self.url('map')).status_code, 403)

    def test_scope_annotation_does_not_expand_role_organization_or_archive_visibility(self):
        self.create_rows()
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=0).status_code, 200)
        secret = self.cmd('force.create', name='SECRET_FRIENDLY', side='friendly', **self.content()).data['result']
        outside_org = Organization.objects.create(name='别的组织', founder=self.owner, region_ids=[1])
        Force.objects.create(organization=outside_org, name='SECRET_OTHER_ORG', side='enemy',
                             system_name='星系1', **self.content())
        archived = Force.objects.get(organization=self.org, name='舰队4')
        archived.archived = True
        archived.save(update_fields=['archived'])
        commander_state = self.snapshot().data
        self.assertIn(secret['id'], {row['id'] for row in commander_state['forces']})
        self.admit(self.scout)
        scout_state = self.snapshot().data
        self.assertEqual({row['name'] for row in scout_state['forces']}, {'舰队1', '舰队2', '舰队3'})
        self.assertEqual([row.get('in_scope') for row in scout_state['forces']], [True, False, False])
        self.assertEqual(len(scout_state['reports']), 4)
        self.assertNotIn('SECRET', str(scout_state))

    def test_snapshot_and_members_count_active_accounts_not_online_or_pending(self):
        self.admit()
        applicant = get_user_model().objects.create_user(username='pending')
        application = JoinApplication.objects.create(organization=self.org, user=applicant)
        Membership.objects.filter(organization=self.org, user=self.other).update(status='removed')
        get_user_model().objects.filter(pk=self.scout.pk).update(is_active=False)
        for path in ('snapshot', 'members'):
            result = self.snapshot() if path == 'snapshot' else self.client.get(self.url('members'))
            self.assertEqual(result.data.get('member_count'), 2)
            self.assertEqual(result.data['online_count'], 1)
        self.assertEqual(self.cmd('join.review', application_id=application.pk, decision='approve').status_code, 200)
        self.assertEqual(self.snapshot().data.get('member_count'), 3)
        self.assertEqual(self.client.get(self.url('members')).data.get('member_count'), 3)
        removed = Membership.objects.get(organization=self.org, user=self.other)
        self.assertEqual(self.cmd('member.restore', member_id=removed.pk).status_code, 200)
        self.assertEqual(self.snapshot().data.get('member_count'), 4)
        self.assertEqual(self.cmd('member.remove', member_id=removed.pk).status_code, 200)
        self.assertEqual(self.snapshot().data.get('member_count'), 3)
        get_user_model().objects.filter(pk=self.scout.pk).update(is_active=True)
        self.assertEqual(self.snapshot().data.get('member_count'), 4)

    def test_commander_member_count_disappears_immediately_on_demotion(self):
        self.admit(self.commander)
        self.assertEqual(self.snapshot().data.get('member_count'), 4)
        self.assertEqual(self.client.get(self.url('members')).data.get('member_count'), 4)
        Membership.objects.filter(organization=self.org, user=self.commander).update(role='scout')
        state = self.snapshot().data
        self.assertNotIn('member_count', state)
        self.assertNotIn('online', state)
        self.assertEqual(self.client.get(self.url('members')).status_code, 403)

    def test_scope_reuses_static_graph_cache_without_per_row_queries(self):
        self.create_rows()
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=1).status_code, 200)
        with CaptureQueriesContext(connection) as cold:
            self.assertEqual(self.snapshot().status_code, 200)
        with CaptureQueriesContext(connection) as warm:
            state = self.snapshot()
            self.assertTrue(state.data['forces'][0].get('in_scope'))
        self.assertLess(len(warm), len(cold))
        warm_count = len(warm)
        for index in range(15):
            self.assertEqual(self.cmd('report.create', report_kind='fleet_intel', fleet_name=f'新增{index}',
                                     **self.content()).status_code, 200)
        with CaptureQueriesContext(connection) as many:
            state = self.snapshot()
            self.assertEqual(len(state.data['forces']), 19)
            self.assertEqual(len(state.data['reports']), 19)
        self.assertEqual(len(many), warm_count)
        self.assertFalse(any(BoardSystems._meta.db_table.lower() in row['sql'].lower() for row in many))

    def test_socket_snapshot_carries_current_scope_and_member_count(self):
        from TacticalCollaboration import services
        self.create_rows()
        self.assertEqual(self.cmd('scope.update', expected_version=1, region_ids=[1], border_hops=0).status_code, 200)
        generation = str(uuid4())
        services.claim_socket(self.owner, self.org.pk, self.connection_id, generation)
        state = services.socket_snapshot(self.owner, self.org.pk, self.connection_id, generation)
        self.assertEqual(state.get('member_count'), 4)
        self.assertEqual([row.get('in_scope') for row in state['forces']], [True, False, False, False])
        self.assertEqual(self.cmd('scope.update', expected_version=2, region_ids=[4], border_hops=0).status_code, 200)
        state = services.socket_snapshot(self.owner, self.org.pk, self.connection_id, generation)
        self.assertEqual([row.get('in_scope') for row in state['forces']], [False, False, False, True])
