from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import SimpleTestCase, TestCase, override_settings
from rest_framework.exceptions import PermissionDenied

from TacticalCollaboration.realtime import TacticalConsumer
from TacticalCollaboration.services import active_user


@override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
class ViewerSocketAccessTests(SimpleTestCase):
    async def test_socket_rejects_nonallowlisted_valid_jwt(self):
        user = type('User', (), {'email': 'other@example.com', 'is_authenticated': True})()
        with patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_validated_token',
                   return_value={'exp': 9999999999}), \
             patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_user', return_value=user):
            with self.assertRaises(PermissionDenied):
                await TacticalConsumer().authenticate('valid-old-token')

    async def test_socket_allows_allowlisted_valid_jwt(self):
        user = type('User', (), {'email': '2235102484@qq.com', 'is_authenticated': True})()
        with patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_validated_token',
                   return_value={'exp': 9999999999}), \
             patch('rest_framework_simplejwt.authentication.JWTAuthentication.get_user', return_value=user):
            actor, _expiry = await TacticalConsumer().authenticate('valid-token')
        self.assertIs(actor, user)


@override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
class ViewerServiceAccessTests(TestCase):
    def test_existing_socket_actor_is_denied_after_email_change(self):
        user = get_user_model().objects.create_user(username='viewer', email='2235102484@qq.com')
        active_user(user)
        get_user_model().objects.filter(pk=user.pk).update(email='other@example.com')
        with self.assertRaises(PermissionDenied):
            active_user(user)
