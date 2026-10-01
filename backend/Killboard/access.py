"""Server-side access policy for the private killboard module."""

from django.conf import settings
from django.contrib.auth import get_user_model
from rest_framework.permissions import BasePermission


def _configured_owner_email():
    # An absent or blank setting deliberately fails closed.  The production
    # account is supplied by deployment configuration, never by the client.
    return str(getattr(settings, 'KILLBOARD_OWNER_EMAIL', '') or '').strip().casefold()


def can_view_killboard(user):
    """Resolve the allowlisted account from the database on every request."""
    if not getattr(user, 'is_authenticated', False):
        return False
    email = _configured_owner_email()
    if not email:
        return False
    owners = list(
        get_user_model().objects.filter(email__iexact=email)
        .values_list('pk', 'is_active')[:2]
    )
    # Duplicate ownership is ambiguous and therefore denied.
    return len(owners) == 1 and bool(owners[0][1]) and owners[0][0] == user.pk


class KillboardOwnerPermission(BasePermission):
    message = '击毁情报暂未向当前账号开放。'

    def has_permission(self, request, view):
        return can_view_killboard(request.user)
