"""Real-API regressions for claim identity snapshots and unsafe Unicode."""
import copy
import hashlib
import json
from types import SimpleNamespace
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.renderers import JSONRenderer
from rest_framework.test import APIClient

from . import views
from .models import Claim, Corporation, Revision


class IdentityUnicodeTests(TestCase):
    def setUp(self):
        users = get_user_model().objects
        self.owner = users.create_user('identity-owner', email='owner@example.invalid')
        self.other = users.create_user('identity-other', email='other@example.invalid')
        self.staff = users.create_user('identity-staff', email='staff@example.invalid', is_staff=True)
        self.client = APIClient()
        self.client.raise_request_exception = False
        self.client.force_authenticate(self.owner)

    def call(self, method, path, data=None):
        # Escaped lone surrogates are legal JSON syntax; do not fail in the
        # test client's UTF-8 encoder before the real API sees the request.
        options = {} if data is None else {
            'data': json.dumps(data, ensure_ascii=True), 'content_type': 'application/json',
        }
        return getattr(self.client, method)('/api/community/' + path, **options)

    def claim(self, name='测试军团', short_name='GOOD'):
        response = self.call('post', 'claims/', {
            'request_id': str(uuid4()), 'name': name, 'short_name': short_name,
            'statement': '我是军团管理者', 'contact': 'private contact',
        })
        self.assertEqual(response.status_code, 201, response.content)
        return response.json()

    def decision(self, claim, decision='approve', reason='已核验'):
        self.client.force_authenticate(self.staff)
        return self.call('post', f"reviews/claims/{claim['id']}/decision/", {
            'decision': decision, 'reason': reason,
        })

    def draft(self):
        claim = self.claim()
        self.assertEqual(self.decision(claim).status_code, 200)
        self.client.force_authenticate(self.owner)
        response = self.call('post', f"corporations/{claim['corporation']['id']}/draft/", {
            'request_id': str(uuid4()),
        })
        self.assertEqual(response.status_code, 201, response.content)
        return Revision.objects.get(pk=response.json()['id'])

    def test_rejected_wrong_short_name_does_not_poison_new_successful_claim(self):
        wrong = self.claim('ＦＯＯ', 'WRONG')
        self.assertEqual(self.decision(wrong, 'reject', '简称不正确').status_code, 200)
        self.client.force_authenticate(self.other)
        correct = self.claim('foo', 'RIGHT')
        self.assertEqual(correct['corporation']['id'], wrong['corporation']['id'])
        self.assertEqual(self.decision(correct).status_code, 200)
        corporation = Corporation.objects.get(pk=correct['corporation']['id'])
        self.assertEqual((corporation.name, corporation.short_name), ('foo', 'RIGHT'))
        self.assertEqual(corporation.owner_id, self.other.pk)
        self.assertEqual(corporation.name_key, hashlib.sha256(b'cn:foo').hexdigest())

    def test_concurrent_candidate_snapshots_are_private_and_only_winner_is_applied(self):
        first = self.claim('Same Corp', 'FIRST')
        self.client.force_authenticate(self.other)
        second = self.claim('same corp', 'SECOND')
        self.assertEqual(first['corporation']['id'], second['corporation']['id'])
        self.assertEqual(first.get('proposed_name'), 'Same Corp')
        self.assertEqual(first.get('proposed_short_name'), 'FIRST')
        self.assertEqual(second.get('proposed_name'), 'same corp')
        self.assertEqual(second.get('proposed_short_name'), 'SECOND')
        self.assertEqual(self.call('get', f"claims/{first['id']}/").status_code, 404)
        self.client.force_authenticate(self.staff)
        queue = self.call('get', 'reviews/?kind=claims').json()['results']
        self.assertEqual([item['proposed_short_name'] for item in queue], ['FIRST', 'SECOND'])
        corporation = Corporation.objects.get(pk=first['corporation']['id'])
        self.assertEqual(corporation.short_name, 'FIRST')
        self.assertEqual(self.decision(second).status_code, 200)
        self.assertEqual(self.decision(first).status_code, 409)
        corporation.refresh_from_db()
        self.assertEqual((corporation.owner_id, corporation.short_name), (self.other.pk, 'SECOND'))
        self.client.force_authenticate(self.owner)
        self.assertEqual(self.call('get', f'corporations/{corporation.pk}/manage/').status_code, 404)
        # A public revision has a strict whitelist, never any claim snapshots.
        revision = Revision.objects.create(corporation=corporation, author=self.other,
                                           status='approved', content=views.default_content(), reviewed_at=timezone.now())
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        self.client = APIClient()
        self.client.raise_request_exception = False
        public = self.call('get', f'corporations/{corporation.pk}/')
        self.assertEqual(public.status_code, 200, public.content)
        self.assertNotIn('proposed_', public.content.decode())
        self.assertNotIn('private contact', public.content.decode())

    def test_existing_id_claim_snapshots_identity_and_retries_remain_idempotent(self):
        first = self.claim('稳定军团', 'KEEP')
        self.client.force_authenticate(self.other)
        payload = {'request_id': str(uuid4()), 'corporation_id': first['corporation']['id'],
                   'statement': '真正管理员', 'contact': 'contact'}
        response = self.call('post', 'claims/', payload)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(response.json().get('proposed_name'), '稳定军团')
        self.assertEqual(response.json().get('proposed_short_name'), 'KEEP')
        retry = self.call('post', 'claims/', payload)
        self.assertEqual(retry.status_code, 200, retry.content)
        self.assertEqual(retry.json(), response.json())
        self.assertEqual(self.call('post', 'claims/', {**payload, 'contact': 'changed'}).status_code, 409)

    def test_legacy_null_snapshot_keeps_identity_and_approval_contract(self):
        name = '历史已知名称'
        corporation = Corporation.objects.create(name=name, short_name='OLD',
            name_key=hashlib.sha256(('cn:' + name).encode()).hexdigest())
        claim = Claim.objects.create(corporation=corporation, applicant=self.owner,
            request_id=uuid4(), payload_hash='0' * 64, statement='legacy', contact='legacy')
        response = self.decision({'id': claim.pk})
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('proposed_name', response.json())
        self.assertIsNone(response.json()['proposed_name'])
        self.assertIsNone(response.json()['proposed_short_name'])
        corporation.refresh_from_db()
        self.assertEqual((corporation.name, corporation.short_name, corporation.owner_id),
                         (name, 'OLD', self.owner.pk))

    def test_claim_snapshot_cannot_change_another_canonical_identity(self):
        claim = self.claim()
        row = Claim.objects.get(pk=claim['id'])
        self.assertEqual(getattr(row, 'proposed_name', None), '测试军团')
        # Corrupted/imported proposal must not become a rename or ownership
        # bypass when staff approves it.
        row.proposed_name = '不同军团'
        row.save(update_fields=['proposed_name'])
        response = self.decision(claim)
        self.assertEqual(response.status_code, 409, response.content)
        row.refresh_from_db()
        self.assertEqual(row.status, 'pending')
        self.assertIsNone(row.corporation.owner_id)

    def test_client_cannot_supply_proposed_fields_or_rename_through_revision(self):
        response = self.call('post', 'claims/', {
            'request_id': str(uuid4()), 'name': '测试军团', 'short_name': 'GOOD',
            'statement': 'manager', 'contact': 'contact', 'proposed_short_name': 'FORGED',
        })
        self.assertEqual(response.status_code, 400, response.content)
        revision = self.draft()
        response = self.call('patch', f'revisions/{revision.pk}/', {
            'expected_version': revision.version, 'short_name': 'FORGED',
        })
        self.assertEqual(response.status_code, 400, response.content)

    def test_claim_unicode_is_rejected_before_any_rows_are_created(self):
        for field in ('name', 'short_name', 'statement', 'contact'):
            for invalid in ('bad\ud800', 'bad\udfff'):
                with self.subTest(field=field, invalid=repr(invalid)):
                    before = (Corporation.objects.count(), Claim.objects.count())
                    payload = dict(request_id=str(uuid4()), name='Unicode军团', short_name='GOOD',
                                   statement='manager', contact='contact')
                    payload[field] = invalid
                    response = self.call('post', 'claims/', payload)
                    self.assertEqual(response.status_code, 400, response.content)
                    self.assertIn(field, response.json())
                    self.assertEqual((Corporation.objects.count(), Claim.objects.count()), before)

    def test_all_revision_text_fields_reject_surrogates_without_mutation(self):
        revision = self.draft()
        original = copy.deepcopy(revision.content)
        original_version = revision.version
        for field in (*views.TEXT_FIELDS, 'benefits_note'):
            with self.subTest(field=field):
                # Each sub-case starts with the same clean row, even on RED.
                Revision.objects.filter(pk=revision.pk).update(content=original, version=original_version)
                response = self.call('patch', f'revisions/{revision.pk}/', {
                    'expected_version': original_version, field: 'bad\ud800',
                })
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn(field, response.json())
                revision.refresh_from_db()
                self.assertEqual((revision.version, revision.content), (original_version, original))

    def test_invalid_reasons_do_not_change_claim_revision_or_visibility(self):
        claim = self.claim()
        response = self.decision(claim, 'reject', 'bad\ud800')
        self.assertEqual(response.status_code, 400, response.content)
        self.assertEqual(Claim.objects.get(pk=claim['id']).status, 'pending')
        self.assertEqual(self.decision(claim).status_code, 200)
        corporation = Corporation.objects.get(pk=claim['corporation']['id'])
        revision = Revision.objects.create(corporation=corporation, author=self.owner,
            status='pending', content=views.default_content())
        corporation.working_revision = revision
        corporation.save(update_fields=['working_revision'])
        response = self.call('post', f'reviews/revisions/{revision.pk}/decision/', {
            'decision': 'approve', 'reason': 'bad\udfff',
        })
        self.assertEqual(response.status_code, 400, response.content)
        revision.refresh_from_db()
        self.assertEqual((revision.version, revision.status), (1, 'pending'))
        response = self.call('post', f'corporations/{corporation.pk}/visibility/', {
            'is_listed': False, 'reason': 'bad\udfff',
        })
        self.assertEqual(response.status_code, 400, response.content)
        corporation.refresh_from_db()
        self.assertTrue(corporation.is_listed)
        self.assertIsNone(corporation.published_revision_id)

    def test_invalid_required_legacy_text_cannot_be_submitted(self):
        revision = self.draft()
        revision.content.update(introduction='bad\ud800', public_contact='contact')
        revision.save(update_fields=['content'])
        response = self.call('post', f'revisions/{revision.pk}/submit/', {'expected_version': 1})
        self.assertEqual(response.status_code, 400, response.content)
        revision.refresh_from_db()
        self.assertEqual((revision.version, revision.status), (1, 'draft'))

    def test_historical_bad_text_does_not_break_private_review_or_public_reads(self):
        revision = self.draft()
        original = {**views.default_content(), **{key: 'bad\ud800' for key in views.TEXT_FIELDS},
                    'benefits_note': 'bad\udfff', 'recruitment_status': 'bad\ud800',
                    'base_location': {'region_id': 'r1', 'region_name': 'bad\ud800',
                                      'constellation_id': None, 'constellation_name': None,
                                      'solarsystem_id': None, 'solarsystem_name': None,
                                      'security': 0.5}}
        revision.content = copy.deepcopy(original)
        revision.status = 'pending'
        revision.save(update_fields=['content', 'status'])
        corporation = revision.corporation
        for path in ('mine/', f'corporations/{corporation.pk}/manage/'):
            with self.subTest(path=path):
                response = self.call('get', path)
                self.assertEqual(response.status_code, 200, response.content)
        self.client.force_authenticate(self.staff)
        for path in ('reviews/?kind=revisions', f'reviews/revisions/{revision.pk}/'):
            with self.subTest(path=path):
                response = self.call('get', path)
                self.assertEqual(response.status_code, 200, response.content)
                response.content.decode('utf-8')
        revision.status = 'approved'
        revision.reviewed_at = timezone.now()
        revision.save(update_fields=['status', 'reviewed_at'])
        corporation.published_revision = revision
        corporation.save(update_fields=['published_revision'])
        self.client = APIClient()
        self.client.raise_request_exception = False
        for path in ('corporations/', f'corporations/{corporation.pk}/'):
            with self.subTest(path=path):
                response = self.call('get', path)
                self.assertEqual(response.status_code, 200, response.content)
                response.content.decode('utf-8')
        revision.refresh_from_db()
        self.assertEqual(revision.content, original)

    def test_historical_claim_and_identity_text_are_safe_without_mutating_objects(self):
        # SQLite itself forbids lone surrogates in varchar, whereas historical
        # JSON fixtures/import adapters may supply them. Test serializer safety
        # directly for these scalar objects and real DB endpoints for JSON above.
        corporation = SimpleNamespace(pk=1, name='bad\ud800', short_name='bad\udfff')
        claim = SimpleNamespace(corporation=corporation, id=1, statement='bad\ud800',
            contact='bad\udfff', status='pending', created_at=None, reviewed_at=None,
            review_reason='bad\ud800', proposed_name='bad\ud800', proposed_short_name='bad\udfff')
        result = views.claim_data(claim)
        self.assertEqual(result['corporation']['name'], '')
        self.assertEqual(result['statement'], '')
        self.assertEqual(result.get('proposed_name'), '')
        JSONRenderer().render(result).decode('utf-8')
        self.assertEqual(corporation.name, 'bad\ud800')
        self.assertEqual(claim.statement, 'bad\ud800')

    def test_historical_nontext_values_cannot_leak_invalid_json_keys_through_text_fields(self):
        for value in ({'bad\ud800': 'value'}, ['bad\ud800'], None, 5):
            with self.subTest(value=repr(value)):
                stored = {key: copy.deepcopy(value) for key in views.TEXT_FIELDS}
                revision = SimpleNamespace(pk=1, content=copy.deepcopy(stored))
                result = views.revision_data(revision, public=True)
                self.assertTrue(all(result[key] == '' for key in views.TEXT_FIELDS))
                JSONRenderer().render(result).decode('utf-8')
                self.assertEqual(revision.content, stored)

    def test_valid_non_bmp_unicode_roundtrips_claim_and_revision(self):
        claim = self.claim('远航🚀𠀀', '🛰️')
        self.assertEqual(self.decision(claim, reason='确认🚀').status_code, 200)
        self.client.force_authenticate(self.owner)
        response = self.call('post', f"corporations/{claim['corporation']['id']}/draft/", {'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 201, response.content)
        draft = response.json()
        payload = {'expected_version': draft['version'], **{key: '远航🚀𠀀' for key in views.TEXT_FIELDS},
                   'benefits_note': '支援🛰️'}
        response = self.call('patch', f"revisions/{draft['id']}/", payload)
        self.assertEqual(response.status_code, 200, response.content)
        for key in views.TEXT_FIELDS:
            self.assertEqual(response.json()[key], '远航🚀𠀀')
        self.assertEqual(response.json()['benefits_note'], '支援🛰️')
