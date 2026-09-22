"""Malformed JSON must fail validation without database writes or 500 errors."""
import json

from django.contrib.auth import get_user_model
from django.test import TestCase
from rest_framework.test import APIClient

from .models import Claim, Corporation


class ClaimRequestBoundaryTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(get_user_model().objects.create_user('boundary-owner'))

    def test_non_object_json_is_rejected_before_database_access(self):
        for payload in (None, True, False, 1, 1.5, 'claim', [], ['corporation_id']):
            with self.subTest(payload=payload), self.assertNumQueries(0):
                response = self.client.post('/api/community/claims/', json.dumps(payload),
                                            content_type='application/json')
                self.assertEqual(response.status_code, 400, response.content)
                self.assertIn('no-store', response['Cache-Control'])
                self.assertIn('detail', response.json())
        self.assertFalse(Corporation.objects.exists())
        self.assertFalse(Claim.objects.exists())
