"""Re-resolve active accounts and the pinned owner from the default database."""
import re
from django.apps import apps
from django.conf import settings
from django.contrib.auth import get_user_model
from django.db import DatabaseError

OWNER_EMAIL = '2235102484@qq.com'
CAPABILITY = 'hotspot_changes.view'
MAX_IDENTIFIER = 9007199254740991


def owner_id():
    value = getattr(settings, 'CONTROL_CENTER_OWNER_ID', None)
    if isinstance(value, str) and re.fullmatch(r'[1-9][0-9]{0,15}', value, flags=re.ASCII):
        value = int(value)
    return value if type(value) is int and 1 <= value <= MAX_IDENTIFIER else None


def current_user(user):
    if not getattr(user, 'is_authenticated', False) or type(getattr(user, 'pk', None)) is not int:
        return None
    return get_user_model().objects.using('default').filter(pk=user.pk, is_active=True).first()


def is_owner(user, *, lock=False):
    identifier = owner_id()
    if (not apps.is_installed('ControlCenter') or identifier is None
            or not getattr(user, 'is_authenticated', False)
            or type(getattr(user, 'pk', None)) is not int or user.pk != identifier):
        return False
    try:
        query = get_user_model().objects.using('default').filter(email__iexact=OWNER_EMAIL).order_by('pk')
        if lock:
            query = query.select_for_update()
        # Inactive matches must also make an ambiguous email fail closed.
        owners = list(query.values_list('pk', 'is_active')[:2])
        return len(owners) == 1 and owners[0] == (identifier, True)
    except DatabaseError:
        return False


def can_view_changes(user):
    if not apps.is_installed('ControlCenter'):
        return False
    try:
        fresh = current_user(user)
        if fresh is None:
            return False
        if is_owner(fresh):
            return True
        Grant = apps.get_model('ControlCenter', 'FeatureGrant')
        return Grant.objects.using('default').filter(user_id=fresh.pk, capability=CAPABILITY, enabled=True).exists()
    except DatabaseError:
        return False
