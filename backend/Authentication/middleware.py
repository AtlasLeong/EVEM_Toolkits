"""Fail-closed viewer gate for API data routes."""

from django.conf import settings
from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication

from .access import is_viewer_allowed


_PUBLIC_API_PATHS = frozenset({
    '/api/deploy-version/',
    '/api/community/ready/',
    '/api/user/login',
    '/api/user/register',
    '/api/user/emailcode',
    '/api/user/signupcheck',
    '/api/user/forgetemailcheck',
    '/api/user/forgetPassword',
    '/api/user/token/refresh',
})


class ViewerAccessMiddleware:
    """Require an allowlisted JWT for every API route carrying app data."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.authentication = JWTAuthentication()

    def __call__(self, request):
        if (
            not getattr(settings, 'VIEWER_ALLOWLIST_ENABLED', False)
            or request.method == 'OPTIONS'
            or not request.path.startswith('/api/')
            or request.path in _PUBLIC_API_PATHS
        ):
            return self.get_response(request)

        try:
            authenticated = self.authentication.authenticate(request)
        except Exception:
            authenticated = None

        if authenticated is None:
            return JsonResponse(
                {'detail': 'Authentication credentials were not provided.'},
                status=401,
                headers={'WWW-Authenticate': 'Bearer'},
            )

        user, _token = authenticated
        if not getattr(user, 'is_authenticated', False) or not is_viewer_allowed(getattr(user, 'email', '')):
            return JsonResponse({'detail': '当前账号暂无查看权限。'}, status=403)

        return self.get_response(request)
