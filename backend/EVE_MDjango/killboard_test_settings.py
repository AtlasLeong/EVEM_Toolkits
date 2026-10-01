"""Isolated SQLite settings for Killboard model/parser tests.

This module intentionally does not import the production settings or read any
environment variables. Run the focused model suite with::

    python manage.py test Killboard.tests.test_models --settings=EVE_MDjango.killboard_test_settings -v 2
"""

SECRET_KEY = 'killboard-isolated-test-only'
DEBUG = False
USE_TZ = True
ALLOWED_HOSTS = ['testserver', 'localhost']

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'rest_framework',
    'ActivationCode',
    'License',
    'Killboard',
]

DATABASES = {
    alias: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
    for alias in ('default', 'license')
}

DATABASE_ROUTERS = ['EVE_MDjango.db_routers.LicenseDatabaseRouter']
AUTH_USER_MODEL = 'auth.User'
ROOT_URLCONF = 'EVE_MDjango.killboard_test_urls'
MIDDLEWARE = []
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
MIGRATION_MODULES = {'ActivationCode': None}
REST_FRAMEWORK = {
    'DEFAULT_THROTTLE_RATES': {'killboard_public': '120/hour', 'killboard_private': '120/hour'},
}
KILLBOARD_OWNER_EMAIL = 'owner@example.com'
KILLBOARD_MIN_ISK_LOST = '20000000000.00'

