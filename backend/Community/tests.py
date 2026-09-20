import io
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from django.db import OperationalError
from django.test import TestCase, override_settings
from PIL import Image, PngImagePlugin
from rest_framework.test import APIClient

from . import views


class CorporationTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user('owner', email='owner@example.invalid')
        self.other = get_user_model().objects.create_user('other', email='other@example.invalid')
        self.staff = get_user_model().objects.create_user('reviewer', email='reviewer@example.invalid', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.owner)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.setting = override_settings(COMMUNITY_UPLOAD_ROOT=self.tmp.name)
        self.setting.enable()
        self.addCleanup(self.setting.disable)

    def call(self, method, path, data=None):
        return getattr(self.client, method)('/api/community/' + path, data, format='json')

    def test_lock_users_uses_one_stable_sorted_row_order(self):
        manager = get_user_model().objects
        with patch.object(manager, 'select_for_update') as select_for_update:
            views.lock_users([9, 2, 9, 4])
        select_for_update.return_value.filter.assert_called_once_with(pk__in=[2, 4, 9])
        select_for_update.return_value.filter.return_value.order_by.assert_called_once_with('pk')

    def claim(self, name='测试军团', **extra):
        data = dict(request_id=str(uuid4()), name=name, short_name='TEST', statement='本人军团管理者', contact='private-contact')
        data.update(extra)
        response = self.call('post', 'claims/', data)
        self.assertEqual(response.status_code, 201, response.content)
        return response.json(), data

    def owned(self, name='测试军团'):
        claim, _ = self.claim(name)
        self.client.force_authenticate(self.staff)
        response = self.call('post', f"reviews/claims/{claim['id']}/decision/", {'decision': 'approve', 'reason': '已核验'})
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(self.owner)
        return claim['corporation']['id']

    def draft(self, corporation=None):
        corporation = corporation or self.owned()
        response = self.call('post', f'corporations/{corporation}/draft/', {'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def ready(self, draft=None):
        draft = draft or self.draft()
        response = self.call('patch', f"revisions/{draft['id']}/", {'expected_version': draft['version'], 'introduction': '军团介绍', 'public_contact': '公开联系', 'activities': ['pvp']})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def submit(self, draft):
        response = self.call('post', f"revisions/{draft['id']}/submit/", {'expected_version': draft['version']})
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def publish(self, revision):
        self.client.force_authenticate(self.staff)
        response = self.call('post', f"reviews/revisions/{revision['id']}/decision/", {'decision': 'approve', 'reason': ''})
        self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(self.owner)

    def upload(self, corporation, data=None, name='a.png', request_id=None):
        if data is None:
            output = io.BytesIO()
            info = PngImagePlugin.PngInfo()
            info.add_text('secret', 'EXIF PRIVATE LOCATION')
            Image.new('RGB', (40, 30), 'red').save(output, 'PNG', pnginfo=info)
            data = output.getvalue()
        return self.client.post(f'/api/community/corporations/{corporation}/media/', {'request_id': request_id or str(uuid4()), 'file': SimpleUploadedFile(name, data)}, format='multipart')

    def test_claim_idempotency_normalization_and_private_visibility(self):
        claim, payload = self.claim(name='ＦＯＯ')
        self.assertEqual(self.call('post', 'claims/', payload).status_code, 200)
        self.assertEqual(self.call('post', 'claims/', {**payload, 'contact': 'changed'}).status_code, 409)
        self.assertEqual(self.call('post', 'claims/', {**payload, 'request_id': str(uuid4())}).status_code, 409)
        self.assertEqual(self.call('get', 'corporations/').json(), {'count': 0, 'results': []})
        self.client.force_authenticate(self.other)
        contender, _ = self.claim(name='foo')
        self.assertEqual(contender['corporation']['id'], claim['corporation']['id'])
        self.assertEqual(self.call('get', f"claims/{claim['id']}/").status_code, 404)

    def test_capabilities_live_staff_and_private_cache_on_errors(self):
        response = self.call('get', 'capabilities/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {'can_review': False})
        self.assertEqual(self.call('get', 'reviews/').status_code, 403)
        self.client = APIClient()
        response = self.call('get', 'mine/')
        self.assertEqual(response.status_code, 401)
        self.assertIn('no-store', response['Cache-Control'])
        self.assertIn('Authorization', response['Vary'])

    def test_claim_review_assigns_owner_not_public_and_cannot_take_over(self):
        corporation = self.owned()
        self.assertEqual(self.call('get', f'corporations/{corporation}/').status_code, 404)
        self.client.force_authenticate(self.other)
        response = self.call('post', 'claims/', dict(request_id=str(uuid4()), corporation_id=corporation, statement='mine', contact='me'))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.call('get', f'corporations/{corporation}/manage/').status_code, 404)

    def test_version_and_pending_immutability(self):
        draft = self.ready()
        self.assertEqual(self.call('patch', f"revisions/{draft['id']}/", {'expected_version': 1, 'tagline': 'stale'}).status_code, 409)
        pending = self.submit(draft)
        self.assertEqual(self.call('patch', f"revisions/{draft['id']}/", {'expected_version': pending['version'], 'tagline': 'mutate'}).status_code, 409)
        self.assertEqual(self.call('post', f"corporations/{draft['corporation_id']}/draft/", {'request_id': str(uuid4())}).status_code, 409)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.call('patch', f"revisions/{draft['id']}/", {'expected_version': pending['version']}).status_code, 404)

    def test_old_public_survives_edits_reject_and_duplicate_approval(self):
        revision = self.submit(self.ready())
        self.publish(revision)
        corporation = revision['corporation_id']
        public = self.call('get', f'corporations/{corporation}/').json()
        self.assertEqual(set(public), {'id', 'name', 'short_name', 'published_at', 'revision', 'logo_url', 'cover_url'})
        self.assertNotIn('review_reason', public['revision'])
        self.assertNotIn('private-contact', str(public))
        draft = self.draft(corporation)
        pending = self.submit(self.ready(draft))
        self.assertEqual(self.call('get', f'corporations/{corporation}/').json(), public)
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('post', f"reviews/revisions/{pending['id']}/decision/", {'decision': 'reject', 'reason': '补充介绍'}).status_code, 200)
        self.assertEqual(self.call('post', f"reviews/revisions/{revision['id']}/decision/", {'decision': 'approve', 'reason': ''}).status_code, 409)
        self.assertEqual(self.call('get', f'corporations/{corporation}/').json(), public)

    def test_whitelist_required_content_and_invalid_enums(self):
        self.assertEqual(self.call('post', 'claims/', {'request_id': str(uuid4()), 'owner_id': self.owner.pk}).status_code, 400)
        draft = self.draft()
        path = f"revisions/{draft['id']}/"
        for data in ({'owner_id': 2}, {'activities': ['bad']}, {'activities': ['pvp', 'pvp']}, {'recruitment_status': 'invalid'}, {'tagline': 'a' * 81}, {'logo_asset_id': True}):
            self.assertEqual(self.call('patch', path, {'expected_version': draft['version'], **data}).status_code, 400)
        self.assertEqual(self.call('post', path + 'submit/', {'expected_version': draft['version']}).status_code, 400)

    def test_poster_metadata_defaults_allow_lists_and_public_serialization(self):
        draft = self.draft()
        for key, expected in {
            'corp_types': [], 'region_tags': [], 'benefit_keys': [],
            'benefits_note': '', 'poster_background': 'deep-space',
        }.items():
            self.assertEqual(draft[key], expected)
        path = f"revisions/{draft['id']}/"
        updated = self.call('patch', path, {
            'expected_version': draft['version'],
            'introduction': '军团介绍',
            'public_contact': '公开联系',
            'benefits': '老版本福利说明',
            'corp_types': ['pirate', 'sovereignty'],
            'region_tags': ['highsec', 'lowsec', 'nullsec'],
            'benefit_keys': ['ship_reimbursement', 'fleet_training', 'industry_support'],
            'benefits_note': '每周有新人舰队和补给。',
            'poster_background': 'pirate-tide',
        }).json()
        self.assertEqual(updated['corp_types'], ['pirate', 'sovereignty'])
        self.assertEqual(updated['region_tags'], ['highsec', 'lowsec', 'nullsec'])
        self.assertEqual(updated['benefit_keys'], ['ship_reimbursement', 'fleet_training', 'industry_support'])
        self.assertEqual(updated['poster_background'], 'pirate-tide')
        revision = self.submit(updated)
        self.publish(revision)
        public = self.call('get', f"corporations/{revision['corporation_id']}/").json()['revision']
        self.assertEqual(public['corp_types'], ['pirate', 'sovereignty'])
        self.assertEqual(public['region_tags'], ['highsec', 'lowsec', 'nullsec'])
        self.assertEqual(public['benefit_keys'], ['ship_reimbursement', 'fleet_training', 'industry_support'])
        self.assertEqual(public['benefits_note'], '每周有新人舰队和补给。')
        self.assertEqual(public['poster_background'], 'pirate-tide')
        self.assertEqual(public['benefits'], '老版本福利说明')

    def test_poster_metadata_rejects_unknown_duplicate_overflow_and_long_values(self):
        draft = self.draft()
        path = f"revisions/{draft['id']}/"
        invalid = (
            {'corp_types': ['pirate', 'pirate']},
            {'corp_types': ['pirate', 'sovereignty', 'pirate']},
            {'corp_types': ['pirate', 'unknown']},
            {'region_tags': ['highsec', 'highsec']},
            {'region_tags': ['highsec', 'lowsec', 'nullsec', 'highsec']},
            {'region_tags': ['unsafe']},
            {'benefit_keys': ['pve_fleet', 'pve_fleet']},
            {'benefit_keys': list(views.BENEFIT_KEYS) + ['ship_reimbursement']},
            {'benefit_keys': ['unknown']},
            {'benefits_note': 'x' * (views.BENEFITS_NOTE_LIMIT + 1)},
            {'poster_background': 'unknown-background'},
        )
        for data in invalid:
            response = self.call('patch', path, {'expected_version': draft['version'], **data})
            self.assertEqual(response.status_code, 400, (data, response.content))

    def test_pre_feature_revision_falls_back_without_new_metadata(self):
        legacy = SimpleNamespace(pk=1, content={'benefits': '历史福利文本'})
        payload = views.revision_data(legacy, public=True)
        self.assertEqual(payload['benefits'], '历史福利文本')
        self.assertEqual(payload['corp_types'], [])
        self.assertEqual(payload['region_tags'], [])
        self.assertEqual(payload['benefit_keys'], [])
        self.assertEqual(payload['benefits_note'], '')
        self.assertEqual(payload['poster_background'], 'deep-space')

    def test_media_private_metadata_removed_public_only_after_review_and_hide(self):
        draft = self.ready()
        corporation = draft['corporation_id']
        uploaded = self.upload(corporation)
        self.assertEqual(uploaded.status_code, 201, uploaded.content)
        asset = uploaded.json()
        response = self.client.get(asset['private_url'])
        raw = b''.join(response.streaming_content)
        response.close()
        self.assertNotIn(b'EXIF PRIVATE LOCATION', raw)
        self.assertIn('no-store', response['Cache-Control'])
        public_url = f'/api/community/corporations/{corporation}/media/{asset["id"]}/'
        self.assertEqual(self.client.get(public_url).status_code, 404)
        self.client.force_authenticate(self.other)
        self.assertEqual(self.client.get(asset['private_url']).status_code, 404)
        self.client.force_authenticate(self.owner)
        draft = self.call('patch', f"revisions/{draft['id']}/", {'expected_version': draft['version'], 'logo_asset_id': asset['id']}).json()
        self.publish(self.submit(draft))
        response = self.client.get(public_url)
        self.assertEqual(response.status_code, 200)
        response.close()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('post', f'corporations/{corporation}/visibility/', {'is_listed': False, 'reason': '违规'}).status_code, 200)
        self.assertEqual(self.client.get(public_url).status_code, 404)

    def test_upload_rejects_fakes_animations_oversize_and_fails_closed(self):
        corporation = self.owned()
        for name, data in [('x.svg', b'<svg/>'), ('x.png', b'fake'), ('x.jpg', b'a' * (5 * 1024 * 1024 + 1))]:
            self.assertEqual(self.upload(corporation, data, name).status_code, 400)
        output = io.BytesIO()
        Image.new('RGB', (2, 2), 'red').save(output, 'PNG', save_all=True, append_images=[Image.new('RGB', (2, 2), 'blue')])
        self.assertEqual(self.upload(corporation, output.getvalue()).status_code, 400)
        with override_settings(COMMUNITY_UPLOAD_ROOT=None):
            self.assertEqual(self.upload(corporation).status_code, 503)

    def test_media_idempotency_foreign_binding_and_db_failure_compensation(self):
        corporation = self.owned()
        request_id = str(uuid4())
        first = self.upload(corporation, request_id=request_id)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.upload(corporation, request_id=request_id).json()['id'], first.json()['id'])
        other_corporation = self.owned('另一军团')
        draft = self.draft(other_corporation)
        response = self.call('patch', f"revisions/{draft['id']}/", {'expected_version': draft['version'], 'logo_asset_id': first.json()['id']})
        self.assertEqual(response.status_code, 400)
        before = list(Path(self.tmp.name).rglob('*'))
        with self.assertLogs('Community.views', level='ERROR'), patch('Community.views.MediaAsset.objects.create', side_effect=RuntimeError('DB unavailable')):
            self.assertEqual(self.upload(corporation).status_code, 503)
        self.assertEqual(list(Path(self.tmp.name).rglob('*')), before)

    def test_staff_review_queue_claim_contenders_and_owner_only_edit(self):
        first, _ = self.claim()
        self.client.force_authenticate(self.other)
        second, _ = self.claim()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('get', 'reviews/?kind=claims').json()['count'], 2)
        self.assertEqual(self.call('post', f"reviews/claims/{first['id']}/decision/", {'decision': 'approve', 'reason': ''}).status_code, 200)
        self.assertEqual(self.call('post', f"reviews/claims/{second['id']}/decision/", {'decision': 'approve', 'reason': ''}).status_code, 409)
        corporation = first['corporation']['id']
        self.assertEqual(self.call('post', f'corporations/{corporation}/draft/', {'request_id': str(uuid4())}).status_code, 404)

    def test_withdraw_and_draft_request_id_replay(self):
        draft = self.ready()
        pending = self.submit(draft)
        response = self.call('post', f"revisions/{draft['id']}/withdraw/", {'expected_version': pending['version']})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['status'], 'withdrawn')
        path = f"corporations/{draft['corporation_id']}/draft/"
        request_id = str(uuid4())
        first = self.call('post', path, {'request_id': request_id})
        self.assertEqual(first.status_code, 201)
        self.assertEqual(self.call('post', path, {'request_id': request_id}).json()['id'], first.json()['id'])

    @override_settings(COMMUNITY_CLAIMS_PER_DAY=1, COMMUNITY_MEDIA_PER_DAY=1)
    def test_persistent_quotas_and_pagination_validation(self):
        corporation = self.owned()
        self.assertEqual(self.call('post', 'claims/', dict(request_id=str(uuid4()), name='Next', short_name='', statement='owner', contact='x')).status_code, 429)
        self.assertEqual(self.upload(corporation).status_code, 201)
        self.assertEqual(self.upload(corporation).status_code, 429)
        self.assertEqual(self.call('get', 'corporations/?page=0').status_code, 400)
        self.assertEqual(self.call('get', 'corporations/?activity=invalid').status_code, 400)

    def test_staff_review_detail_excludes_unsubmitted_drafts(self):
        draft = self.ready()
        self.client.force_authenticate(self.staff)
        self.assertEqual(self.call('get', f"reviews/revisions/{draft['id']}/").status_code, 404)

    def test_private_errors_success_and_live_capabilities_have_no_store(self):
        for path in ('capabilities/', 'mine/', 'claims/9999/', 'reviews/', 'corporations/9999/manage/'):
            response = self.call('get', path)
            self.assertIn('no-store', response['Cache-Control'])
            self.assertIn('Authorization', response['Vary'])
        self.owner.is_staff = True
        self.owner.save(update_fields=['is_staff'])
        self.client.force_authenticate(get_user_model().objects.get(pk=self.owner.pk))
        self.assertTrue(self.call('get', 'capabilities/').json()['can_review'])

    def test_public_search_activity_and_mine_are_bounded_and_no_private_leaks(self):
        pending = self.submit(self.ready())
        self.client.force_authenticate(self.staff)
        review = self.call('get', f"reviews/revisions/{pending['id']}/").json()
        self.assertEqual(review['corporation']['name'], '测试军团')
        self.assertEqual(self.call('get', 'reviews/?kind=revisions').json()['count'], 1)
        self.client.force_authenticate(self.owner)
        self.publish(pending)
        self.client = APIClient()
        data = self.call('get', 'corporations/?q=测试&activity=pvp').json()
        self.assertEqual(data['count'], 1)
        self.assertEqual(self.call('get', 'corporations/?activity=pve').json()['count'], 0)
        self.assertEqual(self.call('get', 'corporations/?page=2').json()['results'], [])
        self.assertNotIn('private-contact', str(data))
        self.client.force_authenticate(self.other)
        mine = self.call('get', 'mine/').json()
        self.assertEqual(mine, {'claims': [], 'corporations': [], 'claims_count': 0, 'corporations_count': 0})

    def test_public_region_filter_matches_partial_base_region_and_activity(self):
        draft = self.ready()
        updated = self.call('patch', f"revisions/{draft['id']}/", {
            'expected_version': draft['version'],
            'base_region': '德尔克',
            'activities': ['pvp'],
        }).json()
        revision = self.submit(updated)
        self.publish(revision)

        self.assertEqual(self.call('get', 'corporations/?region=德尔').json()['count'], 1)
        self.assertEqual(self.call('get', 'corporations/?region=德尔&activity=pvp').json()['count'], 1)
        self.assertEqual(self.call('get', 'corporations/?region=德尔&activity=pve').json()['count'], 0)

    def test_public_region_filter_empty_no_match_and_length_validation(self):
        first = self.ready()
        first = self.call('patch', f"revisions/{first['id']}/", {
            'expected_version': first['version'],
            'base_region': '德尔克',
        }).json()
        first = self.submit(first)
        self.publish(first)

        second = self.ready(self.draft(self.owned('另一个军团')))
        second = self.call('patch', f"revisions/{second['id']}/", {
            'expected_version': second['version'],
            'base_region': '特纳特',
        }).json()
        second = self.submit(second)
        self.publish(second)

        self.assertEqual(self.call('get', 'corporations/?region=').json()['count'], 2)
        self.assertEqual(self.call('get', 'corporations/?region=不存在').json()['count'], 0)
        self.assertEqual(self.call('get', 'corporations/?region=' + ('星' * 81)).status_code, 400)

    def test_claim_reject_requires_reason_and_reviewer_is_persisted(self):
        claim, _ = self.claim()
        self.client.force_authenticate(self.staff)
        path = f"reviews/claims/{claim['id']}/decision/"
        self.assertEqual(self.call('post', path, {'decision': 'reject', 'reason': ''}).status_code, 400)
        self.assertEqual(self.call('post', path, {'decision': 'reject', 'reason': '需核验身份'}).status_code, 200)
        from .models import Claim
        saved = Claim.objects.get(pk=claim['id'])
        self.assertEqual(saved.reviewer_id, self.staff.pk)
        self.assertIsNotNone(saved.reviewed_at)
        self.assertEqual(saved.status, 'rejected')

    def test_upload_exif_orientation_and_size_are_sanitized(self):
        corporation = self.owned()
        output = io.BytesIO()
        photo = Image.new('RGB', (50, 30))
        exif = Image.Exif()
        exif[274] = 6
        exif[270] = 'private location'
        photo.save(output, 'JPEG', exif=exif)
        response = self.upload(corporation, output.getvalue(), 'photo.jpg')
        self.assertEqual(response.status_code, 201)
        self.assertEqual((response.json()['width'], response.json()['height']), (30, 50))
        streamed = self.client.get(response.json()['private_url'])
        raw = b''.join(streamed.streaming_content)
        streamed.close()
        with Image.open(io.BytesIO(raw)) as result:
            self.assertEqual(dict(result.getexif()), {})
            self.assertEqual(result.format, 'WEBP')
        output = io.BytesIO()
        Image.new('RGB', (5000, 4001)).save(output, 'PNG')
        self.assertEqual(self.upload(corporation, output.getvalue()).status_code, 400)

    def test_storage_cannot_point_to_public_static_or_relative_folder(self):
        corporation = self.owned()
        for root in ('relative-private', str(Path(self.tmp.name) / 'static' / 'images')):
            with override_settings(COMMUNITY_UPLOAD_ROOT=root):
                self.assertEqual(self.upload(corporation).status_code, 503)

    def test_draft_uuid_cannot_replay_into_another_corporation(self):
        corporation = self.owned()
        other = self.owned('另一家')
        request_id = str(uuid4())
        self.assertEqual(self.call('post', f'corporations/{corporation}/draft/', {'request_id': request_id}).status_code, 201)
        self.assertEqual(self.call('post', f'corporations/{other}/draft/', {'request_id': request_id}).status_code, 409)

    def test_file_storage_failure_is_a_service_error(self):
        corporation = self.owned()
        with self.assertLogs('Community.views', level='ERROR'), patch('django.core.files.storage.FileSystemStorage.save', side_effect=OSError('disk full')):
            self.assertEqual(self.upload(corporation).status_code, 503)
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])

    def test_unhandled_private_failures_are_sanitized_and_never_cached(self):
        self.client.raise_request_exception = False
        for error in (OperationalError('SELECT private_contact FROM secret_table'), RuntimeError('private-contact')):
            with self.subTest(error=type(error).__name__):
                with self.assertLogs('Community.views', level='ERROR') as captured, patch('Community.views.Claim.objects.filter', side_effect=error):
                    response = self.call('get', 'mine/')
                self.assertIn(response.status_code, (500, 503))
                self.assertIn('no-store', response.get('Cache-Control', ''))
                self.assertIn('Authorization', response.get('Vary', ''))
                self.assertEqual(response['Content-Type'], 'application/json')
                self.assertNotIn('private-contact', response.content.decode())
                self.assertNotIn('SELECT', response.content.decode())
                self.assertIn(type(error).__name__, captured.output[0])
                self.assertNotIn(str(error), captured.output[0])

    def test_all_path_identifiers_are_validated_before_database_queries(self):
        self.client.raise_request_exception = False
        self.client.force_authenticate(self.staff)
        paths = (
            ('get', 'corporations/{bad}/'), ('get', 'corporations/{bad}/manage/'),
            ('post', 'corporations/{bad}/draft/'), ('post', 'corporations/{bad}/media/'),
            ('get', 'corporations/1/media/{bad}/'), ('get', 'corporations/{bad}/media/1/'),
            ('post', 'corporations/{bad}/visibility/'), ('get', 'claims/{bad}/'),
            ('patch', 'revisions/{bad}/'), ('post', 'revisions/{bad}/submit/'),
            ('post', 'revisions/{bad}/withdraw/'), ('get', 'media/{bad}/private/'),
            ('get', 'reviews/claims/{bad}/'), ('get', 'reviews/revisions/{bad}/'),
            ('post', 'reviews/claims/{bad}/decision/'), ('post', 'reviews/revisions/{bad}/decision/'),
        )
        for bad in (0, 9223372036854775808):
            for method, path in paths:
                with self.subTest(path=path, bad=bad):
                    response = self.call(method, path.format(bad=bad), {} if method != 'get' else None)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn('no-store', response['Cache-Control'])
                    self.assertIn('Authorization', response['Vary'])

    def test_claim_uuid_uses_canonical_name_not_display_case(self):
        first, payload = self.claim(name='ＦＯＯ')
        retry = self.call('post', 'claims/', {**payload, 'name': 'foo'})
        self.assertEqual(retry.status_code, 200)
        self.assertEqual(retry.json()['id'], first['id'])
        self.assertEqual(retry.json()['corporation']['name'], 'FOO')
        self.assertEqual(self.call('post', 'claims/', {**payload, 'name': 'different'}).status_code, 409)

    @override_settings(COMMUNITY_MEDIA_PER_DAY=0)
    def test_exhausted_upload_quota_does_not_decode_image(self):
        from .media import sanitized_image
        corporation = self.owned()
        with patch('Community.views.sanitized_image', wraps=sanitized_image) as decode:
            self.assertEqual(self.upload(corporation).status_code, 429)
            self.assertEqual(decode.call_count, 0)

    @override_settings(COMMUNITY_MEDIA_ATTEMPTS_PER_DAY=2)
    def test_failed_images_consume_persistent_attempt_quota(self):
        corporation = self.owned()
        self.assertEqual(self.upload(corporation, b'fake1').status_code, 400)
        self.assertEqual(self.upload(corporation, b'fake2').status_code, 400)
        from .media import sanitized_image
        with patch('Community.views.sanitized_image', wraps=sanitized_image) as decode:
            self.assertEqual(self.upload(corporation, b'fake3').status_code, 429)
            self.assertEqual(decode.call_count, 0)

    def test_completed_and_failed_upload_retries_do_not_decode_again(self):
        from .media import sanitized_image
        corporation = self.owned()
        successful_id, failed_id = str(uuid4()), str(uuid4())
        self.assertEqual(self.upload(corporation, request_id=successful_id).status_code, 201)
        self.assertEqual(self.upload(corporation, b'bad', request_id=failed_id).status_code, 400)
        with patch('Community.views.sanitized_image', wraps=sanitized_image) as decode:
            self.assertEqual(self.upload(corporation, request_id=successful_id).status_code, 200)
            self.assertEqual(self.upload(corporation, b'bad', request_id=failed_id).status_code, 400)
            self.assertEqual(decode.call_count, 0)

    def test_processing_upload_uuid_rejects_reentrant_duplicate_before_decode(self):
        from .media import sanitized_image
        from .models import MediaUploadAttempt
        corporation = self.owned()
        request_id = str(uuid4())
        def decoding(upload, raw=None):
            retry = self.upload(corporation, request_id=request_id)
            self.assertEqual(retry.status_code, 409)
            self.assertEqual(MediaUploadAttempt.objects.get(request_id=request_id).status, 'processing')
            return sanitized_image(upload, raw=raw)
        with patch('Community.views.sanitized_image', side_effect=decoding) as decode:
            self.assertEqual(self.upload(corporation, request_id=request_id).status_code, 201)
            self.assertEqual(decode.call_count, 1)
        self.assertEqual(MediaUploadAttempt.objects.get(request_id=request_id).status, 'completed')

    @override_settings(COMMUNITY_MEDIA_PER_CORPORATION=1)
    def test_upload_capacity_rechecked_after_decoding_and_failed_attempt_retained(self):
        from .media import sanitized_image
        from .models import MediaAsset, MediaUploadAttempt
        corporation = self.owned()
        request_id = str(uuid4())
        def other_worker_completes(upload, raw=None):
            MediaAsset.objects.create(corporation_id=corporation, uploader=self.owner, request_id=uuid4(), original_sha256='a' * 64, storage_name='other-worker.webp', sha256='b' * 64, size=100, content_type='image/webp', width=1, height=1)
            return sanitized_image(upload, raw=raw)
        with patch('Community.views.sanitized_image', side_effect=other_worker_completes):
            self.assertEqual(self.upload(corporation, request_id=request_id).status_code, 429)
        self.assertEqual(MediaUploadAttempt.objects.get(request_id=request_id).status, 'failed')
        self.assertEqual(list(Path(self.tmp.name).iterdir()), [])
