"""Public auth regressions using real local DB identities and locmem mail."""
import json
import time
from datetime import timedelta
from unittest.mock import patch

from django.conf import settings
from django.core import mail
from django.core.cache import cache
from django.core.cache.backends.base import InvalidCacheKey, memcache_key_warnings
from django.db import IntegrityError
from django.test import TestCase
from django.urls import include, path
from rest_framework.test import APIClient
from rest_framework_simplejwt.backends import TokenBackend
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from Authentication.models import EVEMUser, EmailVerificationCode


# Only this isolated settings module points its URLconf here. Production URLs
# and permission middleware remain owned by the separate access-policy suite.
urlpatterns = [path('api/user/', include('Authentication.urls'))]


class PublicAuthenticationTests(TestCase):
    password = 'Validpass9'
    email = 'new-pilot@example.com'

    def setUp(self):
        cache.clear()
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def post(self, endpoint, data, **extra):
        return self.client.post(f'/api/user/{endpoint}', data, format='json', **extra)

    def user(self, **extra):
        return EVEMUser.objects.create_user(username='new-pilot', email=self.email, password=self.password, **extra)

    def code(self, email=None, age=0):
        return EmailVerificationCode.objects.create(email=email or self.email, code='123456', created_at=int(time.time()) - age)

    def registration(self, **extra):
        return {'userName': 'new-pilot', 'email': self.email, 'password': self.password, 'verificationCode': '123456', **extra}

    def reset(self, **extra):
        return {'forgetEmail': self.email, 'forgetEmailVerification': '123456', 'forgetNewPassword': 'Changedpass9', 'forgetConfirmPassword': 'Changedpass9', **extra}

    def test_new_email_precheck_mail_registration_login_and_refresh(self):
        self.assertNotIn(self.email, settings.VIEWER_EMAIL_ALLOWLIST)
        check = self.post('signupcheck', {'email': self.email})
        self.assertEqual(check.status_code, 200)
        self.assertEqual(check.data['duplicate'], 'emailFalse')
        sent = self.post('emailcode', {'email': self.email})
        self.assertEqual(sent.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, [self.email])
        verification = EmailVerificationCode.objects.get(email=self.email)
        self.assertRegex(verification.code, r'^\d{6}$')
        self.assertIn(verification.code, mail.outbox[0].body)
        registered = self.post('register', self.registration(verificationCode=verification.code))
        self.assertEqual(registered.status_code, 201)
        user = EVEMUser.objects.get(email=self.email)
        self.assertTrue(user.check_password(self.password))
        self.assertTrue(user.is_active)
        self.assertFalse(user.is_staff)
        self.assertFalse(user.is_superuser)
        self.assertFalse(user.groups.exists())
        self.assertFalse(user.user_permissions.exists())
        self.assertFalse(EmailVerificationCode.objects.filter(email=self.email).exists())
        self.assertEqual(AccessToken(registered.data['access'])['user_id'], user.pk)
        logged_in = self.post('login', {'login_email': self.email, 'login_password': self.password})
        self.assertEqual(logged_in.status_code, 200)
        refreshed = self.post('token/refresh', {'refresh': logged_in.data['refresh']})
        self.assertEqual(refreshed.status_code, 200)
        self.assertEqual(AccessToken(refreshed.data['access'])['user_id'], user.pk)

    def test_registration_requires_a_verification_code_record(self):
        response = self.post('register', self.registration())
        self.assertEqual(response.status_code, 400)
        self.assertIn('not found', response.data['error'])
        self.assertFalse(EVEMUser.objects.exists())

    def test_wrong_or_unicode_code_cannot_create_account_or_consume_code(self):
        verification = self.code()
        for code in ('654321', '验证码'):
            with self.subTest(code=code):
                response = self.post('register', self.registration(verificationCode=code))
                self.assertEqual(response.status_code, 400)
                self.assertFalse(EVEMUser.objects.exists())
                self.assertTrue(EmailVerificationCode.objects.filter(pk=verification.pk).exists())

    def test_surrogate_long_and_non_ascii_codes_cannot_register_or_reset(self):
        verification = self.code()
        for index, code in enumerate(('\ud800', '1' * 10000, '１２３４５６')):
            with self.subTest(kind=index):
                response = self.client.generic('POST', '/api/user/register', json.dumps(self.registration(verificationCode=code)), content_type='application/json', REMOTE_ADDR=f'203.0.113.{index + 1}')
                self.assertEqual(response.status_code, 400)
                self.assertFalse(EVEMUser.objects.exists())
                self.assertTrue(EmailVerificationCode.objects.filter(pk=verification.pk).exists())
        user = self.user()
        for index, code in enumerate(('\ud800', '1' * 10000, '１２３４５６')):
            with self.subTest(reset_kind=index):
                response = self.client.generic('POST', '/api/user/forgetPassword', json.dumps(self.reset(forgetEmailVerification=code)), content_type='application/json', REMOTE_ADDR=f'203.0.113.{index + 1}')
                self.assertEqual(response.status_code, 400)
                user.refresh_from_db()
                self.assertTrue(user.check_password(self.password))
                self.assertTrue(EmailVerificationCode.objects.filter(pk=verification.pk).exists())

    def test_registration_rejects_code_at_600_seconds_without_another_send(self):
        self.code(age=600)
        response = self.post('register', self.registration())
        self.assertEqual(response.status_code, 400)
        self.assertIn('expired', response.data['error'])
        self.assertFalse(EVEMUser.objects.exists())

    def test_consumed_registration_code_cannot_create_another_account(self):
        self.code()
        self.assertEqual(self.post('register', self.registration()).status_code, 201)
        response = self.post('register', self.registration(userName='second-pilot'))
        self.assertEqual(response.status_code, 400)
        self.assertEqual(EVEMUser.objects.count(), 1)
        self.assertFalse(EmailVerificationCode.objects.exists())

    def test_duplicate_username_and_email_preserve_existing_account(self):
        existing = self.user()
        self.code(email='second-pilot@example.com')
        username_response = self.post('register', self.registration(email='second-pilot@example.com'))
        self.assertEqual(username_response.status_code, 400)
        self.code()
        email_response = self.post('register', self.registration(userName='second-pilot', email=self.email.upper()))
        self.assertEqual(email_response.status_code, 400)
        self.assertEqual(EVEMUser.objects.count(), 1)
        existing.refresh_from_db()
        self.assertTrue(existing.check_password(self.password))
        self.assertEqual(EmailVerificationCode.objects.count(), 2)

    @patch('Authentication.views.EVEMUser.objects.create_user', side_effect=IntegrityError('simulated duplicate race'))
    def test_registration_transaction_keeps_code_on_failed_creation(self, create_user):
        verification = self.code()
        response = self.post('register', self.registration())
        self.assertEqual(response.status_code, 400)
        self.assertNotIn('simulated', response.data['error'])
        self.assertTrue(EmailVerificationCode.objects.filter(pk=verification.pk).exists())
        self.assertFalse(EVEMUser.objects.exists())
        create_user.assert_called_once()

    def test_bad_email_and_nonstring_json_payloads_return_validation_errors(self):
        cases = [
            ('emailcode', {'email': 'valid@example.com extra'}),
            ('emailcode', {'email': ['not-an-address']}),
            ('register', self.registration(userName=['pilot'])),
            ('login', {'login_email': 42, 'login_password': self.password}),
            ('forgetPassword', self.reset(forgetEmail={'email': self.email})),
            ('signupcheck', []),
        ]
        for index, (endpoint, data) in enumerate(cases):
            with self.subTest(endpoint=endpoint, data=data):
                response = self.post(endpoint, data, REMOTE_ADDR=f'203.0.113.{index + 1}')
                self.assertEqual(response.status_code, 400)
        self.assertFalse(EVEMUser.objects.exists())
        self.assertFalse(EmailVerificationCode.objects.exists())
        self.assertEqual(len(getattr(mail, 'outbox', [])), 0)

    def test_email_casing_and_whitespace_share_verification_and_login_identity(self):
        self.assertEqual(self.post('emailcode', {'email': f' {self.email.upper()} '}).status_code, 200)
        verification = EmailVerificationCode.objects.get(email=self.email)
        response = self.post('register', self.registration(email=self.email.upper(), verificationCode=verification.code))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(self.post('login', {'login_email': self.email.upper(), 'login_password': self.password}).status_code, 200)
        self.assertEqual(self.post('signupcheck', {'email': self.email.upper()}).data['duplicate'], 'email')

    def test_wrong_password_and_inactive_account_never_receive_tokens(self):
        user = self.user()
        wrong = self.post('login', {'login_email': self.email, 'login_password': 'Wrongpass9'})
        self.assertEqual(wrong.status_code, 401)
        self.assertNotIn('access', wrong.data)
        user.is_active = False
        user.save(update_fields=['is_active'])
        inactive = self.post('login', {'login_email': self.email, 'login_password': self.password})
        self.assertEqual(inactive.status_code, 401)
        self.assertNotIn('refresh', inactive.data)

    def test_ambiguous_historical_email_identity_is_rejected_without_changes(self):
        first = self.user()
        second = EVEMUser.objects.create_user(username='historical-case-duplicate', email=self.email.upper(), password='Secondpass9')
        response = self.post('login', {'login_email': self.email, 'login_password': self.password})
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('access', response.data)
        self.code()
        self.assertEqual(self.post('forgetPassword', self.reset()).status_code, 400)
        first.refresh_from_db()
        second.refresh_from_db()
        self.assertTrue(first.check_password(self.password))
        self.assertTrue(second.check_password('Secondpass9'))
        self.assertTrue(EmailVerificationCode.objects.exists())

    def test_existing_nonallowlisted_account_can_check_email_and_reset_once(self):
        user = self.user()
        self.assertEqual(self.post('forgetemailcheck', {'email': self.email}).data['duplicate'], 'email')
        self.code()
        response = self.post('forgetPassword', self.reset())
        self.assertEqual(response.status_code, 200)
        user.refresh_from_db()
        self.assertTrue(user.check_password('Changedpass9'))
        self.assertFalse(EmailVerificationCode.objects.exists())
        self.assertEqual(self.post('forgetPassword', self.reset()).status_code, 400)

    def test_expired_reset_code_cannot_change_password(self):
        user = self.user()
        self.code(age=601)
        response = self.post('forgetPassword', self.reset())
        self.assertEqual(response.status_code, 400)
        user.refresh_from_db()
        self.assertTrue(user.check_password(self.password))

    def test_inactive_account_cannot_reset_or_reactivate_itself(self):
        user = self.user(is_active=False)
        self.code()
        response = self.post('forgetPassword', self.reset())
        self.assertEqual(response.status_code, 401)
        user.refresh_from_db()
        self.assertFalse(user.is_active)
        self.assertTrue(user.check_password(self.password))

    def test_change_password_still_requires_a_valid_authenticated_account(self):
        self.user()
        response = self.post('changepwd', {'oldPassword': self.password, 'newPassword': 'Changedpass9', 'confirmPassword': 'Changedpass9'})
        self.assertEqual(response.status_code, 401)
        self.assertTrue(EVEMUser.objects.get(email=self.email).check_password(self.password))

    @patch('Authentication.views.send_mail', side_effect=RuntimeError('controlled SMTP failure'))
    def test_mail_failure_is_not_reported_as_sent(self, send_mail):
        response = self.post('emailcode', {'email': self.email})
        self.assertEqual(response.status_code, 500)
        self.assertIn('验证码发送失败', response.data['error'])
        self.assertEqual(len(getattr(mail, 'outbox', [])), 0)
        self.assertFalse(EmailVerificationCode.objects.filter(email=self.email).exists())
        send_mail.assert_called_once()

    @patch('Authentication.views.send_mail', side_effect=RuntimeError('controlled SMTP failure'))
    def test_failed_resend_preserves_the_delivered_code_and_its_expiry(self, send_mail):
        verification = self.code(age=120)
        original_timestamp = verification.created_at
        response = self.post('emailcode', {'email': self.email})
        self.assertEqual(response.status_code, 500)
        verification.refresh_from_db()
        self.assertEqual(verification.code, '123456')
        self.assertEqual(verification.created_at, original_timestamp)
        self.assertEqual(self.post('register', self.registration()).status_code, 201)

    @patch('Authentication.views.send_mail', return_value=0)
    def test_zero_messages_sent_is_a_failure_without_a_usable_new_code(self, send_mail):
        response = self.post('emailcode', {'email': self.email})
        self.assertEqual(response.status_code, 500)
        self.assertFalse(EmailVerificationCode.objects.filter(email=self.email).exists())
        self.assertEqual(self.post('register', self.registration()).status_code, 400)

    @patch('Authentication.views.send_mail', return_value=0)
    def test_zero_messages_on_resend_keeps_the_previous_code(self, send_mail):
        verification = self.code(age=120)
        original_timestamp = verification.created_at
        response = self.post('emailcode', {'email': self.email})
        self.assertEqual(response.status_code, 500)
        verification.refresh_from_db()
        self.assertEqual(verification.code, '123456')
        self.assertEqual(verification.created_at, original_timestamp)

    @patch('Authentication.views.secrets.randbelow', return_value=554321)
    def test_delivered_resend_replaces_old_code_and_new_code_is_consumed_once(self, randbelow):
        self.code(age=120)
        response = self.post('emailcode', {'email': self.email})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn('654321', mail.outbox[0].body)
        self.assertEqual(self.post('register', self.registration()).status_code, 400)
        self.assertFalse(EVEMUser.objects.exists())
        self.assertEqual(self.post('register', self.registration(verificationCode='654321')).status_code, 201)
        self.assertFalse(EmailVerificationCode.objects.exists())

    def test_refresh_identity_and_display_claims_follow_current_database_user(self):
        user = self.user()
        token = RefreshToken.for_user(user)
        token['email'] = 'another-identity@example.com'
        token['userName'] = 'stale-name'
        user.email = 'updated-pilot@example.com'
        user.username = 'updated-pilot'
        user.save(update_fields=['email', 'username'])
        response = self.post('token/refresh', {'refresh': str(token)})
        self.assertEqual(response.status_code, 200)
        access = AccessToken(response.data['access'])
        self.assertEqual(access['user_id'], user.pk)
        self.assertEqual(access['email'], user.email)
        self.assertEqual(access['userName'], user.username)

    def test_refresh_with_valid_db_identity_does_not_require_email_claim(self):
        user = self.user()
        token = RefreshToken.for_user(user)
        self.assertNotIn('email', token)
        response = self.post('token/refresh', {'refresh': str(token)})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(AccessToken(response.data['access'])['email'], self.email)

    def test_refresh_rejects_inactive_and_deleted_database_users(self):
        user = self.user()
        token = str(RefreshToken.for_user(user))
        user.is_active = False
        user.save(update_fields=['is_active'])
        self.assertEqual(self.post('token/refresh', {'refresh': token}).status_code, 401)
        user.delete()
        self.assertEqual(self.post('token/refresh', {'refresh': token}).status_code, 401)

    def test_invalid_signature_expiry_and_token_type_are_rejected_before_db_lookup(self):
        user = self.user()
        token = RefreshToken.for_user(user)
        expired = RefreshToken.for_user(user)
        expired.set_exp(lifetime=timedelta(seconds=-1))
        wrong_signature = TokenBackend(algorithm='HS256', signing_key='different-isolated-test-signing-key').encode(token.payload)
        for value in ('not-a-jwt', wrong_signature, str(expired), str(AccessToken.for_user(user))):
            with self.subTest(token=value[:16]), self.assertNumQueries(0):
                response = self.post('token/refresh', {'refresh': value})
                self.assertEqual(response.status_code, 401)
                self.assertNotIn('access', response.data)

    def test_signed_refresh_with_missing_or_malformed_identity_is_rejected(self):
        user = self.user()
        for user_id in (None, True, {}, [], 'not-an-id', 999999):
            with self.subTest(user_id=user_id):
                token = RefreshToken.for_user(user)
                if user_id is None:
                    del token['user_id']
                else:
                    token['user_id'] = user_id
                response = self.post('token/refresh', {'refresh': str(token)})
                self.assertEqual(response.status_code, 401)
                self.assertNotIn('access', response.data)

    def test_refresh_keeps_framework_rotation_and_current_database_claims(self):
        user = self.user()
        token = RefreshToken.for_user(user)
        # SimpleJWT5.3.1 captures its settings object on import. Set the real
        # framework consumer's configuration, not a stale Django override.
        with patch('rest_framework_simplejwt.serializers.api_settings.ROTATE_REFRESH_TOKENS', True), patch('rest_framework_simplejwt.serializers.api_settings.BLACKLIST_AFTER_ROTATION', False):
            response = self.post('token/refresh', {'refresh': str(token)})
        self.assertEqual(response.status_code, 200)
        rotated = RefreshToken(response.data['refresh'])
        self.assertNotEqual(rotated['jti'], token['jti'])
        self.assertEqual(rotated['user_id'], user.pk)
        self.assertEqual(rotated['email'], user.email)

    def test_email_minute_cap_cannot_be_bypassed_with_case_variations(self):
        self.assertEqual(self.post('emailcode', {'email': self.email}).status_code, 200)
        blocked = self.post('emailcode', {'email': self.email.upper()})
        self.assertEqual(blocked.status_code, 429)
        self.assertIn('Retry-After', blocked)
        self.assertEqual(len(mail.outbox), 1)

    def test_email_cache_keys_remain_valid_for_malformed_and_long_addresses(self):
        def strict_cache_key(key):
            for warning in memcache_key_warnings(key):
                raise InvalidCacheKey(warning)

        with patch('django.core.cache.backends.locmem.LocMemCache.validate_key', side_effect=strict_cache_key):
            for index, email in enumerate(('valid@example.com extra', 'x' * 260 + '@example.com', 'x' * 400 + '@example.com', '\ud800@example.com')):
                with self.subTest(kind=index):
                    response = self.client.generic('POST', '/api/user/emailcode', json.dumps({'email': email}), content_type='application/json', REMOTE_ADDR=f'203.0.113.{index + 1}')
                    self.assertEqual(response.status_code, 400)
            self.assertEqual(self.post('emailcode', {'email': self.email}).status_code, 200)
            self.assertEqual(self.post('emailcode', {'email': self.email.upper()}).status_code, 429)
        self.assertEqual(len(mail.outbox), 1)

    def test_email_daily_cap_remains_five_sends(self):
        now = time.time()
        with patch('Authentication.throttle.MinuteThrottle.timer') as timer:
            for index in range(5):
                timer.return_value = now + 61 * index
                self.assertEqual(self.post('emailcode', {'email': self.email}).status_code, 200)
            timer.return_value = now + 61 * 5
            blocked = self.post('emailcode', {'email': self.email})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(len(mail.outbox), 5)

    def test_ip_hour_cap_limits_distinct_email_recipients(self):
        for index in range(60):
            self.assertEqual(self.post('emailcode', {'email': f'pilot{index}@example.com'}).status_code, 200)
        blocked = self.post('emailcode', {'email': 'pilot60@example.com'})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(len(mail.outbox), 60)
        self.assertFalse(EmailVerificationCode.objects.filter(email='pilot60@example.com').exists())

    def test_ip_day_cap_limits_recipients_across_hours(self):
        now = time.time()
        with patch('Authentication.throttle.AuthIPThrottle.timer') as timer:
            for index in range(200):
                timer.return_value = now + 3601 * (index // 60)
                self.assertEqual(self.post('emailcode', {'email': f'pilot{index}@example.com'}).status_code, 200)
            timer.return_value = now + 3601 * 3
            blocked = self.post('emailcode', {'email': 'pilot200@example.com'})
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(len(mail.outbox), 200)

    def test_login_account_cap_blocks_cross_ip_password_guessing_before_database_lookup(self):
        self.user()
        for index in range(10):
            self.assertEqual(self.post('login', {'login_email': self.email, 'login_password': 'Wrongpass9'}, REMOTE_ADDR=f'203.0.113.{index + 1}').status_code, 401)
        with self.assertNumQueries(0):
            blocked = self.post('login', {'login_email': self.email.upper(), 'login_password': self.password}, REMOTE_ADDR='203.0.113.99')
        self.assertEqual(blocked.status_code, 429)
        self.assertNotIn('access', blocked.data)

    def test_registration_account_cap_keeps_unconsumed_code_and_creates_no_user(self):
        self.code()
        for _ in range(5):
            self.assertEqual(self.post('register', self.registration(verificationCode='000000')).status_code, 400)
        blocked = self.post('register', self.registration())
        self.assertEqual(blocked.status_code, 429)
        self.assertFalse(EVEMUser.objects.exists())
        self.assertTrue(EmailVerificationCode.objects.exists())

    def test_reset_account_cap_blocks_code_guessing_without_password_changes(self):
        user = self.user()
        self.code()
        for _ in range(5):
            self.assertEqual(self.post('forgetPassword', self.reset(forgetEmailVerification='000000')).status_code, 400)
        self.assertEqual(self.post('forgetPassword', self.reset()).status_code, 429)
        user.refresh_from_db()
        self.assertTrue(user.check_password(self.password))

    def test_precheck_ip_cap_applies_even_to_malformed_requests(self):
        for _ in range(300):
            self.assertEqual(self.post('signupcheck', {}).status_code, 400)
        self.assertEqual(self.post('signupcheck', {}).status_code, 429)

    def test_spoofed_forwarded_address_does_not_change_local_proxy_ip_budget(self):
        for index in range(60):
            response = self.post('login', {'login_email': f'pilot{index}@example.com', 'login_password': self.password}, REMOTE_ADDR='127.0.0.1', HTTP_X_FORWARDED_FOR=f'198.51.100.{index + 1}')
            self.assertEqual(response.status_code, 401)
        blocked = self.post('login', {'login_email': 'pilot60@example.com', 'login_password': self.password}, REMOTE_ADDR='127.0.0.1', HTTP_X_FORWARDED_FOR='203.0.113.99')
        self.assertEqual(blocked.status_code, 429)

    def test_direct_client_cannot_spoof_forwarded_ip_to_reset_budget(self):
        for index in range(60):
            response = self.post('login', {'login_email': f'pilot{index}@example.com', 'login_password': self.password}, REMOTE_ADDR='203.0.113.44', HTTP_X_FORWARDED_FOR=f'198.51.100.{index + 1}')
            self.assertEqual(response.status_code, 401)
        blocked = self.post('login', {'login_email': 'pilot60@example.com', 'login_password': self.password}, REMOTE_ADDR='203.0.113.44', HTTP_X_FORWARDED_FOR='198.51.100.99')
        self.assertEqual(blocked.status_code, 429)
