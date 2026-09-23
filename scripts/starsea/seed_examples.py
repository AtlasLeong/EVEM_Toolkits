"""Create clearly fictional examples in the guarded local Starsea preview only.

Run with --test for pure, database-free regression tests. Existing seed posts
are always preserved, including edits, hidden posts and unfinished drafts.
"""

import copy
import importlib.util
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from uuid import NAMESPACE_URL, UUID, uuid5


ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / 'backend'
LOCAL_SETTINGS = 'EVE_MDjango.starsea_local_settings'
DISCLAIMER = '本地虚构示例，不代表真实战斗或招募'
KINDS = ('battle', 'story', 'announcement')
ARTWORK = {'battle': 'expedition-fleet', 'story': 'ringed-planet', 'announcement': 'orbital-shipyard'}
CAPTION = '既有科幻插画，仅作版式示例；非游戏实录、真实舰船图片或 KM。'


def example_plan(existing):
    present = {str(row['request_id']) for row in existing}
    return [{'kind': kind, 'request_id': str(uuid5(NAMESPACE_URL, 'evem/starsea/local-example/v1/' + kind))}
            for kind in KINDS
            if str(uuid5(NAMESPACE_URL, 'evem/starsea/local-example/v1/' + kind)) not in present]


def example_contents(hulls, location, corporation_id):
    def row(index, quantity):
        ship = hulls[index]
        return {'ship_id': ship['id'], 'ship_name': ship['name'], 'ship_class': ship['ship_class'], 'quantity': quantity}

    shared = {'occurred_at': None, 'location': {key: location[key] for key in
              ('region_id', 'constellation_id', 'solarsystem_id')},
              'corporation_id': corporation_id, 'images': [], 'battle': None}
    place = location['solarsystem_name']
    return {
        'battle': {**copy.deepcopy(shared), 'kind': 'battle', 'title': '演训复盘｜穿越星门后的 18 分钟',
                   'body': DISCLAIMER + '。\n\n一份用于体验战报编辑器的演训复盘：双方名称、损失与 ISK 均为虚构。'
                   '\n\n已知型号来自真实的本地历史目录；未识别型号单独保留。A 方未统计 ISK，不应当被解释为零损失。'
                   '\n\n下方插画为项目既有视觉素材，不是战斗截图或击毁记录。',
                   'battle': {'sides': [
                       {'name': '演示 · 远航编队', 'isk_loss': None, 'losses': [row(0, 4), row(1, 12), row(3, 2)]},
                       {'name': '演示 · 守望编队', 'isk_loss': '2800000000.00', 'losses': [row(0, 7), row(2, 8),
                        {'ship_id': None, 'ship_name': '', 'ship_class': '未知舰种', 'quantity': 3}]},
                   ]}},
        'story': {**copy.deepcopy(shared), 'kind': 'story', 'title': '星门以外｜把第一次远航写进日志',
                  'body': DISCLAIMER + f'。\n\n从{place}的星图开始，一名虚构飞行员把第一次远航写成了三个片段：'
                  '出发前整理补给、跃迁后确认队友，以及返航时留下的一句“下次还一起走”。'
                  '\n\n这里没有精确的战术坐标，也不提供航线安全承诺；地点取自本地静态地理目录，仅用于展示关联字段。'
                  '\n\n你可以在“我的发布”里把这篇示例改成自己的故事。改稿进入草稿后，审核通过前仍展示原来的公开版本。'},
        'announcement': {**copy.deepcopy(shared), 'kind': 'announcement', 'title': '拾光船坞｜给远航留一个集合点',
                         'body': DISCLAIMER + '。\n\n这是一张虚构的船坞宣传卡，用来展示图片、关联军团和纯文本正文的组合。'
                         '\n\n演示内容：一起整理远航清单，交流舰种分工，把任务结束后的见闻写下来。'
                         '\n\n关联“星海拾光 · 本地演示军团”仅用于页面联动，不代表任何真实军团，也不接受真实申请或支付。'},
    }


def initialize_local():
    if os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS) != LOCAL_SETTINGS:
        raise ValueError('Production or unknown settings are forbidden')
    sys.path.insert(0, str(BACKEND))
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    import django
    django.setup()
    from django.conf import settings
    spec = importlib.util.spec_from_file_location('starsea_examples_local_guard', Path(__file__).with_name('local_seed.py'))
    guard = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(guard)
    guard.require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], BACKEND)
    if not getattr(settings, 'STARSEA_LOCAL_DEMO', False):
        raise ValueError('Example creation requires the isolated Starsea preview')


