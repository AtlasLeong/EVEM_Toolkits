"""Protect paginated list reads from per-row corporation/revision queries."""
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from .models import Claim, Corporation, Revision
from .views import default_content


class CollectionQueryTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.owner = get_user_model().objects.create_user('collection-owner')
        cls.staff = get_user_model().objects.create_user('collection-staff', is_staff=True)
        for index in range(21):
            corporation = Corporation.objects.create(name=f'Corporation {index}', name_key=f'collection-{index}',
                                                       owner=cls.owner)
            published = Revision.objects.create(corporation=corporation, author=cls.owner,
                                                 status='approved', content=default_content(),
                                                 reviewed_at=timezone.now())
            pending = Revision.objects.create(corporation=corporation, author=cls.owner,
                                               status='pending', content=default_content())
            corporation.published_revision = published
            corporation.working_revision = pending
            corporation.save(update_fields=['published_revision', 'working_revision'])
            Claim.objects.create(corporation=corporation, applicant=cls.owner, request_id=uuid4(),
                                 payload_hash='0' * 64, statement='Private claim', contact='Private contact')

    def setUp(self):
        self.client = APIClient()

    def test_public_pages_use_two_queries_independent_of_row_count(self):
        for page, size in ((1, 20), (2, 1)):
            with self.subTest(page=page), self.assertNumQueries(2):
                response = self.client.get(f'/api/community/corporations/?page={page}')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['count'], 21)
                self.assertEqual(len(response.json()['results']), size)

    def test_owner_pages_use_four_queries_for_both_collections(self):
        self.client.force_authenticate(self.owner)
        for page, size in ((1, 20), (2, 1)):
            with self.subTest(page=page), self.assertNumQueries(4):
                response = self.client.get(f'/api/community/mine/?page={page}')
                self.assertEqual(response.status_code, 200)
                for key in ('claims', 'corporations'):
                    self.assertEqual(response.json()[f'{key}_count'], 21)
                    self.assertEqual(len(response.json()[key]), size)

    def test_review_pages_use_two_queries_for_claims_and_revisions(self):
        self.client.force_authenticate(self.staff)
        for kind in ('claims', 'revisions'):
            for page, size in ((1, 20), (2, 1)):
                with self.subTest(kind=kind, page=page), self.assertNumQueries(2):
                    response = self.client.get(f'/api/community/reviews/?kind={kind}&page={page}')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json()['count'], 21)
                    self.assertEqual(len(response.json()['results']), size)
