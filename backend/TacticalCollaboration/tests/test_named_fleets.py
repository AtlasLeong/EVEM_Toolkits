from uuid import uuid4

from django.db import connection
from django.test.utils import CaptureQueriesContext
from TacticalCollaboration.models import AuditLog, Force, Organization, Report, ReportRevision
from .test_board import BoardCase


class NamedFleetTests(BoardCase):
    def create_fleet(self, name='大航队', **overrides):
        response = self.cmd('report.create', report_kind='fleet_intel', fleet_name=name, **self.content(**overrides))
        self.assertEqual(response.status_code, 200, response.content)
        return response.data['result']

    def observe(self, force, **overrides):
        response = self.cmd('report.create', report_kind='fleet_intel', force_id=force['id'],
                            force_expected_version=force['version'], **self.content(**overrides))
        self.assertEqual(response.status_code, 200, response.content)
        return response.data['result']

    def get_force(self, force_id):
        return next(row for row in self.snapshot().data['forces'] if row['id'] == force_id)

    def test_named_fleets_immediately_visible_with_separate_stable_identities(self):
        self.admit(self.commander)
        carrier = self.create_fleet(people=100)
        artillery = self.create_fleet('远炮战列队', people=50)
        another_carrier = self.create_fleet(people=20)
        self.assertEqual(len({carrier['force_id'], artillery['force_id'], another_carrier['force_id']}), 3)
        self.admit(self.other)
        state = self.snapshot().data
        self.assertEqual(len(state['forces']), 3)
        force = next(row for row in state['forces'] if row['id'] == carrier['force_id'])
        self.assertEqual((force['name'], force['people'], force['side']), ('大航队', 100, 'enemy'))
        self.assertEqual(force['source_report_id'], carrier['id'])
        self.assertEqual(force['source_author_id'], self.commander.pk)
        self.assertEqual(force['source_author_name'], 'commander')
        self.assertTrue(carrier['is_current'])
        revision = ReportRevision.objects.get(report_id=carrier['id'])
        self.assertEqual(revision.content['fleet_name'], '大航队')
        self.assertEqual(revision.content['force_id'], carrier['force_id'])

    def test_replay_creates_one_force_report_revision_and_audit(self):
        self.admit(self.commander)
        request_id = str(uuid4())
        arguments = dict(request_id=request_id, report_kind='fleet_intel', fleet_name='大航队', **self.content())
        first = self.cmd('report.create', **arguments)
        self.assertEqual(first.status_code, 200, first.content)
        second = self.cmd('report.create', **arguments)
        self.assertEqual(second.data, first.data)
        self.assertEqual((Force.objects.count(), Report.objects.count(), ReportRevision.objects.count(), AuditLog.objects.count()), (1, 1, 1, 1))

    def test_explicit_existing_fleet_observation_changes_one_force_without_adding_counts(self):
        self.admit(self.commander)
        original = self.create_fleet(people=100)
        force = self.get_force(original['force_id'])
        self.admit(self.owner)
        replacement = self.observe(force, people=90, system_id=2, observed_at='2026-01-01T10:01:00Z')
        current = self.get_force(force['id'])
        self.assertEqual((current['id'], current['people'], current['system_id']), (force['id'], 90, 2))
        self.assertEqual(current['source_report_id'], replacement['id'])
        self.assertEqual(current['source_author_id'], self.owner.pk)
        self.assertEqual(Force.objects.count(), 1)
        reports = {row['id']: row for row in self.snapshot().data['reports']}
        self.assertFalse(reports[original['id']]['is_current'])
        self.assertTrue(reports[replacement['id']]['is_current'])

    def test_older_observation_and_its_later_revision_cannot_replace_current_estimate(self):
        self.admit(self.commander)
        original = self.create_fleet(people=100)
        force = self.get_force(original['force_id'])
        older = self.observe(force, people=3, system_id=2, observed_at='2026-01-01T09:59:00Z')
        self.assertFalse(older['is_current'])
        self.assertEqual(self.get_force(force['id']), force)
        response = self.cmd('report.update', report_id=older['id'], expected_version=1,
                            fleet_name='历史修订', **self.content(people=200, observed_at='2026-01-01T10:05:00Z'))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.get_force(force['id']), force)

    def test_equal_observation_time_new_report_wins_deterministically(self):
        self.admit(self.commander)
        first = self.create_fleet()
        second = self.observe(self.get_force(first['force_id']), people=99)
        self.assertTrue(second['is_current'])
        self.assertEqual(self.get_force(first['force_id'])['source_report_id'], second['id'])

    def test_stale_existing_force_version_rejects_without_orphan_or_audit(self):
        self.admit(self.commander)
        first = self.create_fleet()
        force = self.get_force(first['force_id'])
        self.observe(force, people=90)
        counts = (Report.objects.count(), ReportRevision.objects.count(), AuditLog.objects.count())
        response = self.cmd('report.create', report_kind='fleet_intel', force_id=force['id'],
                            force_expected_version=force['version'], **self.content())
        self.assertEqual(response.status_code, 409, response.content)
        self.assertEqual((Report.objects.count(), ReportRevision.objects.count(), AuditLog.objects.count()), counts)

    def test_source_author_can_correct_content_but_never_revert_manual_move(self):
        self.admit(self.commander)
        first = self.create_fleet(people=None)
        self.admit(self.commander)
        moved = self.cmd('force.move', force_id=first['force_id'], expected_version=1,
                         destination_system_id=4, kind='correction', reason='地图修正')
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.data['result']['source_report_id'], first['id'])
        self.assertEqual(moved.data['result']['observed_at'], first['observed_at'])
        self.admit(self.commander)
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1,
                          report_kind='fleet_intel', fleet_name='远炮战列队',
                          **self.content(people=0, notes='已确认', ships={'battleship': 12}))
        self.assertEqual(edited.status_code, 200, edited.content)
        force = self.get_force(first['force_id'])
        self.assertEqual((force['system_id'], force['people'], force['name']), (4, 0, '远炮战列队'))
        self.assertEqual(force['ships'], {'battleship': 12})
        self.assertEqual(force['notes'], '已确认')
        self.assertEqual(force['version'], 3)
        self.admit(self.other)
        denied = self.cmd('report.update', report_id=first['id'], expected_version=2, **self.content())
        self.assertEqual(denied.status_code, 403)

    def test_superseded_report_edit_does_not_overwrite_another_scout_observation(self):
        self.admit(self.commander)
        first = self.create_fleet()
        self.admit(self.owner)
        self.observe(self.get_force(first['force_id']), people=50, observed_at='2026-01-01T10:02:00Z')
        current = self.get_force(first['force_id'])
        self.admit(self.commander)
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1,
                          fleet_name='旧记录修正', **self.content(people=999, system_id=4))
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertFalse(edited.data['result']['is_current'])
        self.assertEqual(self.get_force(first['force_id']), current)

    def test_manual_force_update_clears_source_and_fences_old_report_edits(self):
        self.admit(self.commander)
        first = self.create_fleet()
        self.admit(self.commander)
        response = self.cmd('force.update', force_id=first['force_id'], expected_version=1,
                            name='指挥修正', side='enemy', **self.content(people=70, system_id=3))
        self.assertEqual(response.status_code, 200, response.content)
        current = response.data['result']
        self.assertIsNone(current['source_report_id'])
        self.assertIsNone(current['source_author_id'])
        self.assertIsNone(current['source_author_name'])
        self.admit(self.commander)
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1, **self.content(people=999))
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertFalse(edited.data['result']['is_current'])
        current = {key: value for key, value in current.items() if key != 'state_version'}
        self.assertEqual(self.get_force(first['force_id']), {**current, 'in_scope': False})

    def test_archive_blocks_new_observation_and_old_edits_never_resurrect(self):
        self.admit(self.commander)
        first = self.create_fleet()
        self.admit(self.commander)
        archived = self.cmd('force.archive', force_id=first['force_id'], expected_version=1)
        self.assertEqual(archived.status_code, 200)
        self.admit(self.commander)
        response = self.cmd('report.create', report_kind='fleet_intel', force_id=first['force_id'],
                            force_expected_version=2, **self.content())
        self.assertEqual(response.status_code, 409, response.content)
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1, **self.content(people=4))
        self.assertEqual(edited.status_code, 200, edited.content)
        self.assertFalse(edited.data['result']['is_current'])
        self.assertEqual(self.snapshot().data['forces'], [])
        force = Force.objects.get(pk=first['force_id'])
        self.assertTrue(force.archived)
        self.assertEqual(force.people, 80)

    def test_friendly_and_cross_org_targets_rejected_without_exposing_or_creating(self):
        self.admit(self.commander)
        friendly = self.cmd('force.create', name='秘密己方', side='friendly', **self.content()).data['result']
        other_org = Organization.objects.create(name='其他组织', founder=self.owner)
        foreign = Force.objects.create(organization=other_org, name='其他部队', side='enemy', system_name='星系1', **self.content())
        self.admit(self.commander)
        for force_id in (friendly['id'], foreign.pk):
            response = self.cmd('report.create', report_kind='fleet_intel', force_id=force_id,
                                force_expected_version=1, **self.content())
            self.assertIn(response.status_code, (400, 404), response.content)
            self.assertNotIn('秘密己方', str(response.data))
        self.assertEqual(Report.objects.count(), 0)
        self.admit(self.scout)
        self.assertEqual(self.snapshot().data['forces'], [])

    def test_new_kind_cannot_be_confirmed_again_or_grant_scout_force_authority(self):
        self.admit(self.commander)
        first = self.create_fleet()
        self.admit(self.scout)
        for action, arguments in (
            ('force.move', dict(force_id=first['force_id'], expected_version=1, destination_system_id=2, kind='gate_move')),
            ('force.update', dict(force_id=first['force_id'], expected_version=1, name='不允许', side='enemy', **self.content())),
            ('force.archive', dict(force_id=first['force_id'], expected_version=1)),
        ):
            self.assertEqual(self.cmd(action, **arguments).status_code, 403)
        self.admit(self.commander)
        response = self.cmd('report.confirm', report_id=first['id'], expected_version=1, name='重复')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Force.objects.count(), 1)

    def test_strict_target_fields_and_immutable_type_and_link(self):
        self.admit(self.commander)
        first = self.create_fleet()
        for extra in ({}, {'fleet_name': ''}, {'force_id': first['force_id']}, {'force_expected_version': 1},
                      {'fleet_name': '另一支', 'force_id': first['force_id'], 'force_expected_version': 1}):
            response = self.cmd('report.create', report_kind='fleet_intel', **extra, **self.content())
            self.assertEqual(response.status_code, 400, response.content)
        for kind in ('fleet', 'system_count'):
            response = self.cmd('report.create', report_kind=kind, fleet_name='不允许', **self.content())
            self.assertEqual(response.status_code, 400, response.content)
        for extra in ({'report_kind': 'fleet'}, {'force_id': first['force_id']}, {'force_expected_version': 1}):
            response = self.cmd('report.update', report_id=first['id'], expected_version=1, **extra, **self.content())
            self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Force.objects.count(), 1)

    def test_report_compare_and_swap_conflict_does_not_change_force(self):
        self.admit(self.commander)
        first = self.create_fleet()
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1, **self.content(people=40))
        self.assertEqual(edited.status_code, 200, edited.content)
        current = self.get_force(first['force_id'])
        stale = self.cmd('report.update', report_id=first['id'], expected_version=1, **self.content(people=10))
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.get_force(first['force_id']), current)

    def test_current_source_backdating_rejects_atomically(self):
        self.admit(self.commander)
        first = self.create_fleet()
        current = self.get_force(first['force_id'])
        response = self.cmd('report.update', report_id=first['id'], expected_version=1,
                            **self.content(observed_at='2026-01-01T09:59:00Z'))
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('不能倒退', str(response.data))
        self.assertEqual(ReportRevision.objects.filter(report_id=first['id']).count(), 1)
        self.assertEqual(Report.objects.get(pk=first['id']).version, 1)
        self.assertEqual(self.get_force(first['force_id']), current)

    def test_legacy_commander_adoption_replaces_source_and_fences_old_named_observation(self):
        self.admit(self.commander)
        first = self.create_fleet()
        legacy = self.cmd('report.create', **self.content(people=35)).data['result']
        self.admit(self.commander)
        adopted = self.cmd('report.confirm', report_id=legacy['id'], expected_version=1,
                           force_id=first['force_id'], force_expected_version=1, name='已采纳修正')
        self.assertEqual(adopted.status_code, 200, adopted.content)
        self.assertIsNone(adopted.data['result']['source_report_id'])
        self.admit(self.commander)
        edited = self.cmd('report.update', report_id=first['id'], expected_version=1, **self.content(people=999))
        self.assertEqual(edited.status_code, 200, edited.content)
        adopted_force = {key: value for key, value in adopted.data['result'].items() if key != 'state_version'}
        self.assertEqual(self.get_force(first['force_id']), {**adopted_force, 'in_scope': False})

    def test_names_are_trimmed_bounded_and_unsupported_fields_do_not_write(self):
        self.admit(self.commander)
        first = self.create_fleet('  大航队  ')
        self.assertEqual(first['fleet_name'], '大航队')
        for name in (' ', '长' * 81, None, [], 12):
            response = self.cmd('report.create', report_kind='fleet_intel', fleet_name=name, **self.content())
            self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual((Force.objects.count(), Report.objects.count()), (1, 1))

    def test_snapshot_query_count_does_not_grow_per_named_fleet_or_source_author(self):
        self.admit(self.commander)
        self.create_fleet()
        with CaptureQueriesContext(connection) as one:
            self.assertEqual(self.snapshot().status_code, 200)
        for index in range(8):
            self.create_fleet(f'舰队{index}')
        with CaptureQueriesContext(connection) as many:
            state = self.snapshot()
            self.assertEqual(state.status_code, 200)
        self.assertEqual(len(state.data['forces']), 9)
        self.assertEqual(len(many), len(one))