def _new_corporation(owner, reviewer):
    from django.db import transaction
    from django.utils import timezone
    from Community.models import Corporation, Revision
    from Community.views import default_content

    key = uuid5(NAMESPACE_URL, 'evem/starsea/local-example/v1/corporation').hex
    with transaction.atomic():
        corporation, created = Corporation.objects.get_or_create(name_key=key, defaults={
            'name': '星海拾光 · 本地演示军团', 'short_name': 'DEMO', 'owner': owner,
        })
        if created:
            content = default_content()
            content.update({'tagline': '为虚构远航留一个集合点', 'introduction': DISCLAIMER + '。仅用于本地页面联动演示。',
                            'activity_description': '交流、记录与虚构演训；不接受真实招募申请。',
                            'recruitment_status': 'closed', 'poster_background': 'orbital-shipyard',
                            'public_contact': '本地示例，不接受申请或支付。'})
            revision = Revision.objects.create(corporation=corporation, author=owner, status='approved',
                                               content=content, reviewer=reviewer, reviewed_at=timezone.now())
            corporation.working_revision = corporation.published_revision = revision
            corporation.save(update_fields=['working_revision', 'published_revision'])
        if corporation.is_listed and corporation.published_revision_id and corporation.published_revision.status == 'approved':
            return corporation.pk
    return None


def seed_examples():
    initialize_local()
    from django.contrib.auth import get_user_model
    from django.core.files.uploadedfile import SimpleUploadedFile
    from rest_framework.test import APIClient
    from Starsea.catalog import resolve_location, resolve_ship, search_ships
    from Starsea.models import Post
    from TacticalBoard.models import BoardSystems

    users = get_user_model().objects
    owner = users.get(username='starsea_preview_pilot', email='pilot@starsea.local', is_active=True)
    reviewer = users.get(username='starsea_preview_reviewer', email='reviewer@starsea.local', is_staff=True, is_active=True)
    planned = example_plan([])
    existing = list(Post.objects.filter(author=owner, request_id__in=[row['request_id'] for row in planned]).values('id', 'request_id'))
    missing = example_plan(existing)
    existing_by_request = {str(row['request_id']): row['id'] for row in existing}
    results = [{'kind': row['kind'], 'id': existing_by_request[row['request_id']], 'preserved': True}
               for row in planned if row['request_id'] in existing_by_request]
    if not missing:
        return results

    # Resolve actual source records before any new writes; never manufacture an
    # ID/name mapping or silently substitute a custom hull for a known model.
    hulls = []
    for name in ('乌鸦级', '小鹰级', '海燕级', '巨鸟级守卫型'):
        selected = next((ship for ship in search_ships(q=name)['results'] if ship['name'] == name), None)
        if selected is None:
            raise ValueError('Required source hull is unavailable: ' + name)
        hulls.append(resolve_ship(selected['id']))
    system = BoardSystems.objects.select_related('constellation').filter(zh_name='吉他').first()
    if system is None:
        raise ValueError('The existing offline geography has no 吉他 record')
    location = resolve_location({'region_id': system.constellation.region_id,
                                 'constellation_id': system.constellation_id, 'solarsystem_id': system.pk})
    assets = ROOT / 'front-codex/src/assets/corporations/posters'
    illustration_bytes = {row['kind']: (assets / (ARTWORK[row['kind']] + '.webp')).read_bytes() for row in missing}
    corporation_id = _new_corporation(owner, reviewer)
    contents = example_contents(hulls, location, corporation_id)
    author_client, reviewer_client = APIClient(), APIClient()
    author_client.force_authenticate(owner)
    reviewer_client.force_authenticate(reviewer)

    def checked(response, expected):
        if response.status_code != expected:
            raise RuntimeError('Local example API returned %s instead of %s: %s' %
                               (response.status_code, expected, response.content[:500]))
        return response.json()

    def expected(entry):
        return {'expected_revision_id': entry['revision']['id'], 'expected_version': entry['revision']['version']}

    for item in missing:
        kind = item['kind']
        entry = checked(author_client.post('/api/starsea/posts/',
                        {'request_id': item['request_id'], 'content': contents[kind]}, format='json'), 201)
        path = '/api/starsea/posts/%d/' % entry['id']
        request_id = str(uuid5(NAMESPACE_URL, 'evem/starsea/local-example/v1/image/' + kind))
        upload = SimpleUploadedFile(ARTWORK[kind] + '.webp', illustration_bytes[kind], content_type='image/webp')
        image = checked(author_client.post(path + 'media/', {'request_id': request_id, 'file': upload}, format='multipart'), 201)
        entry = checked(author_client.patch(path + 'draft/', {**expected(entry),
                        'content': {'images': [{'id': image['id'], 'caption': CAPTION}]}}, format='json'), 200)
        entry = checked(author_client.post(path + 'submit/', expected(entry), format='json'), 200)
        reviewed = checked(reviewer_client.post('/api/starsea/reviews/%d/decision/' % entry['revision']['id'],
                           {'decision': 'approve', 'reason': DISCLAIMER, 'expected_version': entry['revision']['version']}, format='json'), 200)
        results.append({'kind': kind, 'id': reviewed['id'], 'preserved': False, 'corporation_id': corporation_id,
                        'image_id': image['id']})
    return results


