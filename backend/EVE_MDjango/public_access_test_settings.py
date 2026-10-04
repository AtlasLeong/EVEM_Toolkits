"""Isolated API-policy integration tests; never imports production settings/.env."""

from .public_auth_test_settings import *  # noqa: F403

INSTALLED_APPS = [*INSTALLED_APPS, 'StarFieldSearch', 'PlanetaryResource', 'Bazaar', 'FraudList']  # noqa: F405
# These legacy tables are pre-existing and unmanaged. Their MySQL-only historic
# SQL migrations must not run in this disposable SQLite authorization fixture.
MIGRATION_MODULES = {**MIGRATION_MODULES, 'StarFieldSearch': None, 'PlanetaryResource': None, 'Bazaar': None, 'FraudList': None}  # noqa: F405
ROOT_URLCONF = 'EVE_MDjango.public_access_test_urls'
MIDDLEWARE = ['Authentication.middleware.ViewerAccessMiddleware']
REST_FRAMEWORK = {
    **REST_FRAMEWORK,  # noqa: F405
    'DEFAULT_PERMISSION_CLASSES': ['Authentication.permissions.PublicReadOrAuthenticated'],
}
PUBLIC_READ_ACCESS_ENABLED = True
VIEWER_ALLOWLIST_ENABLED = True
VIEWER_PUBLIC_ACCESS_ENABLED = False
VIEWER_EMAIL_ALLOWLIST = ('2235102484@qq.com',)
KILLBOARD_OWNER_EMAIL = '2235102484@qq.com'
