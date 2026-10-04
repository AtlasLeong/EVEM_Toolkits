from rest_framework.permissions import BasePermission
from .viewer_access import LEGACY_UPLOAD_PATH, allows_anonymous_api_request, allows_legacy_upload


class PublicReadOrAuthenticated(BasePermission):
    """Default API permission; resource-specific permissions stay additive."""

    message = '请先登录。'

    def has_permission(self, request, view):
        if allows_anonymous_api_request(request.path, request.method):
            return True
        user = getattr(request, 'user', None)
        if request.path == LEGACY_UPLOAD_PATH:
            return allows_legacy_upload(user)
        return bool(user and user.is_authenticated and getattr(user, 'is_active', False))


class IsAllowlistedViewer(PublicReadOrAuthenticated):
    """Compatibility name for the market's explicit public-read permission."""
