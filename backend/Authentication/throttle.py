from hashlib import sha256
from ipaddress import ip_address

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


def extract_email(request, field='email'):
    data = getattr(request, 'data', None)
    if not hasattr(data, 'get'):
        return None

    email = data.get(field)
    if not isinstance(email, str):
        return None
    return email.strip().casefold() or None


class DailyThrottle(SimpleRateThrottle):
    # Local development needs a much looser cap, otherwise repeated manual
    # registration testing quickly hits a full-day cooldown.
    rate = '100/day' if settings.DEBUG else '5/day'

    def get_cache_key(self, request, view):
        email = extract_email(request)
        if not email:
            return None
        return f"DailyThrottle:{sha256(email.encode('utf-8', errors='replace')).hexdigest()}"


class MinuteThrottle(SimpleRateThrottle):
    rate = '10/min' if settings.DEBUG else '1/min'

    def get_cache_key(self, request, view):
        email = extract_email(request)
        if not email:
            return None
        return f"MinuteThrottle:{sha256(email.encode('utf-8', errors='replace')).hexdigest()}"


class AuthIPThrottle(SimpleRateThrottle):
    """Only trust the transport peer; proxy headers cannot reset the budget.

    A reverse proxy may share this budget. Until its live header contract is
    verified, account limits provide the tighter password/code protection.
    """

    def get_cache_key(self, request, view):
        remote = str(request.META.get('REMOTE_ADDR') or '')
        try:
            peer = ip_address(remote)
        except ValueError:
            return self.cache_format % {'scope': self.scope, 'ident': remote or 'unknown'}
        return self.cache_format % {'scope': self.scope, 'ident': peer.compressed}


class AuthAccountThrottle(SimpleRateThrottle):
    email_field = 'email'

    def get_cache_key(self, request, view):
        email = extract_email(request, self.email_field)
        if not email:
            return None
        ident = sha256(email.encode('utf-8', errors='replace')).hexdigest()
        return self.cache_format % {'scope': self.scope, 'ident': ident}


class VerificationIPHourThrottle(AuthIPThrottle):
    scope = 'auth_code_ip_hour'
    rate = '60/hour'


class VerificationIPDayThrottle(AuthIPThrottle):
    scope = 'auth_code_ip_day'
    rate = '200/day'


class AuthPrecheckThrottle(AuthIPThrottle):
    scope = 'auth_precheck_ip'
    rate = '300/min'


class LoginIPThrottle(AuthIPThrottle):
    scope = 'auth_login_ip'
    rate = '60/min'


class LoginAccountThrottle(AuthAccountThrottle):
    scope = 'auth_login_account'
    email_field = 'login_email'
    rate = '10/min'


class RegistrationIPThrottle(AuthIPThrottle):
    scope = 'auth_register_ip'
    rate = '30/min'


class RegistrationAccountThrottle(AuthAccountThrottle):
    scope = 'auth_register_account'
    rate = '5/min'


class PasswordResetIPThrottle(AuthIPThrottle):
    scope = 'auth_reset_ip'
    rate = '30/min'


class PasswordResetAccountThrottle(AuthAccountThrottle):
    scope = 'auth_reset_account'
    email_field = 'forgetEmail'
    rate = '5/min'


class TokenRefreshIPThrottle(AuthIPThrottle):
    scope = 'auth_refresh_ip'
    rate = '120/min'
