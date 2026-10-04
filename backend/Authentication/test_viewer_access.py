from types import SimpleNamespace
from unittest.mock import Mock

from django.test import RequestFactory, SimpleTestCase, override_settings
from rest_framework.request import Request

from Authentication.access import is_viewer_allowed
from Authentication.middleware import ViewerAccessMiddleware
from Authentication.permissions import IsAllowlistedViewer, PublicReadOrAuthenticated
from Authentication.viewer_access import allows_anonymous_api_request, is_public_read_request


# Fixed audit examples exercise each route shape independently of the registry.
PUBLIC_GET_EXAMPLES = (
    '/api/bazaarinfo', '/api/bazaarnamelist', '/api/bazaarbox',
    '/api/community/corporations/', '/api/community/corporations/12/',
    '/api/community/corporations/12/media/34/',
    '/api/game-data/items/', '/api/game-data/items/12/', '/api/game-data/status/',
    '/api/market/categories/', '/api/market/items/', '/api/market/items/12/series/',
    '/api/market/items/12/history/',
    '/api/planetresources', '/api/planetresourceprice/default', '/api/regions', '/api/constellations', '/api/solarsystem',
    '/api/starsea/posts/', '/api/starsea/posts/12/', '/api/starsea/media/34/',
    '/api/starsea/ships/', '/api/starsea/locations/', '/api/starsea/corporations/',
    '/api/boardsystems', '/api/boardconstellations', '/api/boardstargate', '/api/boardregions',
)
PUBLIC_QUERY_EXAMPLES = ('/api/bazaardate', '/api/bazaarchart', '/api/fraudsearch', '/api/searchplanetresource', '/api/jumppath')
PRIVATE_EXAMPLES = (
    '/api/planetresourceprice', '/api/programme', '/api/killboard/access/',
    '/api/killboard/reports/', '/api/killboard/reports/12/', '/api/killboard/collector/logs/',
    '/api/tactical/usage/overview/', '/api/tactical/organizations/',
    '/api/tactical/organizations/12/boards/34/map/',
    '/api/market/admin/items/', '/api/community/mine/',
    '/api/community/corporations/12/manage/', '/api/community/media/34/private/',
    '/api/starsea/mine/', '/api/starsea/posts/12/manage/', '/api/starsea/reviews/',
    '/api/feedback/', '/api/uploadimage/', '/api/fraudadminlist',
    '/api/activationcode/generate-code/', '/api/license/codes/',
    '/api/new-api/', '/api/market/unknown/',
)


