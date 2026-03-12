from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle


def extract_email(request):
    data = getattr(request, 'data', None)
    if not hasattr(data, 'get'):
        return None

    email = data.get('email')
    if isinstance(email, str):
        email = email.strip()

    return email or None


class DailyThrottle(SimpleRateThrottle):
    # Local development needs a much looser cap, otherwise repeated manual
    # registration testing quickly hits a full-day cooldown.
    rate = '100/day' if settings.DEBUG else '5/day'

    def get_cache_key(self, request, view):
        email = extract_email(request)
        if not email:
            return None
        return f"DailyThrottle:{email.replace('.', '_')}"


class MinuteThrottle(SimpleRateThrottle):
    rate = '10/min' if settings.DEBUG else '1/min'

    def get_cache_key(self, request, view):
        email = extract_email(request)
        if not email:
            return None
        return f"MinuteThrottle:{email.replace('.', '_')}"
