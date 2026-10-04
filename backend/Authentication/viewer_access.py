"""Explicit anonymous API surfaces; everything else requires authentication.

These rules identify read-only handlers, not namespaces. Query POST exceptions
only read stored public data or calculate a route; they do not grant write access.
Private object, owner, staff, and organization checks remain in their views.
"""

import re

from django.conf import settings


PUBLIC_READ_GET_PATHS = frozenset({
    '/api/bazaarinfo', '/api/bazaarnamelist', '/api/bazaarbox',
    '/api/community/corporations/',
    '/api/game-data/items/', '/api/game-data/status/',
    '/api/market/categories/', '/api/market/items/', '/api/market/quality/',
    '/api/planetresources', '/api/planetresourceprice/default', '/api/regions', '/api/constellations', '/api/solarsystem',
    '/api/starsea/posts/', '/api/starsea/ships/', '/api/starsea/locations/',
    '/api/starsea/corporations/',
    '/api/boardsystems', '/api/boardconstellations', '/api/boardstargate', '/api/boardregions',
})
PUBLIC_READ_GET_PATTERNS = tuple(re.compile(pattern) for pattern in (
    r'/api/community/corporations/[0-9]+/',
    r'/api/community/corporations/[0-9]+/media/[0-9]+/',
    r'/api/game-data/items/[0-9]+/',
    r'/api/market/items/[0-9]+/series/',
    r'/api/market/items/[0-9]+/history/',
    r'/api/starsea/posts/[0-9]+/',
    r'/api/starsea/media/[0-9]+/',
))
PUBLIC_QUERY_POST_PATHS = frozenset({
    '/api/bazaardate', '/api/bazaarchart', '/api/fraudsearch',
    '/api/searchplanetresource', '/api/jumppath',
})
PUBLIC_CREDENTIAL_POST_PATHS = frozenset({
    '/api/user/login', '/api/user/register', '/api/user/emailcode',
    '/api/user/signupcheck', '/api/user/forgetemailcheck', '/api/user/forgetPassword',
    '/api/user/token/refresh',
    # Script clients still need their activation/license code and machine checks.
    '/api/activationcode/validate-code/', '/api/license/validate-code/',
})
PUBLIC_HEALTH_GET_PATHS = frozenset({'/api/deploy-version/', '/api/community/ready/'})
LEGACY_UPLOAD_PATH = '/api/uploadimage/'


def allows_legacy_upload(user):
    """Keep the legacy raw upload restricted until its media safety is reviewed."""
    if not user or not getattr(user, 'is_authenticated', False) or not getattr(user, 'is_active', False):
        return False
    email = str(getattr(user, 'email', '') or '').strip().casefold()
    allowed = {str(value).strip().casefold() for value in getattr(settings, 'VIEWER_EMAIL_ALLOWLIST', ())}
    return bool(email) and email in allowed


def is_public_read_request(path, method):
    """Match audited public GET/HEAD routes and five query POST routes."""
    if method in {'GET', 'HEAD'}:
        return path in PUBLIC_READ_GET_PATHS or any(pattern.fullmatch(path) for pattern in PUBLIC_READ_GET_PATTERNS)
    return method == 'POST' and path in PUBLIC_QUERY_POST_PATHS


def allows_anonymous_api_request(path, method):
    """The new read switch never changes credential or private access checks."""
    if method == 'OPTIONS':
        return True
    if method == 'POST' and path in PUBLIC_CREDENTIAL_POST_PATHS:
        return True
    if method in {'GET', 'HEAD'} and path in PUBLIC_HEALTH_GET_PATHS:
        return True
    return bool(getattr(settings, 'PUBLIC_READ_ACCESS_ENABLED', True)) and is_public_read_request(path, method)
