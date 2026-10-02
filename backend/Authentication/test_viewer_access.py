from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings
from rest_framework.request import Request
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.tokens import RefreshToken

from Authentication.access import is_viewer_allowed
from Authentication.permissions import IsAllowlistedViewer
from Authentication.middleware import ViewerAccessMiddleware
from Authentication.views import LoginView
from Authentication.serializers import AllowlistedTokenRefreshSerializer


class ViewerAllowlistTests(SimpleTestCase):
    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_allowlist_is_case_insensitive_and_rejects_other_accounts(self):
        self.assertTrue(is_viewer_allowed(' 2235102484@QQ.COM '))
        self.assertFalse(is_viewer_allowed('other@example.com'))

    @override_settings(VIEWER_ALLOWLIST_ENABLED=False, VIEWER_EMAIL_ALLOWLIST=[])
    def test_disabled_allowlist_restores_open_access(self):
        self.assertTrue(is_viewer_allowed('other@example.com'))
        anonymous = Request(RequestFactory().get('/api/market/items/'))
        self.assertTrue(IsAllowlistedViewer().has_permission(anonymous, None))

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_market_permission_requires_the_allowed_authenticated_user(self):
        factory = RequestFactory()
        permission = IsAllowlistedViewer()

        anonymous = Request(factory.get('/api/market/items/'))
        self.assertFalse(permission.has_permission(anonymous, None))

        denied = Request(factory.get('/api/market/items/'))
        denied.user = type('User', (), {'is_authenticated': True, 'email': 'other@example.com'})()
        self.assertFalse(permission.has_permission(denied, None))

        allowed = Request(factory.get('/api/market/items/'))
        allowed.user = type('User', (), {'is_authenticated': True, 'email': '2235102484@qq.com'})()
        self.assertTrue(permission.has_permission(allowed, None))

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    @patch('Authentication.views.EVEMUser.objects.get')
    def test_login_rejects_non_allowlisted_email_before_password_check(self, get_user):
        request = RequestFactory().post(
            '/api/user/login',
            {'login_email': 'other@example.com', 'login_password': 'secret'},
            format='json',
        )
        response = LoginView.as_view()(request)
        self.assertEqual(response.status_code, 403)
        get_user.assert_not_called()

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_api_middleware_rejects_anonymous_data_requests(self):
        request = RequestFactory().get('/api/game-data/items/')
        response = ViewerAccessMiddleware(lambda _request: 'next')(request)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response['WWW-Authenticate'], 'Bearer')

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_api_middleware_leaves_auth_and_health_routes_public(self):
        factory = RequestFactory()
        for path in ('/api/user/login', '/api/deploy-version/', '/api/community/ready/'):
            request = factory.get(path)
            self.assertEqual(ViewerAccessMiddleware(lambda _request: 'next')(request), 'next')

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_activation_validation_routes_remain_public_for_script_clients(self):
        factory = RequestFactory()
        for path in ('/api/activationcode/validate-code/', '/api/license/validate-code/'):
            request = factory.post(path, {}, content_type='application/json')
            self.assertEqual(ViewerAccessMiddleware(lambda _request: 'next')(request), 'next')

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_activation_code_management_routes_remain_protected(self):
        request = RequestFactory().post('/api/activationcode/generate-code/', {}, content_type='application/json')
        response = ViewerAccessMiddleware(lambda _request: 'next')(request)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(response['WWW-Authenticate'], 'Bearer')

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_api_middleware_allows_only_the_allowlisted_authenticated_user(self):
        middleware = ViewerAccessMiddleware(lambda _request: 'next')
        middleware.authentication = Mock()
        request = RequestFactory().get('/api/game-data/items/')

        middleware.authentication.authenticate.return_value = (
            type('User', (), {'is_authenticated': True, 'email': 'other@example.com'})(),
            object(),
        )
        self.assertEqual(middleware(request).status_code, 403)

        middleware.authentication.authenticate.return_value = (
            type('User', (), {'is_authenticated': True, 'email': '2235102484@qq.com'})(),
            object(),
        )
        self.assertEqual(middleware(request), 'next')

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_refresh_rejects_other_emails_and_tokens_without_an_email(self):
        for email in (None, 'other@example.com'):
            token = RefreshToken()
            if email is not None:
                token['email'] = email
            with self.subTest(email=email), self.assertRaises(PermissionDenied):
                AllowlistedTokenRefreshSerializer().validate({'refresh': str(token)})

    @override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_EMAIL_ALLOWLIST=['2235102484@qq.com'])
    def test_refresh_allows_the_viewer(self):
        token = RefreshToken()
        token['email'] = '2235102484@qq.com'
        result = AllowlistedTokenRefreshSerializer().validate({'refresh': str(token)})
        self.assertIn('access', result)
