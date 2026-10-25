"""Bounded SMTP transport tests. No real SMTP or production settings are used."""
import ast
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from django.core.mail import EmailMessage
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIRequestFactory

from Authentication import throttle
from Authentication.views import EmailVerification
from EVE_MDjango.EmailBackend import CustomEmailBackend


@override_settings(EMAIL_HOST='smtp.test.invalid', EMAIL_PORT=465,
                   EMAIL_HOST_USER='fixture-user', EMAIL_HOST_PASSWORD='fixture-only',
                   EMAIL_USE_SSL=True, EMAIL_USE_TLS=False, EMAIL_TIMEOUT=7)
class SMTPTimeoutTests(SimpleTestCase):
    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_configured_timeout_and_verified_context_reach_transport(self, smtp):
        backend = CustomEmailBackend()
        self.assertTrue(backend.open())
        self.assertEqual(smtp.call_args.kwargs.get('timeout'), 7)
        self.assertEqual(smtp.call_args.kwargs['context'].verify_mode, 2)
        self.assertTrue(smtp.call_args.kwargs['context'].check_hostname)
        smtp.return_value.login.assert_called_once_with('fixture-user', 'fixture-only')
        self.assertFalse(backend.open())
        self.assertEqual(smtp.call_count, 1)

    @override_settings(EMAIL_TIMEOUT=None)
    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_missing_setting_uses_finite_ten_second_fallback(self, smtp):
        CustomEmailBackend().open()
        self.assertEqual(smtp.call_args.kwargs.get('timeout'), 10)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_explicit_timeout_is_respected(self, smtp):
        CustomEmailBackend(timeout=3).open()
        self.assertEqual(smtp.call_args.kwargs.get('timeout'), 3)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_invalid_timeout_is_rejected_before_network_io(self, smtp):
        for value in (0, -1, 31, 10 ** 400, True, '10', float('inf'), float('nan')):
            with self.subTest(value=value):
                with self.assertRaises(ValueError):
                    CustomEmailBackend(timeout=value).open()
        smtp.assert_not_called()

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_failed_login_closes_and_discards_transport_before_retry(self, smtp):
        backend = CustomEmailBackend()
        connection = smtp.return_value
        connection.login.side_effect = TimeoutError('simulated login timeout')
        with self.assertLogs('EVE_MDjango.EmailBackend', level='ERROR'):
            with self.assertRaises(TimeoutError):
                backend.open()
        connection.close.assert_called_once_with()
        self.assertIsNone(backend.connection)
        connection.login.side_effect = None
        self.assertTrue(backend.open())
        self.assertEqual(smtp.call_count, 2)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_silent_failed_login_also_discards_partial_connection(self, smtp):
        backend = CustomEmailBackend(fail_silently=True)
        smtp.return_value.login.side_effect = TimeoutError('simulated login timeout')
        with self.assertLogs('EVE_MDjango.EmailBackend', level='ERROR'):
            self.assertFalse(backend.open())
        self.assertIsNone(backend.connection)
        smtp.return_value.close.assert_called_once_with()

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL', side_effect=TimeoutError('simulated connect timeout'))
    def test_connection_timeout_remains_a_delivery_failure(self, smtp):
        backend = CustomEmailBackend()
        with self.assertLogs('EVE_MDjango.EmailBackend', level='ERROR'):
            with self.assertRaises(TimeoutError):
                backend.send_messages([EmailMessage('subject', 'body', 'from@example.com', ['to@example.com'])])
        self.assertIsNone(backend.connection)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_send_timeout_is_propagated_and_connection_is_closed(self, smtp):
        backend = CustomEmailBackend()
        smtp.return_value.sendmail.side_effect = TimeoutError('simulated send timeout')
        with self.assertRaises(TimeoutError):
            backend.send_messages([EmailMessage('subject', 'body', 'from@example.com', ['to@example.com'])])
        self.assertIsNone(backend.connection)
        smtp.return_value.close.assert_called_once_with()
        self.assertEqual(smtp.call_args.kwargs.get('timeout'), 7)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_silent_send_timeout_does_not_retry_or_crash_later_messages(self, smtp):
        backend = CustomEmailBackend(fail_silently=True)
        smtp.return_value.sendmail.side_effect = TimeoutError('simulated send timeout')
        messages = [EmailMessage('subject', 'body', 'from@example.com', ['to@example.com']) for _ in range(2)]
        self.assertEqual(backend.send_messages(messages), 0)
        self.assertIsNone(backend.connection)
        self.assertEqual(smtp.call_count, 1)
        self.assertEqual(smtp.return_value.sendmail.call_count, 1)

    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL')
    def test_cleanup_failure_does_not_mask_login_timeout(self, smtp):
        backend = CustomEmailBackend()
        smtp.return_value.login.side_effect = TimeoutError('original login timeout')
        smtp.return_value.close.side_effect = OSError('cleanup failed')
        with self.assertLogs('EVE_MDjango.EmailBackend', level='WARNING'):
            with self.assertRaisesRegex(TimeoutError, 'original login timeout'):
                backend.open()
        self.assertIsNone(backend.connection)

    def test_production_default_is_explicit_without_loading_production_settings(self):
        source = Path(__file__).resolve().parents[1] / 'EVE_MDjango' / 'settings.py'
        nodes = ast.parse(source.read_text(encoding='utf-8-sig')).body
        defaults = [node.value.value for node in nodes if isinstance(node, ast.Assign)
                    and any(isinstance(target, ast.Name) and target.id == 'EMAIL_TIMEOUT' for target in node.targets)
                    and isinstance(node.value, ast.Constant)]
        self.assertEqual(defaults, [10])

    @override_settings(EMAIL_BACKEND='EVE_MDjango.EmailBackend.CustomEmailBackend')
    @patch('Authentication.views.clean_expired_verifications')
    @patch('Authentication.views.EmailVerificationCode.objects.update_or_create')
    @patch('EVE_MDjango.EmailBackend.smtplib.SMTP_SSL', side_effect=TimeoutError('simulated SMTP timeout'))
    def test_endpoint_does_not_claim_timeout_mail_was_sent(self, smtp, _update, _clean):
        request = APIRequestFactory().post('/api/user/emailcode', {'email': 'timeout-pilot@example.com'}, format='json')
        with self.assertLogs(level='ERROR'):
            response = EmailVerification.as_view()(request)
        self.assertEqual(response.status_code, 500)
        self.assertIn('验证码发送失败', response.data['error'])
        self.assertEqual(smtp.call_args.kwargs.get('timeout'), 7)


class LegacyReadThrottleContractTests(SimpleTestCase):
    def test_expensive_reads_have_independent_transport_budgets(self):
        keys = []
        for name, rate in (('PlanetaryQueryThrottle', '30/min'), ('BazaarChartThrottle', '60/hour')):
            with self.subTest(name=name):
                throttle_class = getattr(throttle, name, None)
                self.assertIsNotNone(throttle_class)
                budget = throttle_class()
                self.assertEqual(budget.rate, rate)
                original = SimpleNamespace(META={'REMOTE_ADDR': '192.0.2.40', 'HTTP_X_FORWARDED_FOR': '192.0.2.1'})
                changed = SimpleNamespace(META={'REMOTE_ADDR': '192.0.2.40', 'HTTP_X_FORWARDED_FOR': '198.51.100.10'})
                keys.append(budget.get_cache_key(original, None))
                self.assertEqual(keys[-1], budget.get_cache_key(changed, None))
        if len(keys) == 2:
            self.assertNotEqual(*keys)
