from unittest.mock import patch

from contextlib import nullcontext
import smtplib

from django.test import SimpleTestCase
from rest_framework.test import APIRequestFactory

from Authentication.views import EmailVerification
from EVE_MDjango.EmailBackend import CustomEmailBackend


class EmailVerificationTests(SimpleTestCase):
    def setUp(self):
        self.factory = APIRequestFactory()

    @patch('Authentication.views.clean_expired_verifications')
    @patch('Authentication.views.EmailVerificationCode.objects.update_or_create')
    @patch('Authentication.views.send_mail', side_effect=RuntimeError('smtp failed'))
    def test_email_code_returns_server_error_when_send_mail_fails(self, _mock_send_mail, _mock_update_or_create, _mock_clean):
        request = self.factory.post('/api/user/emailcode', {'email': 'tester@example.com'}, format='json')
        with patch('Authentication.views.transaction.atomic', return_value=nullcontext()):
            response = EmailVerification.as_view()(request)

        self.assertEqual(response.status_code, 500)
        self.assertEqual(response.data['error'], '验证码发送失败，请查看后端日志')
        _mock_send_mail.assert_called_once()


class SMTPConnectionTests(SimpleTestCase):
    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    @patch('EVE_MDjango.EmailBackend.ssl.create_default_context')
    def test_verified_tls_connection_uses_a_bounded_default_timeout(self, tls_context, smtp):
        backend = CustomEmailBackend(host='smtp.test.invalid', port=465, username='', password='', timeout=None)
        self.assertTrue(backend.open())
        smtp.assert_called_once_with('smtp.test.invalid', 465, context=tls_context.return_value, timeout=20)
        self.assertIn('cafile', tls_context.call_args.kwargs)
        self.assertIs(backend.connection, smtp.return_value)
        self.assertFalse(backend.open())
        self.assertEqual(smtp.call_count, 1)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    @patch('EVE_MDjango.EmailBackend.ssl.create_default_context')
    def test_explicit_timeout_is_respected(self, tls_context, smtp):
        backend = CustomEmailBackend(host='smtp.test.invalid', port=465, username='', password='', timeout=7)
        self.assertTrue(backend.open())
        self.assertEqual(smtp.call_args.kwargs['timeout'], 7)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    @patch('EVE_MDjango.EmailBackend.ssl.create_default_context')
    def test_failed_login_closes_connection_and_does_not_reuse_it(self, tls_context, smtp):
        connection = smtp.return_value
        connection.login.side_effect = smtplib.SMTPAuthenticationError(535, b'controlled authentication failure')
        backend = CustomEmailBackend(host='smtp.test.invalid', port=465, username='synthetic-user', password='synthetic-test-only')
        with self.assertRaises(smtplib.SMTPAuthenticationError):
            backend.open()
        connection.close.assert_called_once()
        self.assertIsNone(backend.connection)
        connection.login.side_effect = None
        self.assertTrue(backend.open())
        self.assertEqual(smtp.call_count, 2)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    @patch('EVE_MDjango.EmailBackend.ssl.create_default_context')
    def test_silent_login_failure_cannot_send_using_unauthenticated_connection(self, tls_context, smtp):
        connection = smtp.return_value
        connection.login.side_effect = smtplib.SMTPAuthenticationError(535, b'controlled authentication failure')
        backend = CustomEmailBackend(host='smtp.test.invalid', port=465, username='synthetic-user', password='synthetic-test-only', fail_silently=True)
        self.assertFalse(backend.open())
        self.assertIsNone(backend.connection)
        connection.close.assert_called_once()
        connection.sendmail.assert_not_called()
