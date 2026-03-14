import datetime

from django.urls import reverse
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from .models import ActivationCode


class ValidateActivationCodeTests(APITestCase):
    def setUp(self):
        self.url = reverse('validate_code')

    def create_code(self, **overrides):
        payload = {
            'code': 'test-code-001',
            'is_active': 1,
            'expires_at': timezone.now() + datetime.timedelta(days=7),
            'pc_identifier': None,
        }
        payload.update(overrides)
        return ActivationCode.objects.create(**payload)

    def test_first_validation_binds_machine_without_consuming_code(self):
        activation = self.create_code()

        response = self.client.post(self.url, {'code': activation.code, 'pc_identifier': 'pc-a'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        activation.refresh_from_db()
        self.assertEqual(activation.pc_identifier, 'pc-a')
        self.assertEqual(activation.is_active, 1)
        self.assertIsNotNone(activation.last_used)

    def test_same_machine_can_validate_repeatedly(self):
        activation = self.create_code(pc_identifier='pc-a')

        response = self.client.post(self.url, {'code': activation.code, 'pc_identifier': 'pc-a'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])

    def test_legacy_inactive_code_bound_to_same_machine_still_valid(self):
        activation = self.create_code(code='legacy-code', is_active=0, pc_identifier='pc-a')

        response = self.client.post(self.url, {'code': activation.code, 'pc_identifier': 'pc-a'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response.data['valid'])

    def test_bound_to_other_machine_returns_400(self):
        activation = self.create_code(pc_identifier='pc-a')

        response = self.client.post(self.url, {'code': activation.code, 'pc_identifier': 'pc-b'}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['message'], '该激活码已绑定其他电脑')

    def test_missing_required_fields_returns_400(self):
        response = self.client.post(self.url, {'code': ''}, format='json')

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data['message'], '缺少必填字段')
