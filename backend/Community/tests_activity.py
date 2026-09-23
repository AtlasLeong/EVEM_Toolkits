"""Activity contracts, including immutable legacy snapshots and strict writes."""
import copy
import json
from types import SimpleNamespace
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from . import views
from .models import Corporation, Revision


CURRENT_ACTIVITIES = ('sovereignty_production', 'pirate_combat', 'pve', 'industry',
                      'exploration', 'mining', 'training')
ACTIVITY_LABELS = ('主权生产', '海盗作战', '异常与任务', '工业制造', '星海探索',
                   '采矿生产', '新人培养', '舰队作战', '舰队作战（旧标签）', '舰队作战(旧标签)')


class CorporationActivityTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('activity-owner')
        self.staff = get_user_model().objects.create_user('activity-reviewer', is_staff=True)
        self.corporation = Corporation.objects.create(
            name='活动军团', name_key='activity-test', owner=self.owner)
        self.revision = Revision.objects.create(
            corporation=self.corporation, author=self.owner, content=views.default_content())
        self.corporation.working_revision = self.revision
        self.corporation.save(update_fields=['working_revision'])
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def call(self, method, path, data=None):
        return getattr(self.client, method)('/api/community/' + path, data, format='json')

    def edit(self, **content):
        self.revision.refresh_from_db()
        return self.call('patch', f'revisions/{self.revision.pk}/', {
            'expected_version': self.revision.version, **content,
        })

    def store(self, content):
        self.revision.content = copy.deepcopy(content)
        activities = content.get('activities', []) if isinstance(content, dict) else []
        activities = activities if isinstance(activities, list) else []
        self.revision.activity_keys = ''.join(f'|{key}|' for key in activities)
        self.revision.save(update_fields=['content', 'activity_keys'])

    def approve_snapshot(self, content):
        self.store(content)
        self.revision.status = 'approved'
        self.revision.reviewed_at = timezone.now()
        self.revision.save(update_fields=['status', 'reviewed_at'])
        self.corporation.published_revision = self.revision
        self.corporation.save(update_fields=['published_revision'])

    def test_new_draft_defaults_to_empty_overview(self):
        response = self.call('get', f'corporations/{self.corporation.pk}/manage/')
        draft = response.json()['working_revision']
        self.assertEqual(draft.get('activity_description'), '')
        self.assertEqual(draft.get('custom_activity_tags'), [])
        self.assertEqual(draft.get('activity_content_kind'), 'overview')
        self.assertIn('activity_description', self.revision.content)

    def test_new_fields_and_all_current_activities_round_trip(self):
        response = self.edit(activity_description='  主权战与反收割  ',
                             custom_activity_tags=['  反收割  ', 'Ｆｌｅｅｔ'],
                             activities=list(CURRENT_ACTIVITIES))
        self.assertEqual(response.status_code, 200, response.content)
        data = response.json()
        self.assertEqual(data['activity_description'], '主权战与反收割')
        self.assertEqual(data['custom_activity_tags'], ['反收割', 'Ｆｌｅｅｔ'])
        self.assertEqual(data['activities'], list(CURRENT_ACTIVITIES))
        self.assertEqual(data['activity_content_kind'], 'overview')
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.version, 2)
        self.assertEqual(self.revision.content['custom_activity_tags'], ['反收割', 'Ｆｌｅｅｔ'])
        self.assertNotIn('反收割', self.revision.activity_keys)
        self.assertLessEqual(len(self.revision.activity_keys), 100)

    def test_unicode_code_point_and_exact_limits_are_accepted(self):
        tags = ['😀' * 12, '反收割', '小队游猎', '生产协作', '每周演练']
        response = self.edit(activity_description='星' * 1500, custom_activity_tags=tags)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['custom_activity_tags'], tags)
        self.assertEqual(len(response.json()['activity_description']), 1500)

    def test_description_rejects_wrong_type_and_overflow_without_mutation(self):
        before = copy.deepcopy(self.revision.content)
        for value in (None, False, [], {}, 1, '星' * 1501):
            with self.subTest(value=value):
                response = self.edit(activity_description=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('activity_description', response.json())
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, before)
        self.assertEqual(self.revision.version, 1)

    def test_custom_tags_reject_invalid_types_empty_and_overflow(self):
        for value in (None, '', {}, 1, [None], [False], [1], [[]], [{}], [''], ['  '],
                      ['😀' * 13], ['甲', '乙', '丙', '丁', '戊', '己']):
            with self.subTest(value=value):
                response = self.edit(custom_activity_tags=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('custom_activity_tags', response.json())
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.version, 1)

    def test_custom_tags_reject_controls_newlines_and_invisible_format_characters(self):
        for value in ('反\n收割', '\n反收割', '反收割\t', '反\r收割', '反\x00收割',
                      '反\x7f收割', '反\x85收割', '反\u200b收割', '反\u202e收割',
                      '反\ufeff收割', '反\u2028收割', '反\u2029收割'):
            with self.subTest(value=repr(value)):
                response = self.edit(custom_activity_tags=[value])
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('custom_activity_tags', response.json())

    def test_custom_tags_use_nfkc_and_full_unicode_casefold_for_duplicates(self):
        for value in (['ＦＬＥＥＴ', 'fleet'], [' Straße ', 'STRASSE'],
                      ['é', 'e\u0301'], ['Σ', 'ς'], ['反收割', ' 反收割 ']):
            with self.subTest(value=value):
                response = self.edit(custom_activity_tags=value)
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('custom_activity_tags', response.json())

    def test_new_text_fields_reject_unpaired_surrogates_before_persistence(self):
        self.client.raise_request_exception = False
        before = copy.deepcopy(self.revision.content)
        for field in ('custom_activity_tags', 'activity_description'):
            for surrogate in ('\ud800', '\udfff'):
                with self.subTest(field=field, surrogate=repr(surrogate)):
                    self.revision.refresh_from_db()
                    value = [surrogate] if field == 'custom_activity_tags' else surrogate
                    # Raw escaped JSON reaches the parser without client UTF-8 encoding it.
                    response = self.client.generic('PATCH', f'/api/community/revisions/{self.revision.pk}/',
                                                   json.dumps({'expected_version': self.revision.version,
                                                               field: value}), content_type='application/json')
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(field, response.json())
                    self.revision.refresh_from_db()
                    self.assertEqual(self.revision.content, before)
                    self.assertEqual(self.revision.version, 1)

    def test_malformed_unicode_in_new_stored_fields_is_safe_to_read(self):
        stored = {'custom_activity_tags': ['坏\ud800标签', '反收割'],
                  'activity_description': '坏\udfff介绍'}
        self.approve_snapshot(stored)
        self.client.raise_request_exception = False
        response = self.call('get', f'corporations/{self.corporation.pk}/')
        self.assertEqual(response.status_code, 200)
        payload = response.json()['revision']
        self.assertEqual(payload['custom_activity_tags'], ['反收割'])
        self.assertEqual(payload['activity_description'], '')
        self.assertEqual(payload['activity_content_kind'], 'overview')
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, stored)

    def test_custom_tags_cannot_duplicate_any_current_or_legacy_builtin_label(self):
        for label in ACTIVITY_LABELS:
            with self.subTest(label=label):
                response = self.edit(custom_activity_tags=[' ' + label + ' '])
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('custom_activity_tags', response.json())

    def test_reserved_legacy_display_tags_are_safe_read_without_mutation(self):
        stored = {'custom_activity_tags': ['舰队作战（旧标签）', '舰队作战(旧标签)', '反收割']}
        revision = SimpleNamespace(pk=1, content=copy.deepcopy(stored))
        self.assertEqual(views.revision_data(revision, public=True)['custom_activity_tags'], ['反收割'])
        self.assertEqual(revision.content, stored)

    def test_pvp_cannot_be_newly_added_or_authorized_by_malformed_legacy_values(self):
        for old in ([], 'pvp', {'pvp': True}, None):
            with self.subTest(old=old):
                self.store({'activities': old})
                response = self.edit(activities=['pvp'])
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('activities', response.json())
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.version, 1)

    def test_existing_pvp_is_preserved_but_cannot_be_readded_after_removal(self):
        self.store({'activities': ['pvp'], 'event_description': '旧活动'})
        response = self.edit(activities=['pvp', *CURRENT_ACTIVITIES])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['activities'], ['pvp', *CURRENT_ACTIVITIES])
        self.revision.refresh_from_db()
        self.assertLessEqual(len(self.revision.activity_keys), 100)
        response = self.edit(activities=['pirate_combat'])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.edit(activities=['pvp', 'pirate_combat']).status_code, 400)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content['activities'], ['pirate_combat'])

    def test_legacy_kind_uses_raw_presence_and_reads_do_not_mutate_snapshot(self):
        legacy = {'activities': ['pvp'], 'event_title': '  历史标题  ', 'event_time': '旧时间',
                  'event_location': '旧集结点', 'event_description': '原文\n第二行'}
        for extra, kind, description in (({}, 'legacy_event', ''),
                                          ({'activity_description': ''}, 'overview', ''),
                                          ({'activity_description': None}, 'overview', '')):
            with self.subTest(extra=extra):
                stored = {**legacy, **extra}
                revision = SimpleNamespace(pk=1, content=copy.deepcopy(stored))
                payload = views.revision_data(revision, public=True)
                self.assertEqual(payload.get('activity_content_kind'), kind)
                self.assertEqual(payload.get('activity_description'), description)
                self.assertEqual(payload.get('custom_activity_tags'), [])
                for key, value in legacy.items():
                    self.assertEqual(payload[key], value)
                self.assertEqual(revision.content, stored)

    def test_malformed_activity_reads_are_bounded_safe_and_nonmutating(self):
        stored = {
            'activities': [None, {}, [], 'unknown', 'pvp', 'pvp', 'pirate_combat'],
            'activity_description': ['bad'],
            'custom_activity_tags': [None, {}, [], '', '主权生产', '坏\u200b标签',
                                     'Ｆleet', 'fleet', '甲' * 13, ' 反收割 ', '甲', '乙', '丙', '丁'],
        }
        revision = SimpleNamespace(pk=1, content=copy.deepcopy(stored))
        payload = views.revision_data(revision, public=True)
        self.assertEqual(payload.get('activities'), ['pvp', 'pirate_combat'])
        self.assertEqual(payload.get('activity_description'), '')
        self.assertEqual(payload.get('custom_activity_tags'), ['Ｆleet', '反收割', '甲', '乙', '丙'])
        self.assertEqual(payload.get('activity_content_kind'), 'overview')
        self.assertEqual(revision.content, stored)
        for value in (None, [], 'bad', 5, True):
            revision = SimpleNamespace(pk=1, content=value)
            payload = views.revision_data(revision, public=True)
            self.assertEqual(payload.get('activity_content_kind'), 'legacy_event')
            self.assertEqual(payload.get('custom_activity_tags'), [])
            self.assertEqual(revision.content, value)

    def test_malformed_root_snapshot_is_safe_on_public_list_and_detail(self):
        self.approve_snapshot(['historical malformed root'])
        for path in (f'corporations/{self.corporation.pk}/', 'corporations/'):
            with self.subTest(path=path):
                response = self.call('get', path)
                self.assertEqual(response.status_code, 200, response.content)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, ['historical malformed root'])

    def test_malformed_root_snapshot_never_authorizes_public_media(self):
        self.approve_snapshot(['historical malformed root'])
        response = self.call('get', f'corporations/{self.corporation.pk}/media/1/')
        self.assertEqual(response.status_code, 404, response.content)
        self.revision.refresh_from_db()
        self.assertEqual(self.revision.content, ['historical malformed root'])

    def test_kind_is_read_only_and_cannot_be_injected_into_content(self):
        response = self.edit(activity_content_kind='overview')
        self.assertEqual(response.status_code, 400, response.content)
        self.revision.refresh_from_db()
        self.assertNotIn('activity_content_kind', self.revision.content)

    def test_current_filters_do_not_match_legacy_pvp_and_new_tags_are_not_filters(self):
        self.approve_snapshot({'activities': ['pvp'], 'event_description': '旧活动'})
        for activity, count in [('pvp', 1), ('sovereignty_production', 0), ('pirate_combat', 0)]:
            response = self.call('get', f'corporations/?activity={activity}')
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(response.json()['count'], count)
        self.assertEqual(self.call('get', 'corporations/?activity=反收割').status_code, 400)

    def test_overview_changes_keep_old_public_until_approved_and_preserve_event_text(self):
        legacy = {'activities': ['pvp'], 'introduction': '军团介绍', 'public_contact': '公开联系',
                  'event_title': '  历史标题  ', 'event_time': '旧时间',
                  'event_location': '旧集结点', 'event_description': '原文\n第二行'}
        self.approve_snapshot(legacy)
        old_revision = self.revision
        public_path = f'corporations/{self.corporation.pk}/'
        old_public = self.call('get', public_path).json()
        self.assertEqual(old_public['revision'].get('activity_content_kind'), 'legacy_event')
        draft = self.call('post', f'corporations/{self.corporation.pk}/draft/',
                          {'request_id': str(uuid4())})
        self.assertEqual(draft.status_code, 201, draft.content)
        self.assertEqual(draft.json().get('activity_content_kind'), 'legacy_event')
        self.revision = Revision.objects.get(pk=draft.json()['id'])
        response = self.edit(activity_description='', custom_activity_tags=['反收割'],
                             activities=['sovereignty_production', 'pirate_combat'])
        self.assertEqual(response.status_code, 200, response.content)
        updated = response.json()
        self.assertEqual(updated['activity_content_kind'], 'overview')
        self.assertEqual(updated['activity_description'], '')
        stale = self.call('patch', f'revisions/{self.revision.pk}/', {
            'expected_version': 1, 'custom_activity_tags': ['过期内容'],
        })
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.call('get', public_path).json(), old_public)
        pending = self.call('post', f'revisions/{self.revision.pk}/submit/',
                            {'expected_version': updated['version']})
        self.assertEqual(pending.status_code, 200, pending.content)
        self.assertEqual(self.edit(activity_description='禁止修改').status_code, 409)
        self.assertEqual(self.call('get', public_path).json(), old_public)
        self.assertEqual(self.call('get', 'corporations/?activity=pirate_combat').json()['count'], 0)
        self.client.force_authenticate(self.staff)
        review = self.call('get', f'reviews/revisions/{self.revision.pk}/').json()
        self.assertEqual(review['custom_activity_tags'], ['反收割'])
        self.assertEqual(review['activity_content_kind'], 'overview')
        for key in ('event_title', 'event_time', 'event_location', 'event_description'):
            self.assertEqual(review[key], legacy[key])
        approved = self.call('post', f'reviews/revisions/{self.revision.pk}/decision/',
                             {'decision': 'approve', 'reason': ''})
        self.assertEqual(approved.status_code, 200, approved.content)
        self.client = APIClient()
        public = self.call('get', public_path).json()['revision']
        self.assertEqual(public['activity_description'], '')
        self.assertEqual(public['activity_content_kind'], 'overview')
        self.assertEqual(public['custom_activity_tags'], ['反收割'])
        self.assertEqual(self.call('get', 'corporations/?activity=pirate_combat').json()['count'], 1)
        self.assertEqual(self.call('get', 'corporations/?activity=pvp').json()['count'], 0)
        old_revision.refresh_from_db()
        self.assertEqual(old_revision.content, legacy)