class PublicReadPolicyTests(SimpleTestCase):
    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_all_audited_get_routes_allow_get_and_head_but_not_business_writes(self):
        self.assertEqual(len(PUBLIC_GET_EXAMPLES), 28)
        for path in PUBLIC_GET_EXAMPLES:
            for method in ('GET', 'HEAD'):
                with self.subTest(path=path, method=method):
                    self.assertTrue(is_public_read_request(path, method))
                    self.assertTrue(allows_anonymous_api_request(path, method))
            for method in ('POST', 'PUT', 'PATCH', 'DELETE', 'TRACE'):
                with self.subTest(path=path, method=method):
                    self.assertFalse(allows_anonymous_api_request(path, method))

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_only_the_five_read_only_query_post_handlers_are_public(self):
        self.assertEqual(len(PUBLIC_QUERY_EXAMPLES), 5)
        for path in PUBLIC_QUERY_EXAMPLES:
            self.assertTrue(allows_anonymous_api_request(path, 'POST'))
            for method in ('GET', 'HEAD', 'PUT', 'PATCH', 'DELETE'):
                with self.subTest(path=path, method=method):
                    self.assertFalse(allows_anonymous_api_request(path, method))

    def test_credentials_health_and_machine_validation_keep_explicit_methods_in_closed_mode(self):
        with override_settings(PUBLIC_READ_ACCESS_ENABLED=False):
            for path in ('/api/user/login', '/api/user/register', '/api/user/emailcode',
                         '/api/user/signupcheck', '/api/user/forgetemailcheck', '/api/user/forgetPassword',
                         '/api/user/token/refresh', '/api/activationcode/validate-code/', '/api/license/validate-code/'):
                self.assertTrue(allows_anonymous_api_request(path, 'POST'))
                self.assertFalse(allows_anonymous_api_request(path, 'GET'))
                self.assertFalse(allows_anonymous_api_request(path, 'PATCH'))
            for path in ('/api/deploy-version/', '/api/community/ready/'):
                self.assertTrue(allows_anonymous_api_request(path, 'GET'))
                self.assertTrue(allows_anonymous_api_request(path, 'HEAD'))
                self.assertFalse(allows_anonymous_api_request(path, 'POST'))

    def test_closed_mode_requires_login_and_legacy_switches_cannot_reopen_it(self):
        for legacy_allowlist, legacy_public in ((True, False), (False, True), (False, False), (True, True)):
            with override_settings(PUBLIC_READ_ACCESS_ENABLED=False, VIEWER_ALLOWLIST_ENABLED=legacy_allowlist,
                                   VIEWER_PUBLIC_ACCESS_ENABLED=legacy_public):
                for path in PUBLIC_GET_EXAMPLES:
                    self.assertFalse(allows_anonymous_api_request(path, 'GET'))
                for path in PUBLIC_QUERY_EXAMPLES:
                    self.assertFalse(allows_anonymous_api_request(path, 'POST'))

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_route_matching_is_exact_ascii_not_private_siblings_or_prefixes(self):
        for path in ('/api/market/items/12/series/admin/', '/api/market/items/12/',
                     '/api/market/items/１２/series/', '/api/market/items/12/series',
                     '/api/starsea/posts/12/draft/', '/api/starsea/posts/12//',
                     '/api/starsea/media/12/private/', '/api/community/corporations/12/media/',
                     '/api/community/corporations/12/media/34/private/',
                     '/api/regions/', '/api/bazaarinfo/anything', '/api/bazaarchart/extra'):
            for method in ('GET', 'POST'):
                with self.subTest(path=path, method=method):
                    self.assertFalse(allows_anonymous_api_request(path, method))

    def test_private_and_unknown_paths_require_jwt_in_every_switch_combination(self):
        for public_reads in (False, True):
            for legacy_allowlist, legacy_public in ((True, False), (False, True)):
                with override_settings(PUBLIC_READ_ACCESS_ENABLED=public_reads, VIEWER_ALLOWLIST_ENABLED=legacy_allowlist,
                                       VIEWER_PUBLIC_ACCESS_ENABLED=legacy_public):
                    middleware = ViewerAccessMiddleware(lambda request: 'handler')
                    middleware.authentication = Mock()
                    middleware.authentication.authenticate.return_value = None
                    for path in PRIVATE_EXAMPLES:
                        for method in ('GET', 'POST', 'PATCH', 'DELETE'):
                            request = RequestFactory().generic(method, path)
                            response = middleware(request)
                            self.assertEqual(response.status_code, 401, (path, method, public_reads))
                            self.assertEqual(response['WWW-Authenticate'], 'Bearer')

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_public_reads_and_preflight_do_not_run_authentication(self):
        middleware = ViewerAccessMiddleware(lambda request: 'next')
        middleware.authentication = Mock()
        for method, path in [('GET', PUBLIC_GET_EXAMPLES[0]), ('POST', PUBLIC_QUERY_EXAMPLES[0]), ('OPTIONS', '/api/tactical/organizations/')]:
            self.assertEqual(middleware(RequestFactory().generic(method, path)), 'next')
        middleware.authentication.authenticate.assert_not_called()

    def test_ordinary_active_account_passes_gate_but_inactive_or_missing_identity_does_not(self):
        middleware = ViewerAccessMiddleware(lambda request: 'next')
        middleware.authentication = Mock()
        request = RequestFactory().get('/api/tactical/organizations/')
        ordinary = SimpleNamespace(is_authenticated=True, is_active=True, email='ordinary@example.com')
        middleware.authentication.authenticate.return_value = (ordinary, object())
        self.assertEqual(middleware(request), 'next')
        for authenticated, active in ((True, False), (False, True)):
            middleware.authentication.authenticate.return_value = (SimpleNamespace(is_authenticated=authenticated, is_active=active), object())
            self.assertEqual(middleware(request).status_code, 403)
        middleware.authentication.authenticate.side_effect = ValueError('malformed token')
        self.assertEqual(middleware(request).status_code, 401)

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_default_and_compatibility_permissions_limit_anonymous_access_by_method(self):
        for permission in (PublicReadOrAuthenticated(), IsAllowlistedViewer()):
            self.assertTrue(permission.has_permission(Request(RequestFactory().get('/api/market/items/')), None))
            self.assertFalse(permission.has_permission(Request(RequestFactory().post('/api/market/items/')), None))
            self.assertFalse(permission.has_permission(Request(RequestFactory().get('/api/unknown/')), None))
            request = Request(RequestFactory().get('/api/unknown/'))
            request.user = SimpleNamespace(is_authenticated=True, is_active=True, email='ordinary@example.com')
            self.assertTrue(permission.has_permission(request, None))
            request.user.is_active = False
            self.assertFalse(permission.has_permission(request, None))

    def test_legacy_upload_requires_actual_allowlisted_active_identity_in_every_mode(self):
        middleware = ViewerAccessMiddleware(lambda request: 'next')
        middleware.authentication = Mock()
        request = RequestFactory().post('/api/uploadimage/')
        for public_reads in (False, True):
            with override_settings(PUBLIC_READ_ACCESS_ENABLED=public_reads, VIEWER_PUBLIC_ACCESS_ENABLED=True,
                                   VIEWER_ALLOWLIST_ENABLED=False, VIEWER_EMAIL_ALLOWLIST=['legacy@example.com']):
                for email, active, allowed in (('ordinary@example.com', True, False), (' LEGACY@EXAMPLE.COM ', True, True),
                                               ('legacy@example.com', False, False), ('', True, False)):
                    middleware.authentication.authenticate.return_value = (SimpleNamespace(is_authenticated=True, is_active=active, email=email), object())
                    response = middleware(request)
                    self.assertEqual(response if allowed else response.status_code, 'next' if allowed else 403)
        with override_settings(VIEWER_EMAIL_ALLOWLIST=[]):
            middleware.authentication.authenticate.return_value = (SimpleNamespace(is_authenticated=True, is_active=True, email='legacy@example.com'), object())
            self.assertEqual(middleware(request).status_code, 403)

    def test_retired_email_helper_is_not_an_api_authorization_rule(self):
        with override_settings(VIEWER_ALLOWLIST_ENABLED=True, VIEWER_PUBLIC_ACCESS_ENABLED=False, VIEWER_EMAIL_ALLOWLIST=[]):
            self.assertTrue(is_viewer_allowed('ordinary@example.com'))
            self.assertFalse(allows_anonymous_api_request('/api/killboard/reports/', 'GET'))