class ExamplePlanTests(unittest.TestCase):
    def implementation(self, name):
        value = globals().get(name)
        self.assertTrue(callable(value), 'Missing example seed implementation: ' + name)
        return value

    def test_plan_has_three_stable_unique_request_ids(self):
        plan = self.implementation('example_plan')([])
        self.assertEqual([row['kind'] for row in plan], ['battle', 'story', 'announcement'])
        self.assertEqual(plan, self.implementation('example_plan')([]))
        self.assertEqual(len({row['request_id'] for row in plan}), 3)
        self.assertTrue(all(UUID(row['request_id']).version == 5 for row in plan))

    def test_edited_existing_post_is_omitted_without_mutation(self):
        function = self.implementation('example_plan')
        existing = [{**function([])[0], 'id': 99, 'body': '用户后来的编辑', 'is_listed': False}]
        before = copy.deepcopy(existing)
        self.assertEqual([row['kind'] for row in function(existing)], ['story', 'announcement'])
        self.assertEqual(existing, before)

    def test_complete_existing_set_makes_repeat_a_noop(self):
        function = self.implementation('example_plan')
        self.assertEqual(function(function([])), [])

    def test_content_has_all_three_kinds_and_explicit_fiction_notice(self):
        hulls = [{'id': index, 'name': '真实源名%d' % index, 'ship_class': '护卫舰'} for index in range(1, 5)]
        location = {'region_id': 1, 'constellation_id': 10, 'solarsystem_id': 100, 'solarsystem_name': '吉他'}
        records = self.implementation('example_contents')(hulls, location, 123)
        self.assertEqual(set(records), {'battle', 'story', 'announcement'})
        for kind, content in records.items():
            self.assertEqual(content['kind'], kind)
            self.assertIn('本地虚构示例，不代表真实战斗或招募', content['body'])
            self.assertEqual(content['corporation_id'], 123)
            self.assertEqual(content['images'], [])
            self.assertEqual(set(content['location']), {'region_id', 'constellation_id', 'solarsystem_id'})
        known = [row for side in records['battle']['battle']['sides'] for row in side['losses'] if row['ship_id']]
        self.assertTrue(all(row['ship_name'].startswith('真实源名') for row in known))
        self.assertIsNone(records['battle']['battle']['sides'][0]['isk_loss'])
        self.assertIsNone(records['story']['battle'])

    def test_bootstrap_refuses_nonlocal_settings_before_database_work(self):
        initialize = self.implementation('initialize_local')
        with patch.dict(os.environ, {'DJANGO_SETTINGS_MODULE': 'EVE_MDjango.settings'}):
            with self.assertRaises(ValueError):
                initialize()


if __name__ == '__main__':
    if sys.argv[1:] == ['--test']:
        unittest.main(argv=[sys.argv[0]])
    elif sys.argv[1:]:
        raise SystemExit('Usage: python scripts/starsea/seed_examples.py [--test]')
    else:
        print(json.dumps(seed_examples(), ensure_ascii=False, indent=2))
