import copy
import io
import tempfile
from pathlib import Path
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from PIL import Image, PngImagePlugin
from rest_framework.test import APIClient


class StarseaAPITests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('star-owner')
        self.other = get_user_model().objects.create_user('star-other')
        self.staff = get_user_model().objects.create_user('star-reviewer', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.config = override_settings(STARSEA_UPLOAD_ROOT=self.tmp.name)
        self.config.enable()
        self.addCleanup(self.config.disable)

    def call(self, method, path, data=None):
        return getattr(self.client, method)('/api/starsea/' + path, data, format='json')

    def create(self, content=None, request_id=None):
        data = {'request_id': request_id or str(uuid4()), 'content': content or {}}
        response = self.call('post', 'posts/', data)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json(), data

    def expected(self, entry):
        return {'expected_revision_id': entry['revision']['id'], 'expected_version': entry['revision']['version']}

    def edit(self, entry, content):
        response = self.call('patch', f"posts/{entry['id']}/draft/", {**self.expected(entry), 'content': content})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def submit(self, entry):
        response = self.call('post', f"posts/{entry['id']}/submit/", self.expected(entry))
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def publish(self, entry):
        pending = self.submit(entry)
        self.client.force_authenticate(self.staff)
        response = self.call('post', f"reviews/{pending['revision']['id']}/decision/", {
            'expected_version': pending['revision']['version'], 'decision': 'approve', 'reason': ''})
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(self.owner)
        return response.json()

    def ready(self):
        return self.create({'kind': 'story', 'title': '星海故事', 'body': '正文'})[0]

    def image(self, post_id, request_id=None, raw=None, name='a.png'):
        if raw is None:
            buf = io.BytesIO()
            info = PngImagePlugin.PngInfo()
            info.add_text('private', 'remove me')
            Image.new('RGB', (30, 20), 'red').save(buf, 'PNG', pnginfo=info)
            raw = buf.getvalue()
        return self.client.post(f'/api/starsea/posts/{post_id}/media/', {
            'request_id': request_id or str(uuid4()), 'file': SimpleUploadedFile(name, raw)}, format='multipart')

    def test_blank_create_and_idempotent_request(self):
        entry, data = self.create()
        self.assertEqual(entry['revision']['status'], 'draft')
        self.assertEqual(entry['revision']['content']['images'], [])
        retry = self.call('post', 'posts/', data)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['id'], entry['id'])
        self.assertEqual(self.call('post', 'posts/', {**data, 'content': {'title': 'changed'}}).status_code, 409)
        self.assertEqual(self.call('post', f"posts/{entry['id']}/submit/", self.expected(entry)).status_code, 400)

    def test_draft_private_and_owner_only(self):
        entry = self.ready()
        self.assertEqual(self.call('get', 'posts/').json(), {'count': 0, 'results': []})
        self.assertEqual(self.call('get', f"posts/{entry['id']}/").status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.call('get', 'mine/').json()['count'], 0)
        for method, path, payload in [('get', 'manage/', None), ('patch', 'draft/', {**self.expected(entry), 'content': {}}), ('post', 'submit/', self.expected(entry))]:
            self.assertEqual(self.call(method, f"posts/{entry['id']}/{path}", payload).status_code, 404)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('get', f"posts/{entry['id']}/manage/").status_code, 200)
        self.assertEqual(self.call('patch', f"posts/{entry['id']}/draft/", {**self.expected(entry), 'content': {}}).status_code, 404)

    def test_pending_snapshot_withdraw_clones_and_conflicts(self):
        entry = self.ready()
        from .models import Revision
        pending = self.submit(entry)
        path = f"posts/{entry['id']}/draft/"
        self.assertEqual(self.call('patch', path, {**self.expected(pending), 'content': {'title': 'bad'}}).status_code, 409)
        self.assertEqual(self.call('post', path, self.expected(pending)).status_code, 409)
        self.assertEqual(self.call('post', f"posts/{entry['id']}/withdraw/", self.expected(entry)).status_code, 409)
        response = self.call('post', f"posts/{entry['id']}/withdraw/", self.expected(pending))
        self.assertEqual(response.status_code, 200)
        draft = response.json()
        self.assertNotEqual(draft['revision']['id'], pending['revision']['id'])
        self.assertEqual(draft['revision']['status'], 'draft')
        self.edit(draft, {'title': '修改'})
        old = Revision.objects.get(pk=pending['revision']['id'])
        self.assertEqual(old.content['title'], '星海故事')
        self.assertEqual(old.status, 'withdrawn')

    def test_publication_remains_unchanged_during_editing_and_rejection(self):
        approved = self.publish(self.ready())
        response = self.call('post', f"posts/{approved['id']}/draft/", self.expected(approved))
        self.assertEqual(response.status_code, 201)
        draft = self.edit(response.json(), {'title': '私有改稿'})
        self.assertEqual(self.call('get', f"posts/{approved['id']}/").json()['revision']['content']['title'], '星海故事')
        pending = self.submit(draft)
        self.client.force_authenticate(self.staff)
        rejection = self.call('post', f"reviews/{pending['revision']['id']}/decision/", {'expected_version': pending['revision']['version'], 'decision': 'reject', 'reason': '私有审核原因'})
        self.assertEqual(rejection.status_code, 200)
        self.client = APIClient()
        public = self.call('get', f"posts/{approved['id']}/")
        self.assertNotIn('私有', public.content.decode())
        self.assertNotIn('published_revision_id', public.json())
        self.assertNotIn('review_reason', public.json()['revision'])

    def test_approval_stale_version_and_visibility_audit(self):
        pending = self.submit(self.ready())
        from .models import Post, Revision
        self.assertEqual(self.call('get', 'reviews/').status_code, 403)
        self.client.force_authenticate(self.staff)
        path = f"reviews/{pending['revision']['id']}/decision/"
        self.assertEqual(self.call('post', path, {'expected_version': 1, 'decision': 'approve', 'reason': ''}).status_code, 409)
        result = self.call('post', path, {'expected_version': pending['revision']['version'], 'decision': 'approve', 'reason': '核验'})
        self.assertEqual(result.status_code, 200)
        revision = Revision.objects.get(pk=pending['revision']['id'])
        self.assertEqual(revision.reviewer_id, self.staff.pk)
        self.assertIsNotNone(revision.reviewed_at)
        visibility = self.call('post', f"posts/{pending['id']}/visibility/", {'is_listed': False, 'reason': '隐藏原因'})
        self.assertEqual(visibility.status_code, 200)
        post = Post.objects.get(pk=pending['id'])
        self.assertEqual(post.moderator_id, self.staff.pk)
        self.assertEqual(post.moderation_reason, '隐藏原因')
        self.assertIsNotNone(post.moderated_at)
        self.assertEqual(self.call('get', f"posts/{post.pk}/").status_code, 404)

    def test_invalid_json_shapes_unknown_fields_unicode_and_limits(self):
        for value in ([], 'text', True, None):
            response = self.client.generic('POST', '/api/starsea/posts/', __import__('json').dumps(value), content_type='application/json')
            self.assertEqual(response.status_code, 400)
        for content in ({'unknown': 1}, {'title': 1}, {'title': 'a' * 121}, {'body': 'a' * 20001}, {'title': '\ud800'}, {'body': 'bad\x00'}, {'kind': []}, {'corporation_id': True}, {'images': [{}] * 13}, {'occurred_at': 'not date'}, {'summary': {}}):
            with self.subTest(content=str(content)[:80]):
                response = self.client.generic('POST', '/api/starsea/posts/', __import__('json').dumps({'request_id': str(uuid4()), 'content': content}), content_type='application/json')
                self.assertEqual(response.status_code, 400, response.content)

    def test_battle_unknown_model_null_isk_and_authoritative_totals(self):
        content = {'kind': 'battle', 'title': '战报', 'battle': {'sides': [
            {'name': '我方', 'isk_loss': None, 'losses': [{'ship_id': None, 'ship_name': '', 'ship_class': '战列舰', 'quantity': 3}, {'ship_id': None, 'ship_name': '未知改型', 'ship_class': '战列舰', 'quantity': 2}]},
            {'name': '对方', 'isk_loss': '0', 'losses': []}]}}
        entry, _ = self.create(content)
        sides = entry['summary']['sides']
        self.assertEqual(sides[0], {'name': '我方', 'total_ships': 5, 'by_class': [{'name': '战列舰', 'quantity': 5}], 'isk_loss': None})
        self.assertEqual(sides[1]['isk_loss'], '0.00')
        self.assertEqual(entry['revision']['content']['battle']['sides'][0]['losses'][0]['ship_name'], '未知型号')
        self.assertTrue(entry['revision']['content']['battle']['sides'][0]['losses'][0]['is_custom'])
        self.publish(entry)

    def test_battle_limits_strict_types_and_isk(self):
        base = {'kind': 'battle', 'battle': {'sides': [{'name': 'A', 'isk_loss': None, 'losses': []}, {'name': 'B', 'isk_loss': None, 'losses': []}]}}
        for value in (-1, 'NaN', '1e3', '1.234', '1000000000000000.01', 5, True, []):
            content = copy.deepcopy(base)
            content['battle']['sides'][0]['isk_loss'] = value
            self.assertEqual(self.call('post', 'posts/', {'request_id': str(uuid4()), 'content': content}).status_code, 400)
        for quantity in (0, -1, 100001, True, '1'):
            content = copy.deepcopy(base)
            content['battle']['sides'][0]['losses'] = [{'ship_id': None, 'ship_name': '', 'ship_class': '', 'quantity': quantity}]
            self.assertEqual(self.call('post', 'posts/', {'request_id': str(uuid4()), 'content': content}).status_code, 400)
        content = copy.deepcopy(base)
        content['battle']['sides'][0]['losses'] = [{'ship_id': None, 'ship_name': '', 'ship_class': '', 'quantity': 1}] * 101
        self.assertEqual(self.call('post', 'posts/', {'request_id': str(uuid4()), 'content': content}).status_code, 400)

    def test_private_media_cleaning_public_reference_and_hiding(self):
        entry = self.ready()
        uploaded = self.image(entry['id'])
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        asset = uploaded.json()
        response = self.client.get(asset['url'])
        self.assertIn('no-store', response['Cache-Control'])
        raw = b''.join(response.streaming_content)
        response.close()
        with Image.open(io.BytesIO(raw)) as clean:
            self.assertEqual(clean.format, 'WEBP')
            self.assertNotIn('private', clean.info)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(asset['url']).status_code, 404)
        other = self.ready()
        self.assertEqual(self.call('patch', f"posts/{other['id']}/draft/", {**self.expected(other), 'content': {'images': [{'id': asset['id'], 'caption': ''}]}}).status_code, 400)
        self.client.force_authenticate(self.owner)
        entry = self.edit(entry, {'images': [{'id': asset['id'], 'caption': 'KM'}]})
        self.publish(entry)
        self.client = APIClient()
        response = self.client.get(asset['url'])
        self.assertEqual(response.status_code, 200)
        response.close()
        self.client.force_authenticate(self.staff)
        self.call('post', f"posts/{entry['id']}/visibility/", {'is_listed': False, 'reason': '撤下'})
        self.client = APIClient()
        self.assertEqual(self.client.get(asset['url']).status_code, 404)

    def test_upload_idempotence_failed_attempts_and_predecode_quota(self):
        entry = self.ready()
        request_id = str(uuid4())
        uploaded = self.image(entry['id'], request_id=request_id)
        self.assertEqual(uploaded.status_code, 201)
        with patch('Starsea.views.sanitized_image', side_effect=AssertionError('must not decode')):
            self.assertEqual(self.image(entry['id'], request_id=request_id).status_code, 200)
            self.assertEqual(self.image(entry['id'], request_id=request_id, raw=b'changed').status_code, 409)
            with override_settings(STARSEA_MEDIA_PER_DAY=1):
                self.assertEqual(self.image(entry['id']).status_code, 429)
        with override_settings(STARSEA_MEDIA_ATTEMPTS_PER_DAY=3):
            self.assertEqual(self.image(entry['id'], raw=b'fake1').status_code, 400)
            self.assertEqual(self.image(entry['id'], raw=b'fake2').status_code, 400)
            with patch('Starsea.views.sanitized_image', side_effect=AssertionError('must not decode')):
                self.assertEqual(self.image(entry['id'], raw=b'fake3').status_code, 429)

    def test_storage_rejects_relative_and_public_paths(self):
        entry = self.ready()
        for root in ('relative', str(Path(self.tmp.name) / 'static')):
            with override_settings(STARSEA_UPLOAD_ROOT=root):
                self.assertEqual(self.image(entry['id']).status_code, 503)
        with override_settings(STATICFILES_DIRS=[('prefix', self.tmp.name)]):
            self.assertEqual(self.image(entry['id']).status_code, 503)

    def test_queries_and_path_ids_are_bounded(self):
        for query in ('page=0', 'page=10001', 'page=1.2', 'q=' + 'a' * 121, 'kind=bad', 'region_id=0', 'q=a&q=b', 'extra=1'):
            self.assertEqual(self.call('get', 'posts/?' + query).status_code, 400, query)
        for number in (0, 9223372036854775808):
            self.assertEqual(self.call('get', f'posts/{number}/').status_code, 400)
        for index in range(21):
            self.create({'title': str(index)})
        page = self.call('get', 'mine/').json()
        self.assertEqual(page['count'], 21)
        self.assertEqual(len(page['results']), 20)
        self.assertEqual(len(self.call('get', 'mine/?page=2').json()['results']), 1)

    def test_private_responses_and_errors_never_cached(self):
        for path in ('mine/', 'capabilities/', 'reviews/', 'posts/9999/manage/', 'media/9999/'):
            response = self.call('get', path)
            self.assertIn('no-store', response.get('Cache-Control', ''))
            self.assertIn('Authorization', response.get('Vary', ''))
        self.assertFalse(self.call('get', 'capabilities/').json()['can_review'])
        self.client = APIClient()
        self.assertEqual(self.call('post', 'posts/', {}).status_code, 401)

    def test_twenty_corporation_links_use_constant_queries_and_display_name(self):
        from Community.models import Corporation, Revision as CorporationRevision
        self.owner.first_name = '星海作者'
        self.owner.save(update_fields=['first_name'])
        corporation = Corporation.objects.create(name='公开军团', name_key='test', owner=self.owner)
        revision = CorporationRevision.objects.create(corporation=corporation, author=self.owner, status='approved')
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        for index in range(20):
            entry, _ = self.create({'title': str(index), 'body': '内容', 'corporation_id': corporation.pk})
            self.publish(entry)
        self.client = APIClient()
        with self.assertNumQueries(3):
            response = self.call('get', 'posts/')
        self.assertEqual(len(response.json()['results']), 20)
        self.assertEqual(response.json()['results'][0]['author_name'], '星海作者')
        self.assertEqual(response.json()['results'][0]['corporation']['name'], '公开军团')

    def test_create_retry_survives_linked_corporation_becoming_hidden(self):
        from Community.models import Corporation, Revision as CorporationRevision
        corporation = Corporation.objects.create(name='后来隐藏', name_key='hidden', owner=self.owner)
        revision = CorporationRevision.objects.create(corporation=corporation, author=self.owner, status='approved')
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        entry, payload = self.create({'corporation_id': corporation.pk})
        corporation.is_listed = False
        corporation.save(update_fields=['is_listed'])
        retry = self.call('post', 'posts/', payload)
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['id'], entry['id'])
        self.assertIsNone(retry.json()['corporation'])

    def test_same_version_different_revision_conflicts_and_withdraw_blocks_old_review(self):
        pending = self.submit(self.ready())
        draft = self.call('post', f"posts/{pending['id']}/withdraw/", self.expected(pending)).json()
        payload = {**self.expected(draft), 'expected_revision_id': pending['revision']['id'], 'content': {'title': 'bad'}}
        self.assertEqual(self.call('patch', f"posts/{draft['id']}/draft/", payload).status_code, 409)
        self.client.force_authenticate(self.staff)
        response = self.call('post', f"reviews/{pending['revision']['id']}/decision/", {'expected_version': pending['revision']['version'], 'decision': 'approve', 'reason': ''})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.call('get', f"reviews/{draft['revision']['id']}/").status_code, 404)

    def test_three_kind_submission_requirements_and_rejection_reason(self):
        for kind in ('story', 'announcement'):
            empty, _ = self.create({'kind': kind, 'title': '只有标题'})
            self.assertEqual(self.call('post', f"posts/{empty['id']}/submit/", self.expected(empty)).status_code, 400)
            ready = self.edit(empty, {'body': '正文'})
            self.publish(ready)
        battle, _ = self.create({'kind': 'battle', 'title': '战报'})
        self.assertEqual(self.call('post', f"posts/{battle['id']}/submit/", self.expected(battle)).status_code, 400)
        pending = self.submit(self.ready())
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('post', f"reviews/{pending['revision']['id']}/decision/", {'expected_version': pending['revision']['version'], 'decision': 'reject', 'reason': ''}).status_code, 400)

    def test_canonical_ship_api_normalization_from_pinned_fixture(self):
        from . import catalog
        from .tests_catalog import create_ship_fixture
        path = Path(self.tmp.name) / 'echoes.db'
        digest = create_ship_fixture(path)
        with override_settings(STARSEA_SHIP_DB=path), patch.object(catalog, 'PINNED_SHA256', digest):
            self.assertEqual(self.call('get', 'ships/').json()['count'], 26)
            self.assertEqual(len(self.call('get', 'ships/?page=2').json()['results']), 6)
            content = {'kind': 'battle', 'title': '真实型号', 'battle': {'sides': [
                {'name': 'A', 'isk_loss': None, 'losses': [{'ship_id': 10100000000, 'ship_name': '伪造舰名', 'ship_class': '伪造舰种', 'quantity': 8}]},
                {'name': 'B', 'isk_loss': '1000000000000000', 'losses': []}]}}
            entry, payload = self.create(content)
            row = entry['revision']['content']['battle']['sides'][0]['losses'][0]
            self.assertEqual(row, {'ship_id': 10100000000, 'ship_name': '本地护卫00', 'ship_class': '护卫舰', 'quantity': 8, 'source_version': 'SWEET 218811', 'is_custom': False})
            self.assertEqual(entry['summary']['sides'][0]['by_class'], [{'name': '护卫舰', 'quantity': 8}])
            content = copy.deepcopy(content)
            content['battle']['sides'][0]['losses'][0]['ship_id'] = 999
            self.assertEqual(self.call('post', 'posts/', {'request_id': str(uuid4()), 'content': content}).status_code, 400)
        with override_settings(STARSEA_SHIP_DB='missing'):
            self.assertEqual(self.call('get', 'ships/').status_code, 503)
            self.assertEqual(self.call('post', 'posts/', payload).status_code, 200)

    def test_processing_and_failed_upload_replays_never_decode_twice(self):
        from Community.media import sanitized_image
        from .models import UploadAttempt
        entry = self.ready()
        request_id = str(uuid4())

        def decoding(upload, raw=None):
            self.assertEqual(self.image(entry['id'], request_id=request_id).status_code, 409)
            self.assertEqual(UploadAttempt.objects.get(request_id=request_id).status, 'processing')
            return sanitized_image(upload, raw=raw)

        with patch('Starsea.views.sanitized_image', side_effect=decoding) as decoder:
            self.assertEqual(self.image(entry['id'], request_id=request_id).status_code, 201)
            self.assertEqual(decoder.call_count, 1)
        failed = str(uuid4())
        self.assertEqual(self.image(entry['id'], request_id=failed, raw=b'fake').status_code, 400)
        with patch('Starsea.views.sanitized_image', side_effect=AssertionError('must not decode')):
            self.assertEqual(self.image(entry['id'], request_id=failed, raw=b'fake').status_code, 400)
        self.assertEqual(UploadAttempt.objects.get(request_id=failed).status, 'failed')

    @override_settings(STARSEA_MEDIA_PER_POST=1)
    def test_upload_capacity_rechecked_after_decode(self):
        from Community.media import sanitized_image
        from .models import Asset, UploadAttempt
        entry = self.ready()
        request_id = str(uuid4())

        def other_completion(upload, raw=None):
            Asset.objects.create(post_id=entry['id'], uploader=self.owner, request_id=uuid4(), original_sha256='a' * 64,
                                 storage_name='other.webp', sha256='b' * 64, size=10, content_type='image/webp', width=1, height=1)
            return sanitized_image(upload, raw=raw)

        with patch('Starsea.views.sanitized_image', side_effect=other_completion):
            self.assertEqual(self.image(entry['id'], request_id=request_id).status_code, 429)
        self.assertEqual(UploadAttempt.objects.get(request_id=request_id).status, 'failed')
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_storage_failure_marks_failed_attempt_and_leaves_no_file(self):
        from .models import UploadAttempt
        entry = self.ready()
        with self.assertLogs('Starsea.views', level='ERROR'), patch('django.core.files.storage.FileSystemStorage.save', side_effect=OSError('private path')):
            response = self.image(entry['id'])
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private path', response.content.decode())
        self.assertEqual(UploadAttempt.objects.get().status, 'failed')
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_public_media_never_exposes_new_draft_images(self):
        approved = self.publish(self.ready())
        uploaded = self.image(approved['id'])
        self.assertEqual(uploaded.status_code, 201)
        asset = uploaded.json()
        draft = self.call('post', f"posts/{approved['id']}/draft/", self.expected(approved)).json()
        self.edit(draft, {'images': [{'id': asset['id'], 'caption': '私有'}]})
        self.client = APIClient()
        self.assertEqual(self.client.get(asset['url']).status_code, 404)
        self.assertEqual(self.call('get', f"posts/{approved['id']}/").json()['revision']['content']['images'], [])

    def test_jwt_role_is_read_live_and_html_like_text_is_inert_json(self):
        from rest_framework_simplejwt.tokens import AccessToken
        self.client = APIClient()
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + str(AccessToken.for_user(self.owner)))
        self.assertFalse(self.call('get', 'capabilities/').json()['can_review'])
        self.owner.is_staff = True
        self.owner.save(update_fields=['is_staff'])
        self.assertTrue(self.call('get', 'capabilities/').json()['can_review'])
        entry, _ = self.create({'title': '<b>纯文本</b>', 'body': '<script>alert(1)</script>'})
        self.assertEqual(entry['revision']['content']['body'], '<script>alert(1)</script>')
        self.assertEqual(self.call('get', f"posts/{entry['id']}/manage/")['Content-Type'], 'application/json')

    def test_unhandled_errors_are_sanitized_private_json(self):
        from django.db import OperationalError
        with self.assertLogs('Starsea.views', level='ERROR'), patch('Starsea.views.Post.objects.filter', side_effect=OperationalError('SELECT secret_email FROM private_table')):
            response = self.call('get', 'mine/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response['Content-Type'], 'application/json')
        self.assertIn('no-store', response['Cache-Control'])
        self.assertNotIn('secret_email', response.content.decode())

    def test_moderation_history_is_append_only_at_api_boundary(self):
        from .models import ModerationEvent
        approved = self.publish(self.ready())
        self.client.force_authenticate(self.staff)
        for is_listed, reason in ((False, '初次隐藏'), (True, '恢复')):
            self.assertEqual(self.call('post', f"posts/{approved['id']}/visibility/", {'is_listed': is_listed, 'reason': reason}).status_code, 200)
        events = list(ModerationEvent.objects.filter(post_id=approved['id']).order_by('pk'))
        self.assertEqual([event.action for event in events], ['approve', 'hide', 'unhide'])
        self.assertEqual([event.reason for event in events], ['', '初次隐藏', '恢复'])
        self.assertTrue(all(event.actor_id == self.staff.pk and event.created_at for event in events))

    def test_hidden_corporation_cannot_be_linked_submitted_or_approved(self):
        from Community.models import Corporation, Revision as CorporationRevision
        corporation = Corporation.objects.create(name='关联军团', name_key='linked', owner=self.owner)
        revision = CorporationRevision.objects.create(corporation=corporation, author=self.owner, status='approved')
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        entry, _ = self.create({'title': '关联', 'body': '正文', 'corporation_id': corporation.pk})
        pending = self.submit(entry)
        corporation.is_listed = False
        corporation.save(update_fields=['is_listed'])
        self.assertEqual(self.call('get', 'corporations/').json(), {'results': []})
        self.assertEqual(self.call('post', 'posts/', {'request_id': str(uuid4()), 'content': {'corporation_id': corporation.pk}}).status_code, 400)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('post', f"reviews/{pending['revision']['id']}/decision/", {'expected_version': pending['revision']['version'], 'decision': 'approve', 'reason': ''}).status_code, 400)
        self.client.force_authenticate(self.owner)
        draft = self.call('post', f"posts/{entry['id']}/withdraw/", self.expected(pending)).json()
        self.assertEqual(self.call('post', f"posts/{entry['id']}/submit/", self.expected(draft)).status_code, 400)
        cleared = self.edit(draft, {'corporation_id': None})
        self.publish(cleared)

    def test_upload_uuid_cannot_move_to_another_post_or_user(self):
        first, second = self.ready(), self.ready()
        request_id = str(uuid4())
        first_asset = self.image(first['id'], request_id=request_id)
        self.assertEqual(first_asset.status_code, 201)
        self.assertEqual(self.image(second['id'], request_id=request_id).status_code, 409)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.image(first['id']).status_code, 404)
        other = self.ready()
        other_asset = self.image(other['id'], request_id=request_id)
        self.assertEqual(other_asset.status_code, 201)
        self.assertNotEqual(first_asset.json()['id'], other_asset.json()['id'])

    def test_all_json_mutations_reject_extra_fields_and_bad_versions(self):
        entry = self.ready()
        for suffix in ('draft/', 'submit/', 'withdraw/'):
            response = self.call('post', f"posts/{entry['id']}/{suffix}", {**self.expected(entry), 'unknown': True})
            self.assertEqual(response.status_code, 400)
        for version in (True, 0, 1.0, '1'):
            response = self.call('patch', f"posts/{entry['id']}/draft/", {**self.expected(entry), 'expected_version': version, 'content': {}})
            self.assertEqual(response.status_code, 400)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('post', f"posts/{entry['id']}/visibility/", {'is_listed': 1, 'reason': '隐藏'}).status_code, 400)
        self.assertEqual(self.call('post', f"posts/{entry['id']}/visibility/", {'is_listed': False, 'reason': '隐藏'}).status_code, 409)

    def test_public_filters_apply_to_approved_snapshot_only(self):
        from .models import Revision
        approved = self.publish(self.ready())
        Revision.objects.filter(pk=approved['revision']['id']).update(region_id=100)
        self.assertEqual(self.call('get', 'posts/?kind=story&q=星海&region_id=100').json()['count'], 1)
        self.assertEqual(self.call('get', 'posts/?kind=battle').json()['count'], 0)
        self.assertEqual(self.call('get', 'posts/?region_id=200').json()['count'], 0)
        draft = self.call('post', f"posts/{approved['id']}/draft/", self.expected(approved)).json()
        self.edit(draft, {'title': '私密关键词', 'kind': 'announcement'})
        self.assertEqual(self.call('get', 'posts/?q=私密关键词').json()['count'], 0)
        self.assertEqual(self.call('get', 'posts/?kind=story&q=星海').json()['count'], 1)

    def test_public_filter_can_open_a_corporation_story_feed(self):
        from Community.models import Corporation, Revision as CorporationRevision
        corporation = Corporation.objects.create(name='关联战报军团', name_key='battle-linked', owner=self.owner)
        revision = CorporationRevision.objects.create(corporation=corporation, author=self.owner, status='approved')
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        linked = self.create({'kind': 'story', 'title': '关联战报', 'body': '关联内容', 'corporation_id': corporation.pk})[0]
        self.publish(linked)
        self.publish(self.ready())
        self.assertEqual(self.call('get', f'posts/?corporation_id={corporation.pk}').json()['count'], 1)
        self.assertEqual(self.call('get', 'posts/?corporation_id=0').status_code, 400)

    def test_public_search_includes_body_but_never_working_body(self):
        ready = self.edit(self.ready(), {'body': '正文独有关键词'})
        approved = self.publish(ready)
        self.assertEqual(self.call('get', 'posts/?q=正文独有').json()['count'], 1)
        draft = self.call('post', f"posts/{approved['id']}/draft/", self.expected(approved)).json()
        self.edit(draft, {'body': '私密正文关键词'})
        self.assertEqual(self.call('get', 'posts/?q=私密正文').json()['count'], 0)
