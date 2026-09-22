from TacticalCollaboration.models import Force, Report, ReportRevision
from .test_board import BoardCase


class SystemIntelTests(BoardCase):
    def create_snapshot(self, **kwargs):
        # Scouts report only a system total; ship details belong to named
        # observations submitted by commanders.
        response = self.cmd('report.create', report_kind='system_count',
                            **self.content(ships={'cruiser': None, 'titan': None}, **kwargs))
        self.assertEqual(response.status_code, 200, response.content)
        return response.data['result']

    def test_snapshot_immediately_visible_to_other_scout_without_force_creation(self):
        self.admit(self.scout)
        report = self.create_snapshot(people=68)
        self.assertEqual(report['report_kind'], 'system_count')
        revision = ReportRevision.objects.get(report_id=report['id'])
        self.assertEqual(revision.content['report_kind'], 'system_count')
        self.admit(self.other)
        rows = self.snapshot().data['reports']
        self.assertEqual(rows[0]['people'], 68)
        self.assertEqual(rows[0]['author_id'], self.scout.pk)
        self.assertEqual(rows[0]['report_kind'], 'system_count')
        self.assertFalse(Force.objects.exists())

    def test_scout_can_only_create_system_count_reports(self):
        self.admit(self.scout)
        for kind, extra in (('fleet_intel', {'fleet_name': '不应创建'}), ('fleet', {})):
            response = self.cmd('report.create', report_kind=kind, **extra, **self.content())
            self.assertEqual(response.status_code, 403, response.content)

    def test_scout_cannot_attach_a_force_to_system_intel(self):
        self.admit(self.scout)
        response = self.cmd('report.create', report_kind='system_count', force_id=1,
                            force_expected_version=1,
                            **self.content(ships={'cruiser': None, 'titan': None}))
        self.assertEqual(response.status_code, 400, response.content)

    def test_scout_cannot_submit_ship_details_with_system_count(self):
        self.admit(self.scout)
        response = self.cmd('report.create', report_kind='system_count',
                            **self.content(ships={'cruiser': 12, 'titan': None}))
        self.assertEqual(response.status_code, 403, response.content)

    def test_scout_cannot_update_legacy_named_fleet_report(self):
        self.admit(self.commander)
        legacy = self.cmd('report.create', report_kind='fleet_intel', fleet_name='历史舰队',
                          **self.content()).data['result']
        Report.objects.filter(pk=legacy['id']).update(author=self.scout)
        self.admit(self.scout)
        response = self.cmd('report.update', report_id=legacy['id'], expected_version=1,
                            **self.content(people=10, ships={'cruiser': 2, 'titan': None}))
        self.assertEqual(response.status_code, 403, response.content)

    def test_commander_can_submit_and_update_named_fleet_with_ship_details(self):
        self.admit(self.commander)
        first = self.cmd('report.create', report_kind='fleet_intel', fleet_name='主力舰队',
                         **self.content(people=60, ships={'cruiser': 20, 'titan': 1})).data['result']
        response = self.cmd('report.update', report_id=first['id'], expected_version=1,
                            **self.content(people=55, ships={'cruiser': 18, 'titan': 1}))
        self.assertEqual(response.status_code, 200, response.content)

    def test_system_total_cannot_be_confirmed_into_a_fleet(self):
        self.admit(self.scout)
        report = self.create_snapshot()
        self.admit(self.commander)
        response = self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='重复部队')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertFalse(Force.objects.exists())

    def test_own_update_preserves_kind_and_unknown_zero_are_distinct(self):
        self.admit(self.scout)
        report = self.create_snapshot(people=None)
        self.assertIsNone(report['people'])
        response = self.cmd('report.update', report_id=report['id'], expected_version=1,
                            report_kind='system_count',
                            **self.content(people=0, ships={'cruiser': None, 'titan': None}))
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.data['result']['people'], 0)
        self.assertEqual(response.data['result']['report_kind'], 'system_count')
        response = self.cmd('report.update', report_id=report['id'], expected_version=2,
                            report_kind='fleet',
                            **self.content(people=10, ships={'cruiser': None, 'titan': None}))
        self.assertEqual(response.status_code, 400, response.content)
        self.admit(self.other)
        response = self.cmd('report.update', report_id=report['id'], expected_version=2, **self.content())
        self.assertEqual(response.status_code, 403, response.content)

    def test_legacy_reports_remain_fleet_and_invalid_kinds_reject(self):
        self.admit(self.commander)
        report = self.cmd('report.create', **self.content()).data['result']
        self.assertEqual(report['report_kind'], 'fleet')
        for invalid in ('total_local', '', None, 1, []):
            response = self.cmd('report.create', report_kind=invalid, **self.content())
            self.assertEqual(response.status_code, 400, response.content)
        self.admit(self.commander)
        self.assertEqual(self.cmd('report.confirm', report_id=report['id'], expected_version=1, name='舰队').status_code, 200)

    def test_correction_move_preserves_system_snapshot_and_original_observation(self):
        self.admit(self.scout)
        report = self.create_snapshot(people=68)
        self.admit(self.commander)
        force = self.cmd('force.create', name='独立舰队', side='enemy', **self.content(people=25)).data['result']
        moved = self.cmd('force.move', force_id=force['id'], expected_version=1,
                         destination_system_id=4, kind='correction', reason='指挥通过星图拖拽调整部署位置')
        self.assertEqual(moved.status_code, 200, moved.content)
        self.assertEqual(moved.data['result']['observed_at'], force['observed_at'])
        self.assertEqual(moved.data['result']['people'], 25)
        unchanged = next(row for row in self.snapshot().data['reports'] if row['id'] == report['id'])
        self.assertEqual(unchanged['system_id'], 1)
        self.assertEqual(unchanged['people'], 68)
