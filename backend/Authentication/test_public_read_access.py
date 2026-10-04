"""Real JWT + isolated database checks for the public-read boundary."""

from datetime import timedelta
from unittest.mock import patch
from uuid import uuid4

import jwt

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from rest_framework.test import APIClient, APIRequestFactory
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from Community.models import Corporation, MediaAsset, Revision as CorporationRevision
from PlanetaryResource.models import PlanetaryProgramme, PlResourcePrice
from Starsea.models import Asset, Post, Revision
from TacticalCollaboration.models import Membership, Organization

from EVE_MDjango.public_access_test_urls import FuturePrivateAPI


class PublicReadIntegrationTests(TestCase):
    @classmethod
    def setUpClass(cls):
        # The legacy programme table is unmanaged; create only in this disposable
        # SQLite test database so cross-account filtering is exercised by real SQL.
        with connection.schema_editor() as editor:
            editor.create_model(PlanetaryProgramme)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            editor.delete_model(PlanetaryProgramme)

    def setUp(self):
        users = get_user_model().objects
        self.ordinary = users.create_user('ordinary', email='ordinary@example.com')
        self.owner = users.create_user('owner', email='2235102484@qq.com')
        self.staff = users.create_user('staff', email='staff@example.com', is_staff=True, is_superuser=True)
        self.client = APIClient()

    def sign_in(self, user):
        token = str(AccessToken.for_user(user))
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        return token

    def test_anonymous_can_read_public_catalogs_and_market_under_the_production_gate(self):
        for path in ('/api/market/categories/', '/api/market/items/', '/api/community/corporations/', '/api/starsea/posts/'):
            for method in ('get', 'head'):
                with self.subTest(path=path, method=method):
                    response = getattr(self.client, method)(path)
                    self.assertEqual(response.status_code, 200, response.content)

    def test_unknown_and_public_unsafe_requests_never_reach_an_unprotected_new_view(self):
        for method, path in (('get', '/api/future-private/'), ('post', '/api/future-private/'),
                             ('get', '/api/missing-private/'), ('post', '/api/market/items/'),
                             ('post', '/api/starsea/posts/'), ('delete', '/api/community/corporations/')):
            response = getattr(self.client, method)(path, {}, format='json')
            self.assertEqual(response.status_code, 401, (method, path, response.content))
        self.sign_in(self.ordinary)
        self.assertEqual(self.client.get('/api/future-private/').json(), {'identity': self.ordinary.pk})

    def test_default_drf_permission_also_protects_a_new_view_without_middleware(self):
        view = FuturePrivateAPI.as_view()
        for method in ('get', 'post'):
            response = view(getattr(APIRequestFactory(), method)('/api/future-private/'))
            self.assertEqual(response.status_code, 401)

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=False, VIEWER_PUBLIC_ACCESS_ENABLED=True, VIEWER_ALLOWLIST_ENABLED=False)
    def test_closed_mode_requires_auth_for_reads_but_accepts_an_ordinary_active_account(self):
        self.assertEqual(self.client.get('/api/market/items/').status_code, 401)
        self.sign_in(self.ordinary)
        self.assertEqual(self.client.get('/api/market/items/').status_code, 200)
        self.assertEqual(self.client.get('/api/killboard/reports/').status_code, 403)

    def test_private_gate_rejects_wrong_signature_expired_refresh_inactive_and_deleted_users(self):
        for token in (str(RefreshToken.for_user(self.ordinary)), 'not-a-jwt'):
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            self.assertEqual(self.client.get('/api/future-private/').status_code, 401)
        expired = AccessToken.for_user(self.ordinary)
        expired.set_exp(lifetime=timedelta(seconds=-1))
        forged = jwt.encode(AccessToken.for_user(self.ordinary).payload, 'a-different-test-signing-key', algorithm='HS256')
        for token in (str(expired), forged):
            self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
            self.assertEqual(self.client.get('/api/future-private/').status_code, 401)
        token = self.sign_in(self.ordinary)
        get_user_model().objects.filter(pk=self.ordinary.pk).update(is_active=False)
        self.assertEqual(self.client.get('/api/future-private/').status_code, 401)
        get_user_model().objects.filter(pk=self.ordinary.pk).update(is_active=True)
        self.assertEqual(self.client.get('/api/future-private/').status_code, 200)
        self.ordinary.delete()
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.client.get('/api/future-private/').status_code, 401)

    def test_ordinary_and_staff_tokens_cannot_replace_owner_or_organization_permissions(self):
        organization = Organization.objects.create(name='Private organization', founder=self.owner)
        for user in (self.ordinary, self.staff):
            self.sign_in(user)
            for path in ('/api/killboard/reports/', '/api/killboard/status/', '/api/tactical/usage/overview/',
                         f'/api/tactical/organizations/{organization.pk}/members/'):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 403, (user.username, path, response.content))
            self.assertEqual(self.client.get('/api/killboard/access/').json(), {'can_view_killboard': False})
            self.assertEqual(self.client.get('/api/tactical/usage/access/').json(), {'can_view_usage': False})
        self.sign_in(self.ordinary)
        for path in ('/api/market/admin/config/', '/api/community/reviews/', '/api/starsea/reviews/'):
            self.assertEqual(self.client.get(path).status_code, 403, path)

    def test_removed_membership_is_rechecked_even_with_the_same_valid_jwt(self):
        organization = Organization.objects.create(name='Private organization', founder=self.owner)
        membership = Membership.objects.create(organization=organization, user=self.ordinary, role='commander')
        self.sign_in(self.ordinary)
        path = f'/api/tactical/organizations/{organization.pk}/members/'
        self.assertEqual(self.client.get(path).status_code, 200)
        Membership.objects.filter(pk=membership.pk).update(role='scout')
        self.assertEqual(self.client.get(path).status_code, 403)
        Membership.objects.filter(pk=membership.pk).update(status='removed')
        self.assertEqual(self.client.get(path).status_code, 403)

    def test_personal_programmes_are_filtered_by_current_user_and_foreign_changes_are_denied(self):
        mine = PlanetaryProgramme.objects.create(user_id=self.ordinary.pk, user_name='ordinary', programme_name='Mine', programme_element=[])
        foreign = PlanetaryProgramme.objects.create(user_id=self.owner.pk, user_name='owner', programme_name='Private foreign', programme_element=[])
        self.assertEqual(self.client.get('/api/programme').status_code, 401)
        self.sign_in(self.ordinary)
        response = self.client.get('/api/programme')
        self.assertEqual(response.status_code, 200)
        self.assertEqual([row['programme_id'] for row in response.json()], [mine.pk])
        self.assertEqual(self.client.get('/api/programme', {'programme_id': foreign.pk}).json(), [])
        self.assertEqual(self.client.delete('/api/programme', {'programme_id': foreign.pk}, format='json').status_code, 404)
        self.assertEqual(self.client.patch('/api/programme', {'programme_id': foreign.pk, 'element': []}, format='json').status_code, 404)
        self.assertTrue(PlanetaryProgramme.objects.filter(pk=foreign.pk, user_id=self.owner.pk).exists())

    def test_anonymous_default_prices_only_query_public_fields_and_never_personal_prices(self):
        prices = [PlResourcePrice(resource_name='Public resource', resource_type='synthetic', resource_price=42)]
        with patch('PlanetaryResource.views.PlResourcePrice.objects.all', return_value=prices) as public_prices, \
             patch('PlanetaryResource.views.UserPrePrice.objects.filter') as personal_prices:
            response = self.client.get('/api/planetresourceprice/default', {'user_id': self.owner.pk, 'resetPrice': 'private'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{'resource_name': 'Public resource', 'resource_type': 'synthetic', 'resource_price': 42}])
        public_prices.assert_called_once_with()
        personal_prices.assert_not_called()
        self.assertEqual(self.client.get('/api/planetresourceprice').status_code, 401)
        self.assertEqual(self.client.post('/api/planetresourceprice/default', {}, format='json').status_code, 401)
        self.assertEqual(self.client.post('/api/planetresourceprice', {}, format='json').status_code, 401)

    def test_registered_personal_price_read_keeps_its_current_user_filter(self):
        self.sign_in(self.ordinary)
        with patch('PlanetaryResource.views.UserPrePrice.objects.filter') as personal_prices:
            personal_prices.return_value.exists.return_value = True
            personal_prices.return_value.first.return_value.pre_price_element = [{'private': 'mine'}]
            response = self.client.get('/api/planetresourceprice', {'user_id': self.owner.pk})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [{'private': 'mine'}])
        personal_prices.assert_called_once_with(user_id=self.ordinary.pk)

    def test_legacy_raw_upload_is_denied_before_ordinary_users_can_invoke_it(self):
        self.sign_in(self.ordinary)
        with patch('FraudList.views.UploadImageView.post', side_effect=AssertionError('Must not upload')) as upload:
            self.assertEqual(self.client.post('/api/uploadimage/', {}, format='json').status_code, 403)
        upload.assert_not_called()

    def test_starsea_draft_and_unreferenced_media_stay_hidden_to_visitors_and_other_accounts(self):
        post = Post.objects.create(author=self.owner, request_id=uuid4(), payload_hash='0' * 64)
        published = Revision.objects.create(post=post, author=self.owner, status='approved', title='Public title', content={'kind': 'story', 'title': 'Public title', 'body': 'Public body', 'images': []})
        draft = Revision.objects.create(post=post, author=self.owner, title='Private draft', content={'kind': 'story', 'title': 'Private draft', 'body': 'PRIVATE_DRAFT', 'images': []})
        post.published_revision = published
        post.working_revision = draft
        post.save()
        asset = Asset.objects.create(post=post, uploader=self.owner, request_id=uuid4(), original_sha256='0' * 64,
                                     sha256='0' * 64, storage_name='private-test-only.png', size=1, content_type='image/png', width=1, height=1)
        for user in (None, self.ordinary):
            self.client.credentials()
            if user:
                self.sign_in(user)
            response = self.client.get(f'/api/starsea/posts/{post.pk}/')
            self.assertEqual(response.status_code, 200)
            self.assertIn('Public title', response.content.decode())
            self.assertNotIn('PRIVATE_DRAFT', response.content.decode())
            self.assertEqual(self.client.get(f'/api/starsea/media/{asset.pk}/').status_code, 404)

    def test_community_published_payload_and_media_never_expose_working_revision(self):
        corporation = Corporation.objects.create(name='Public corporation', name_key='unique-test-key', owner=self.owner)
        published = CorporationRevision.objects.create(corporation=corporation, author=self.owner, status='approved', content={'introduction': 'PUBLIC_INTRODUCTION', 'activities': []})
        draft = CorporationRevision.objects.create(corporation=corporation, author=self.owner, content={'introduction': 'PRIVATE_DRAFT'})
        corporation.published_revision = published
        corporation.working_revision = draft
        corporation.save()
        asset = MediaAsset.objects.create(corporation=corporation, uploader=self.owner, request_id=uuid4(), original_sha256='0' * 64,
                                          sha256='0' * 64, storage_name='private-test-only.png', size=1, content_type='image/png', width=1, height=1)
        response = self.client.get(f'/api/community/corporations/{corporation.pk}/')
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIn('PUBLIC_INTRODUCTION', response.content.decode())
        self.assertNotIn('PRIVATE_DRAFT', response.content.decode())
        self.assertEqual(self.client.get(f'/api/community/corporations/{corporation.pk}/media/{asset.pk}/').status_code, 404)
