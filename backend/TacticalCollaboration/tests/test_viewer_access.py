from unittest.mock import patch
from datetime import timedelta

import jwt

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.exceptions import InvalidToken
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken

from TacticalCollaboration.realtime import TacticalConsumer
from TacticalCollaboration.services import active_user


@override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
class ViewerSocketAccessTests(SimpleTestCase):
    async def test_socket_accepts_an_ordinary_account_only_after_valid_jwt_authentication(self):
        user = type('User', (), {'email': 'other@example.com', 'is_authenticated': True})()
        token = AccessToken()
        token['user_id'] = 1
        with patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_user', return_value=user) as get_user:
            actor, expiry = await TacticalConsumer().authenticate(str(token))
        self.assertIs(actor, user)
        self.assertEqual(expiry, float(token['exp']))
        get_user.assert_called_once()

    async def test_socket_allows_allowlisted_valid_jwt(self):
        user = type('User', (), {'email': '2235102484@qq.com', 'is_authenticated': True})()
        with patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_validated_token',
                   return_value={'exp': 9999999999}), \
             patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_user', return_value=user):
            actor, _expiry = await TacticalConsumer().authenticate('valid-token')
        self.assertIs(actor, user)

    async def test_socket_rejects_invalid_signature_expiry_and_refresh_token_before_resolving_user(self):
        access = AccessToken()
        access['user_id'] = 1
        expired = AccessToken()
        expired.set_exp(lifetime=timedelta(seconds=-1))
        forged = jwt.encode(access.payload, 'not-the-configured-test-key', algorithm='HS256')
        for raw in ('not-a-token', forged, str(expired), str(RefreshToken())):
            with self.subTest(raw=raw), patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_user') as get_user:
                with self.assertRaises(InvalidToken):
                    await TacticalConsumer().authenticate(raw)
                get_user.assert_not_called()


@override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
class ViewerServiceAccessTests(TestCase):
    def test_existing_socket_actor_is_denied_after_database_deactivation(self):
        user = get_user_model().objects.create_user(username='viewer', email='2235102484@qq.com')
        active_user(user)
        get_user_model().objects.filter(pk=user.pk).update(is_active=False)
        with self.assertRaises(PermissionDenied):
            active_user(user)

    def test_existing_socket_actor_is_denied_after_database_deletion(self):
        user = get_user_model().objects.create_user(username='viewer-deleted', email='ordinary@example.com')
        active_user(user)
        get_user_model().objects.filter(pk=user.pk).delete()
        with self.assertRaises(PermissionDenied):
            active_user(user)
