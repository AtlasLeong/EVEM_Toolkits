import json
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient


class OrganizationTests(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username='owner', password='test')
        self.scout = get_user_model().objects.create_user(username='scout', password='test')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def post(self, path, data):
        return self.client.post('/api/tactical/' + path, json.dumps(data), content_type='application/json')

    def create(self):
        response = self.post('organizations/', {'name': '北境', 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 200, response.content)
        return response.data['result']['id']

    def command(self, org, action, **kwargs):
        return self.post(f'organizations/{org}/commands/', {'request_id': str(uuid4()), 'action': action, **kwargs})

    def join(self, org, actor=None):
        invite = self.command(org, 'invite.create').data['result']['invite_code']
        self.client.force_authenticate(actor or self.scout)
        response = self.post('join/', {'request_id': str(uuid4()), 'invite_code': invite})
        self.assertEqual(response.status_code, 200, response.data)
        return response.data['result']['id']

    def test_create_idempotent_and_reject_mismatched_retry(self):
        body = {'name': '北境', 'request_id': str(uuid4())}
        first = self.post('organizations/', body)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.post('organizations/', body).data, first.data)
        body['name'] = 'different'
        self.assertEqual(self.post('organizations/', body).status_code, 409)

    def test_reject_invalid_shape_uuid_and_surrogate(self):
        for body in [{'name': 'x'}, {'name': 'x', 'request_id': 'bad'},
                     {'name': '\ud800', 'request_id': str(uuid4())},
                     {'name': 'x', 'request_id': str(uuid4()), 'role': 'founder'}]:
            with self.subTest(body=body):
                self.assertEqual(self.post('organizations/', body).status_code, 400)

    def test_membership_requires_approval_and_defaults_scout(self):
        org = self.create()
        application = self.join(org)
        self.assertEqual(self.client.get(f'/api/tactical/organizations/{org}/members/').status_code, 403)
        self.client.force_authenticate(self.owner)
        approved = self.command(org, 'join.review', application_id=application, decision='approve')
        self.assertEqual(approved.status_code, 200, approved.data)
        members = self.client.get(f'/api/tactical/organizations/{org}/members/').data['members']
        member = next(m for m in members if m['user_id'] == self.scout.id)
        self.assertEqual(member['role'], 'scout')
        self.client.force_authenticate(self.scout)
        self.assertEqual(self.command(org, 'invite.create').status_code, 403)

    def test_staff_does_not_bypass_membership(self):
        org = self.create()
        self.scout.is_staff = True
        self.scout.is_superuser = True
        self.scout.save()
        self.client.force_authenticate(self.scout)
        self.assertEqual(self.command(org, 'invite.create').status_code, 403)

    def test_founder_cannot_demote_or_remove_self(self):
        org = self.create()
        member = self.client.get(f'/api/tactical/organizations/{org}/members/').data['members'][0]['id']
        self.assertEqual(self.command(org, 'member.role', member_id=member, role='scout').status_code, 403)
        self.assertEqual(self.command(org, 'member.remove', member_id=member).status_code, 403)

    def test_unauthenticated_rejected(self):
        self.client = APIClient()
        self.assertEqual(self.client.get('/api/tactical/organizations/').status_code, 401)

    def test_join_replay_conflict_expiry_and_no_duplicate_applications(self):
        from TacticalCollaboration.models import Invite, JoinApplication
        from django.utils import timezone
        org = self.create()
        invite = self.command(org, 'invite.create').data['result']['invite_code']
        self.client.force_authenticate(self.scout)
        body = {'request_id': str(uuid4()), 'invite_code': invite}
        first = self.post('join/', body)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(self.post('join/', body).data, first.data)
        body['request_id'] = str(uuid4())
        self.assertEqual(self.post('join/', body).data['result']['id'], first.data['result']['id'])
        self.assertEqual(JoinApplication.objects.count(), 1)
        body['invite_code'] = 'invalid'
        self.assertEqual(self.post('join/', body).status_code, 409)
        Invite.objects.update(expires_at=timezone.now())
        self.assertEqual(self.post('join/', {'request_id': str(uuid4()), 'invite_code': invite}).status_code, 400)

    def test_error_shapes_and_no_store(self):
        org = self.create()
        for action in (['invite.create'], {'action': 'invite.create'}, None):
            response = self.command(org, action)
            self.assertEqual(response.status_code, 400)
            self.assertIn('detail', response.data)
        self.assertIn('no-store', self.client.get('/api/tactical/organizations/')['Cache-Control'])

    def test_admin_payload_is_bounded_before_json_decode(self):
        response = self.post('organizations/', {'name': 'x' * 70000, 'request_id': str(uuid4())})
        self.assertEqual(response.status_code, 400)
        self.assertIn('过大', str(response.data))
