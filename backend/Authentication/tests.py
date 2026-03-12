from unittest.mock import patch

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from Authentication.views import EmailVerification


class EmailVerificationTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @patch('Authentication.views.clean_expired_verifications')
    @patch('Authentication.views.EmailVerificationCode.objects.update_or_create')
    @patch('Authentication.views.send_mail', side_effect=RuntimeError('smtp failed'))
    def test_email_code_returns_server_error_when_send_mail_fails(self, _mock_send_mail, _mock_update_or_create, _mock_clean):
        request = self.factory.post('/api/user/emailcode', {'email': 'tester@example.com'}, format='json')
        response = EmailVerification.as_view()(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data['error'], '验证码发送失败，请查看后端日志')
