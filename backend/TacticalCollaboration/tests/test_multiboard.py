import json
from time import perf_counter
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.db import connection
from django.db.models import F
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from TacticalCollaboration.models import Board, CommandReceipt, Membership, Organization, PirateSighting
from TacticalCollaboration import pirate
from TacticalCollaboration.services import digest
from TacticalCollaboration.tests.test_board import BoardCase


class OrganizationBoardTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username='board-owner')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def post(self, path, body):
        return self.client.post('/api/tactical/' + path, json.dumps(body), content_type='application/json')

    def create(self, name, kind='war'):
        response = self.post('organizations/', {'name': name, 'board_type': kind, 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['result']

    def test_create_quota_counts_founder_rows_not_joined_memberships(self):
        for index in range(3):
            self.create(f'组织{index}')
        denied = self.post('organizations/', {'name': '第四个', 'request_id': str(uuid4())})
        self.assertEqual(denied.status_code, 400, denied.data)
        self.assertEqual(Organization.objects.filter(founder=self.owner).count(), 3)

    def test_board_directory_allows_three_of_any_kind_and_denies_fourth(self):
        org = self.create('北境', 'pirate')
        self.assertEqual(org['boards'][0]['kind'], 'pirate')
        self.assertFalse(org['boards'][0]['is_default'])
        path = f'organizations/{org["id"]}/boards/'
        for name, kind in [('海盗二', 'pirate'), ('海盗三', 'pirate')]:
            response = self.post(path, {'name': name, 'kind': kind, 'request_id': str(uuid4())})
            self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(self.post(path, {'name': '第四块', 'kind': 'war', 'request_id': str(uuid4())}).status_code, 400)
        listed = self.client.get('/api/tactical/organizations/').data['organizations'][0]
        self.assertEqual([board['kind'] for board in listed['boards']], ['pirate'] * 3)
        self.assertEqual(len({board['id'] for board in listed['boards']}), 3)

    def test_board_get_lists_active_members_only(self):
        org = self.create('目录', 'pirate')
        path = f'/api/tactical/organizations/{org["id"]}/boards/'
        created = self.post(f'organizations/{org["id"]}/boards/',
                            {'name': '战争二', 'kind': 'war', 'request_id': str(uuid4())})
        self.assertEqual(created.status_code, 200, created.data)
        member = get_user_model().objects.create_user(username='board-scout')
        Membership.objects.create(organization_id=org['id'], user=member, role='scout')
        self.client.force_authenticate(member)
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, getattr(response, 'data', None))
        self.assertEqual([row['id'] for row in response.data['boards']],
                         [org['boards'][0]['id'], created.data['result']['id']])
        self.assertEqual([row['kind'] for row in response.data['boards']], ['pirate', 'war'])
        Membership.objects.filter(organization_id=org['id'], user=member).update(status='removed')
        self.assertEqual(self.client.get(path).status_code, 403)

    def test_pirate_first_org_has_no_implicit_war_board_and_admin_still_works(self):
        org = self.create('海盗', 'pirate')
        base = f'/api/tactical/organizations/{org["id"]}/'
        self.assertEqual(self.client.get(base + 'map/').status_code, 404)
        self.assertEqual(self.client.get(base + 'members/').status_code, 200)
        self.assertEqual(self.post(f'organizations/{org["id"]}/commands/',
                                   {'action': 'invite.create', 'request_id': str(uuid4())}).status_code, 200)
        added = self.post(f'organizations/{org["id"]}/boards/',
                          {'name': '后来战争', 'kind': 'war', 'request_id': str(uuid4())})
        self.assertEqual(added.status_code, 200, added.data)
        self.assertEqual(self.client.get(base + 'map/').status_code, 404)

    def test_pre_upgrade_create_receipt_replay_includes_migrated_board(self):
        org = Organization.objects.create(name='原组织', founder=self.owner)
        Membership.objects.create(organization=org, user=self.owner, role='founder')
        board = Board.objects.create(organization=org, name='战争沙盘', kind='war', is_default=True)
        body = {'name': '原组织', 'request_id': str(uuid4())}
        CommandReceipt.objects.create(actor=self.owner, scope='create', request_id=body['request_id'],
                                      payload_hash=digest(body),
                                      result={'id': org.pk, 'name': org.name, 'role': 'founder', 'status': 'active'})
        replay = self.post('organizations/', body)
        self.assertEqual(replay.status_code, 200, replay.data)
        self.assertEqual(replay.data['result']['boards'][0]['id'], board.pk)

    @override_settings(TACTICAL_MULTIBOARD_WRITES_ENABLED=False)
    def test_release_gate_blocks_pirate_first_board_but_preserves_legacy_war_create(self):
        pirate_request = {'name': '海盗先行', 'board_type': 'pirate', 'request_id': str(uuid4())}
        denied = self.post('organizations/', pirate_request)
        self.assertEqual(denied.status_code, 403, denied.data)
        self.assertFalse(Organization.objects.filter(name='海盗先行').exists())
        self.assertFalse(CommandReceipt.objects.filter(request_id=pirate_request['request_id']).exists())

        legacy = self.post('organizations/', {'name': '旧版战争', 'request_id': str(uuid4())})
        self.assertEqual(legacy.status_code, 200, legacy.data)
        self.assertEqual(legacy.data['result']['boards'][0]['kind'], 'war')
        explicit = self.post('organizations/',
                             {'name': '显式战争', 'board_type': 'war', 'request_id': str(uuid4())})
        self.assertEqual(explicit.status_code, 200, explicit.data)

    def test_release_gate_blocks_board_create_and_receipt_replay(self):
        org = self.create('X 阶段组织')
        path = f'organizations/{org["id"]}/boards/'
        with override_settings(TACTICAL_MULTIBOARD_WRITES_ENABLED=False):
            for kind in ('war', 'pirate'):
                request_id = str(uuid4())
                denied = self.post(path, {'name': f'禁用{kind}', 'kind': kind, 'request_id': request_id})
                self.assertEqual(denied.status_code, 403, denied.data)
                self.assertFalse(CommandReceipt.objects.filter(request_id=request_id).exists())
            self.assertEqual(Board.objects.filter(organization_id=org['id']).count(), 1)

        body = {'name': 'Y 阶段新增', 'kind': 'pirate', 'request_id': str(uuid4())}
        created = self.post(path, body)
        self.assertEqual(created.status_code, 200, created.data)
        with override_settings(TACTICAL_MULTIBOARD_WRITES_ENABLED=False):
            replay = self.post(path, body)
        self.assertEqual(replay.status_code, 403, replay.data)
        self.assertEqual(Board.objects.filter(organization_id=org['id']).count(), 2)


class WarBoardIsolationTests(BoardCase):
    def board(self, name):
        response = self.post('boards', {'name': name, 'kind': 'war', 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['result']['id']

    def test_legacy_board_and_second_war_board_keep_scope_and_forces_separate(self):
        self.admit()
        default = self.client.get('/api/tactical/organizations/').data['organizations'][0]['boards'][0]['id']
        second = self.board('第二战场')
        old = self.cmd('force.create', name='原舰队', side='enemy', **self.content()).data['result']
        new = self.cmd('force.create', board_id=second, name='新舰队', side='enemy', **self.content()).data['result']
        self.assertEqual([f['id'] for f in self.snapshot().data['forces']], [old['id']])
        second_state = self.client.get(self.url('snapshot'), {'connection_id': self.connection_id, 'board_id': second})
        self.assertEqual([f['id'] for f in second_state.data['forces']], [new['id']])
        self.assertEqual(second_state.data['board']['id'], second)
        self.assertEqual(self.cmd('force.archive', board_id=second, force_id=old['id'], expected_version=1).status_code, 404)
        self.assertEqual(self.cmd('scope.update', board_id=second, expected_version=1,
                                  region_ids=[2], border_hops=0).status_code, 200)
        self.assertEqual(self.client.get(self.url('map')).data['scope']['region_ids'], [])
        self.assertEqual(self.client.get(self.url('map'), {'board_id': second}).data['scope']['region_ids'], [2])
        self.assertNotEqual(default, second)

    def test_org_receipt_replays_on_explicit_default_board_id(self):
        self.admit()
        default = self.client.get('/api/tactical/organizations/').data['organizations'][0]['boards'][0]['id']
        body = {'action': 'force.create', 'request_id': str(uuid4()), 'connection_id': self.connection_id,
                'name': '只建一次', 'side': 'enemy', **self.content()}
        first = self.post('commands', body)
        self.assertEqual(first.status_code, 200, first.data)
        again = self.post('commands', {**body, 'board_id': default})
        self.assertEqual(again.status_code, 200, again.data)
        self.assertEqual(first.data['result']['id'], again.data['result']['id'])

    def test_report_links_and_socket_snapshots_cannot_cross_war_boards(self):
        from TacticalCollaboration import services
        self.admit()
        second = self.board('第二战场')
        first_force = self.cmd('force.create', name='一板舰队', side='enemy', **self.content()).data['result']
        second_force = self.cmd('force.create', board_id=second, name='二板舰队', side='enemy', **self.content()).data['result']
        report = self.cmd('report.create', board_id=second, **self.content()).data['result']
        rejected = self.cmd('report.confirm', board_id=second, report_id=report['id'],
                            expected_version=1, name='跨板', force_id=first_force['id'], force_expected_version=1)
        self.assertEqual(rejected.status_code, 404)
        generation = str(uuid4())
        services.claim_socket(self.owner, self.org.pk, self.connection_id, generation, second)
        selected = services.socket_snapshot(self.owner, self.org.pk, self.connection_id, generation, second)
        self.assertEqual([force['id'] for force in selected['forces']], [second_force['id']])
        self.assertEqual(selected['board']['id'], second)
        self.assertIsInstance(services.socket_state_version(self.owner, self.org.pk, self.connection_id, generation, second), int)
        with self.assertRaises(Exception):
            services.socket_state_version(self.owner, self.org.pk, self.connection_id, generation, 99999)

    def test_snapshot_rechecks_membership_after_static_projection_before_content(self):
        from TacticalCollaboration import graph
        self.admit(self.owner)
        self.cmd('force.create', name='撤权后不可见', side='enemy', **self.content())
        self.admit(self.scout)
        project = graph.static_projection

        def remove_during_projection(*args, **kwargs):
            Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
            return project(*args, **kwargs)

        with patch.object(graph, 'static_projection', side_effect=remove_during_projection):
            response = self.snapshot()
        self.assertEqual(response.status_code, 403, response.data)
        self.assertNotIn('撤权后不可见', json.dumps(response.data, ensure_ascii=False))


class PirateBoardTests(BoardCase):
    def setUp(self):
        super().setUp()
        response = self.post('boards', {'name': '海盗情报', 'kind': 'pirate', 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 200, response.data)
        self.board_id = response.data['result']['id']

    def pirate_path(self, suffix='pirate'):
        return f'/api/tactical/organizations/{self.org.pk}/boards/{self.board_id}/{suffix}/'

    def pirate(self, body):
        return self.client.post(self.pirate_path('pirate/commands'), json.dumps(body), content_type='application/json')

    def sight(self, name='目标', **changes):
        body = {'action': 'sighting.create', 'request_id': str(uuid4()), 'character_name': name,
                'ship_type': 'Gila', 'location_kind': 'system', 'location_id': 1,
                'observed_at': '2026-01-01T10:00:00Z', 'notes': '', **changes}
        response = self.pirate(body)
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['result']

    def seed_sightings(self, amount):
        PirateSighting.objects.bulk_create([
            PirateSighting(board_id=self.board_id, author=self.scout, character_name='批量目标',
                           ship_type='Gila', normalized_name='批量目标', normalized_ship='gila',
                           location_kind='system', location_id=1, location_name='星系1',
                           observed_at=timezone.now())
            for _ in range(amount)
        ], batch_size=200)

    def test_scout_sees_only_own_sightings_and_counts_even_after_withdraw(self):
        self.client.force_authenticate(self.scout)
        own = self.sight('自己目标')
        self.client.force_authenticate(self.other)
        other = self.sight('秘密目标')
        self.client.force_authenticate(self.scout)
        state = self.client.get(self.pirate_path())
        self.assertEqual(state.status_code, 200, state.data)
        self.assertEqual([s['id'] for s in state.data['sightings']], [own['id']])
        self.assertEqual(state.data['sightings'][0]['author_name'], self.scout.username)
        self.assertEqual(state.data['target_count'], 1)
        self.assertNotIn('秘密目标', json.dumps(state.data, ensure_ascii=False))
        denied = self.pirate({'action': 'sighting.withdraw', 'request_id': str(uuid4()),
                              'id': other['id'], 'expected_version': 1})
        self.assertEqual(denied.status_code, 404)
        self.assertNotIn('秘密目标', json.dumps(denied.data, ensure_ascii=False))
        withdrawn = self.pirate({'action': 'sighting.withdraw', 'request_id': str(uuid4()),
                                 'id': own['id'], 'expected_version': 1})
        self.assertEqual(withdrawn.status_code, 200, withdrawn.data)
        state = self.client.get(self.pirate_path()).data
        self.assertEqual(state['sightings'][0]['status'], 'withdrawn')
        self.assertEqual(state['target_count'], 0)
        self.client.force_authenticate(self.owner)
        commander_sightings = self.client.get(self.pirate_path()).data['sightings']
        self.assertEqual(len(commander_sightings), 2)
        self.assertEqual({row['author_name'] for row in commander_sightings},
                         {self.scout.username, self.other.username})

    def test_location_activity_validation_and_per_board_scope(self):
        catalog = self.client.get(self.url('catalog'), {'kind': 'constellations', 'q': '星座2'})
        self.assertEqual(catalog.status_code, 200, catalog.data)
        self.assertEqual(catalog.data['results'][0]['id'], 2)
        self.client.force_authenticate(self.scout)
        sight = self.sight(location_kind='constellation', location_id=2,
                           activity_start_utc='23:15', activity_end_utc='01:30')
        self.assertEqual(sight['location_kind'], 'constellation')
        self.assertEqual(sight['activity_start_utc'], '23:15')
        self.assertEqual(self.pirate({'action': 'sighting.create', 'request_id': str(uuid4()),
                                     'character_name': 'X', 'ship_type': 'Gila', 'location_kind': 'system',
                                     'location_id': 999, 'observed_at': '2026-01-01T10:00:00Z',
                                     'notes': ''}).status_code, 400)
        self.client.force_authenticate(self.owner)
        scoped = self.pirate({'action': 'scope.update', 'request_id': str(uuid4()),
                              'expected_version': 1, 'region_ids': [2], 'border_hops': 0})
        self.assertEqual(scoped.status_code, 200, scoped.data)
        self.assertEqual(self.client.get(self.pirate_path('map')).data['scope']['region_ids'], [2])
        self.assertEqual(self.client.get(self.url('map')).data['scope']['region_ids'], [])

    def test_normalized_target_count_idempotency_and_cross_board_privacy(self):
        self.client.force_authenticate(self.scout)
        first = self.sight(name='  Ａlice  ', ship_type='Ｇila')
        second = self.sight(name='alice', ship_type='gila', location_id=2)
        state = self.client.get(self.pirate_path()).data
        self.assertEqual(state['target_count'], 1)
        self.assertEqual({s['location_id'] for s in state['sightings']}, {1, 2})
        self.assertEqual(first['target_key'], second['target_key'])
        body = {'action': 'sighting.create', 'request_id': str(uuid4()), 'character_name': '复试',
                'ship_type': 'Gila', 'location_kind': 'system', 'location_id': 1,
                'observed_at': '2026-01-01T10:00:00Z', 'notes': ''}
        once = self.pirate(body)
        twice = self.pirate(body)
        self.assertEqual(once.data, twice.data)
        other_board = self.client.get(self.url('members'))
        self.assertEqual(other_board.status_code, 403)
        self.client.force_authenticate(self.owner)
        another = self.post('boards', {'name': '另一海盗板', 'kind': 'pirate', 'request_id': str(uuid4())})
        self.assertEqual(another.status_code, 200, another.data)
        other_id = another.data['result']['id']
        self.client.force_authenticate(self.scout)
        other_state = self.client.get(f'/api/tactical/organizations/{self.org.pk}/boards/{other_id}/pirate/').data
        self.assertEqual(other_state['sightings'], [])
        self.assertEqual(other_state['target_count'], 0)

    def test_target_count_uses_exact_normalized_tuple_not_database_collation(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='Café')
        self.sight(name='Cafe')
        with CaptureQueriesContext(connection) as queries:
            state = self.client.get(self.pirate_path())
        self.assertEqual(state.status_code, 200, state.data)
        self.assertEqual(state.data['target_count'], 2)
        self.assertEqual({tuple(row['target_key']) for row in state.data['sightings']},
                         {('café', 'gila'), ('cafe', 'gila')})
        self.assertFalse(any('DISTINCT' in query['sql'].upper() for query in queries),
                         'Target count must not depend on database DISTINCT collation')

    def test_removed_and_disabled_users_cannot_read_pirate_records(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='私有目击')
        Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
        self.assertEqual(self.client.get(self.pirate_path()).status_code, 403)
        Membership.objects.filter(organization=self.org, user=self.scout).update(status='active')
        get_user_model().objects.filter(pk=self.scout.pk).update(is_active=False)
        self.assertEqual(self.client.get(self.pirate_path()).status_code, 403)

    def test_activity_start_and_end_must_be_both_present_or_both_absent(self):
        self.client.force_authenticate(self.scout)
        base = {'action': 'sighting.create', 'character_name': '时间目标', 'ship_type': 'Gila',
                'location_kind': 'system', 'location_id': 1, 'observed_at': '2026-01-01T10:00:00Z',
                'notes': ''}
        for activity in ({'activity_start_utc': '23:15'}, {'activity_end_utc': '01:30'}):
            with self.subTest(activity=activity):
                response = self.pirate({**base, **activity, 'request_id': str(uuid4())})
                self.assertEqual(response.status_code, 400, response.data)
        complete = self.pirate({**base, 'activity_start_utc': '23:15',
                                'activity_end_utc': '01:30', 'request_id': str(uuid4())})
        self.assertEqual(complete.status_code, 200, complete.data)
        absent = self.pirate({**base, 'request_id': str(uuid4())})
        self.assertEqual(absent.status_code, 200, absent.data)

    def test_new_sighting_is_rejected_at_five_thousand_per_board(self):
        self.seed_sightings(5000)
        self.client.force_authenticate(self.scout)
        response = self.pirate({'action': 'sighting.create', 'request_id': str(uuid4()),
                                'character_name': '超额', 'ship_type': 'Gila', 'location_kind': 'system',
                                'location_id': 1, 'observed_at': '2026-01-01T10:00:00Z', 'notes': ''})
        self.assertEqual(response.status_code, 400, response.data)
        self.assertEqual(PirateSighting.objects.filter(board_id=self.board_id).count(), 5000)

    def test_snapshot_does_not_hide_existing_rows_above_new_write_cap(self):
        self.seed_sightings(5001)
        self.client.force_authenticate(self.scout)
        state = self.client.get(self.pirate_path())
        self.assertEqual(state.status_code, 200, state.data)
        self.assertEqual(len(state.data['sightings']), 5001)
        self.assertEqual(state.data['target_count'], 1)

    def test_snapshot_serializes_sightings_before_taking_organization_write_lock(self):
        self.seed_sightings(20)
        serialized = 0
        real_sighting_data = pirate.sighting_data
        real_locked_org = pirate.locked_org

        def serialize(row):
            nonlocal serialized
            serialized += 1
            return real_sighting_data(row)

        def lock_after_serialization(organization_id):
            self.assertEqual(serialized, 20)
            return real_locked_org(organization_id)

        with patch.object(pirate, 'sighting_data', side_effect=serialize), \
                patch.object(pirate, 'locked_org', side_effect=lock_after_serialization):
            state = self.client.get(self.pirate_path())
        self.assertEqual(state.status_code, 200, state.data)
        self.assertEqual(len(state.data['sightings']), 20)

    def test_snapshot_rechecks_removal_after_sighting_projection(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='撤权后不可读')
        real_sighting_data = pirate.sighting_data

        def remove_during_projection(row):
            Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=remove_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 403, response.data)
        self.assertNotIn('撤权后不可读', json.dumps(response.data, ensure_ascii=False))

    def test_snapshot_retries_when_commander_becomes_scout_during_projection(self):
        self.client.force_authenticate(self.commander)
        own = self.sight(name='本人目击')
        self.client.force_authenticate(self.scout)
        self.sight(name='斥候秘密')
        self.client.force_authenticate(self.commander)
        real_sighting_data = pirate.sighting_data
        downgraded = False

        def downgrade_during_projection(row):
            nonlocal downgraded
            if not downgraded:
                downgraded = True
                Membership.objects.filter(organization=self.org, user=self.commander).update(
                    role='scout', permission_version=F('permission_version') + 1)
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=downgrade_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['role'], 'scout')
        self.assertEqual([row['id'] for row in response.data['sightings']], [own['id']])
        self.assertEqual(response.data['target_count'], 1)
        self.assertNotIn('斥候秘密', json.dumps(response.data, ensure_ascii=False))

    def test_snapshot_retries_when_sighting_is_created_during_projection(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='原目标')
        real_sighting_data = pirate.sighting_data
        created = False

        def create_during_projection(row):
            nonlocal created
            if not created:
                created = True
                PirateSighting.objects.create(
                    board_id=self.board_id, author=self.scout, character_name='新增目标', ship_type='Gila',
                    normalized_name='新增目标', normalized_ship='gila', location_kind='system',
                    location_id=2, location_name='星系2', observed_at=timezone.now())
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=create_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual({row['character_name'] for row in response.data['sightings']}, {'原目标', '新增目标'})
        self.assertEqual(response.data['target_count'], 2)

    def test_scout_snapshot_does_not_retry_for_another_scouts_write(self):
        self.client.force_authenticate(self.scout)
        own = self.sight(name='本人目标')
        real_sighting_data = pirate.sighting_data
        serialized = 0

        def create_other_during_projection(row):
            nonlocal serialized
            serialized += 1
            if serialized == 1:
                PirateSighting.objects.create(
                    board_id=self.board_id, author=self.other, character_name='他人目标', ship_type='Gila',
                    normalized_name='他人目标', normalized_ship='gila', location_kind='system',
                    location_id=2, location_name='星系2', observed_at=timezone.now())
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=create_other_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual([row['id'] for row in response.data['sightings']], [own['id']])
        self.assertEqual(response.data['target_count'], 1)
        self.assertEqual(serialized, 1)

    def test_snapshot_retries_when_sighting_is_withdrawn_during_projection(self):
        self.client.force_authenticate(self.scout)
        sighting = self.sight(name='将撤下目标')
        real_sighting_data = pirate.sighting_data
        withdrawn = False

        def withdraw_during_projection(row):
            nonlocal withdrawn
            if not withdrawn:
                withdrawn = True
                PirateSighting.objects.filter(pk=sighting['id']).update(
                    status='withdrawn', version=F('version') + 1, updated_at=timezone.now())
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=withdraw_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['sightings'][0]['status'], 'withdrawn')
        self.assertEqual(response.data['sightings'][0]['version'], 2)
        self.assertEqual(response.data['target_count'], 0)

    def test_snapshot_retries_when_scope_changes_during_projection(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='范围目标')
        real_sighting_data = pirate.sighting_data
        changed = False
        serialized = 0

        def change_scope_during_projection(row):
            nonlocal changed, serialized
            serialized += 1
            if not changed:
                changed = True
                Board.objects.filter(pk=self.board_id).update(region_ids=[2], scope_version=F('scope_version') + 1)
            return real_sighting_data(row)

        with patch.object(pirate, 'sighting_data', side_effect=change_scope_during_projection):
            response = self.client.get(self.pirate_path())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['scope']['region_ids'], [2])
        self.assertEqual(response.data['scope']['version'], 2)
        self.assertEqual(serialized, 2)

    def test_conditional_snapshot_skips_full_projection_when_revision_is_current(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='条件读取目标')
        full = self.client.get(self.pirate_path())
        self.assertEqual(full.status_code, 200, full.data)
        self.assertIn('no-store', full['Cache-Control'])
        self.assertIsInstance(full.data.get('revision'), str)
        self.assertTrue(full.data['revision'])

        with patch.object(pirate, 'sighting_data', side_effect=AssertionError('full projection on unchanged read')):
            unchanged = self.client.get(self.pirate_path(), {'revision': full.data['revision']})
        self.assertEqual(unchanged.status_code, 200, unchanged.data)
        self.assertIn('no-store', unchanged['Cache-Control'])
        self.assertEqual(unchanged.data['unchanged'], True)
        self.assertEqual(unchanged.data['revision'], full.data['revision'])
        self.assertIn('server_time', unchanged.data)
        self.assertNotIn('sightings', unchanged.data)

        legacy = self.client.get(self.pirate_path())
        self.assertEqual(legacy.status_code, 200, legacy.data)
        self.assertEqual(len(legacy.data['sightings']), 1)
        self.assertNotIn('unchanged', legacy.data)

    def test_five_thousand_sighting_unchanged_poll_is_small_and_still_checks_revocation(self):
        self.seed_sightings(5000)
        self.client.force_authenticate(self.scout)
        full = self.client.get(self.pirate_path())
        self.assertEqual(full.status_code, 200, full.data)
        self.assertGreater(len(full.content), 100000)

        started = perf_counter()
        with patch.object(pirate, 'sighting_data', side_effect=AssertionError('serialized unchanged sightings')):
            with CaptureQueriesContext(connection) as queries:
                unchanged = self.client.get(self.pirate_path(), {'revision': full.data['revision']})
        elapsed = perf_counter() - started
        reads = sum(row['sql'].lstrip().upper().startswith('SELECT') for row in queries)
        self.assertEqual(unchanged.status_code, 200, unchanged.data)
        self.assertTrue(unchanged.data['unchanged'])
        self.assertNotIn('sightings', unchanged.data)
        self.assertLessEqual(reads, 12)
        self.assertLess(len(unchanged.content), 256)
        print(f'AUDIT: 5000-sighting unchanged poll; SELECTs={reads}; '
              f'full_bytes={len(full.content)} unchanged_bytes={len(unchanged.content)}; '
              f'SQLite elapsed={elapsed:.3f}s')

        Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
        revoked = self.client.get(self.pirate_path(), {'revision': full.data['revision']})
        self.assertEqual(revoked.status_code, 403, revoked.data)

    def test_conditional_snapshot_invalidates_on_visible_content_and_scope_change(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='旧目标')
        first = self.client.get(self.pirate_path()).data
        self.assertIn('revision', first)
        self.sight(name='新目标')
        after_content = self.client.get(self.pirate_path(), {'revision': first['revision']})
        self.assertEqual(after_content.status_code, 200, after_content.data)
        self.assertEqual({row['character_name'] for row in after_content.data['sightings']}, {'旧目标', '新目标'})
        self.assertNotEqual(after_content.data['revision'], first['revision'])

        Board.objects.filter(pk=self.board_id).update(region_ids=[2], scope_version=F('scope_version') + 1)
        after_scope = self.client.get(self.pirate_path(), {'revision': after_content.data['revision']})
        self.assertEqual(after_scope.status_code, 200, after_scope.data)
        self.assertEqual(after_scope.data['scope']['region_ids'], [2])
        self.assertNotEqual(after_scope.data['revision'], after_content.data['revision'])

    def test_conditional_scout_revision_does_not_disclose_other_scouts_write(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='本人线索')
        revision = self.client.get(self.pirate_path()).data['revision']
        self.client.force_authenticate(self.other)
        self.sight(name='他人私有线索')
        self.client.force_authenticate(self.scout)
        response = self.client.get(self.pirate_path(), {'revision': revision})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.data['unchanged'])
        self.assertEqual(response.data['revision'], revision)
        self.assertNotIn('sightings', response.data)

    def test_conditional_snapshot_rechecks_revocation_and_permission_change(self):
        self.client.force_authenticate(self.commander)
        own = self.sight(name='指挥本人')
        self.client.force_authenticate(self.scout)
        self.sight(name='其他斥候')
        self.client.force_authenticate(self.commander)
        first = self.client.get(self.pirate_path()).data
        self.assertIn('revision', first)
        Membership.objects.filter(organization=self.org, user=self.commander).update(
            role='scout', permission_version=F('permission_version') + 1)
        downgraded = self.client.get(self.pirate_path(), {'revision': first['revision']})
        self.assertEqual(downgraded.status_code, 200, downgraded.data)
        self.assertNotEqual(downgraded.data['revision'], first['revision'])
        self.assertEqual(downgraded.data['role'], 'scout')
        self.assertEqual([row['id'] for row in downgraded.data['sightings']], [own['id']])

        Membership.objects.filter(organization=self.org, user=self.commander).update(status='removed')
        revoked = self.client.get(self.pirate_path(), {'revision': downgraded.data['revision']})
        self.assertEqual(revoked.status_code, 403, revoked.data)
        self.assertNotIn('sightings', revoked.data)

    def test_conditional_snapshot_does_not_return_unchanged_after_mid_read_create(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='原目标')
        first = self.client.get(self.pirate_path()).data
        self.assertIn('revision', first)
        revision = first['revision']
        real_token = pirate.sighting_token
        created = False

        def create_after_token(board, member):
            nonlocal created
            token = real_token(board, member)
            if not created:
                created = True
                PirateSighting.objects.create(
                    board_id=self.board_id, author=self.scout, character_name='并发新增', ship_type='Gila',
                    normalized_name='并发新增', normalized_ship='gila', location_kind='system',
                    location_id=2, location_name='星系2', observed_at=timezone.now())
            return token

        with patch.object(pirate, 'sighting_token', side_effect=create_after_token):
            response = self.client.get(self.pirate_path(), {'revision': revision})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('unchanged', response.data)
        self.assertEqual({row['character_name'] for row in response.data['sightings']}, {'原目标', '并发新增'})
        self.assertNotEqual(response.data['revision'], revision)

    def test_conditional_snapshot_does_not_return_unchanged_after_mid_read_scope_change(self):
        self.client.force_authenticate(self.scout)
        self.sight(name='范围目标')
        revision = self.client.get(self.pirate_path()).data['revision']
        real_token = pirate.sighting_token
        changed = False

        def change_scope_after_token(board, member):
            nonlocal changed
            token = real_token(board, member)
            if not changed:
                changed = True
                Board.objects.filter(pk=self.board_id).update(region_ids=[2], scope_version=F('scope_version') + 1)
            return token

        with patch.object(pirate, 'sighting_token', side_effect=change_scope_after_token):
            response = self.client.get(self.pirate_path(), {'revision': revision})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('unchanged', response.data)
        self.assertEqual(response.data['scope']['region_ids'], [2])
        self.assertNotEqual(response.data['revision'], revision)

    def test_conditional_snapshot_does_not_return_unchanged_after_mid_read_role_change(self):
        self.client.force_authenticate(self.commander)
        own = self.sight(name='本人线索')
        self.client.force_authenticate(self.scout)
        self.sight(name='他人线索')
        self.client.force_authenticate(self.commander)
        revision = self.client.get(self.pirate_path()).data['revision']
        real_token = pirate.sighting_token
        changed = False

        def downgrade_after_token(board, member):
            nonlocal changed
            token = real_token(board, member)
            if not changed:
                changed = True
                Membership.objects.filter(organization=self.org, user=self.commander).update(
                    role='scout', permission_version=F('permission_version') + 1)
            return token

        with patch.object(pirate, 'sighting_token', side_effect=downgrade_after_token):
            response = self.client.get(self.pirate_path(), {'revision': revision})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertNotIn('unchanged', response.data)
        self.assertEqual(response.data['role'], 'scout')
        self.assertEqual([row['id'] for row in response.data['sightings']], [own['id']])
        self.assertNotEqual(response.data['revision'], revision)

    def test_unicode_normalization_expansion_fits_persisted_target_key(self):
        self.client.force_authenticate(self.scout)
        sight = self.sight(name='㍿' * 120)
        row = PirateSighting.objects.get(pk=sight['id'])
        self.assertEqual(len(row.normalized_name), 480)
        row.full_clean()
