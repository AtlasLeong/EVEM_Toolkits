"""Require an active JWT account outside explicit anonymous API surfaces."""

from django.http import JsonResponse
from rest_framework_simplejwt.authentication import JWTAuthentication

from .viewer_access import LEGACY_UPLOAD_PATH, allows_anonymous_api_request, allows_legacy_upload


class ViewerAccessMiddleware:
    """Keep private and unknown API paths protected in every public-read mode."""

    def __init__(self, get_response):
        self.get_response = get_response
        self.authentication = JWTAuthentication()

    def __call__(self, request):
        if (
            not request.path.startswith('/api/')
            or allows_anonymous_api_request(request.path, request.method)
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
        if not getattr(user, 'is_authenticated', False) or not getattr(user, 'is_active', False):
            return JsonResponse({'detail': '账号不可用。'}, status=403)
        if request.path == LEGACY_UPLOAD_PATH and not allows_legacy_upload(user):
            return JsonResponse({'detail': '当前账号暂无上传权限。'}, status=403)

        return self.get_response(request)
