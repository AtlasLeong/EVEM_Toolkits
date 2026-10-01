from rest_framework.permissions import BasePermission
from django.conf import settings

from .access import is_viewer_allowed


class IsAllowlistedViewer(BasePermission):
    message = '当前账号暂无查看权限。'

    def has_permission(self, request, view):
        if not getattr(settings, 'VIEWER_ALLOWLIST_ENABLED', False):
            return True
        user = getattr(request, 'user', None)
        return bool(user and user.is_authenticated and is_viewer_allowed(getattr(user, 'email', '')))
