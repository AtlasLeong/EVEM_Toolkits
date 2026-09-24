"""Isolated License/ActivationCode/Feedback CI settings. NEVER imports production settings/.env.

These tests are not a substitute for a full MySQL application integration suite.
"""
SECRET_KEY = 'isolated-ci-only-not-a-production-secret'
TACTICAL_MULTIBOARD_WRITES_ENABLED = True
DEBUG = False
USE_TZ = True
ALLOWED_HOSTS = ['testserver', 'localhost']
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework',
    'ActivationCode', 'License', 'Feedback', 'TacticalBoard', 'Community', 'TacticalCollaboration', 'Starsea',
    'Market',
]
DATABASES = {alias: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
             for alias in ('default', 'license')}
DATABASE_ROUTERS = ['EVE_MDjango.db_routers.LicenseDatabaseRouter']
MIGRATION_MODULES = {'ActivationCode': None}
AUTH_USER_MODEL = 'auth.User'
ROOT_URLCONF = 'EVE_MDjango.ci_urls'
MIDDLEWARE = []
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
EMAIL_BACKEND = 'django.core.mail.backends.locmem.EmailBackend'
CHANNEL_LAYERS = {
    'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'},
}
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'],
    'DEFAULT_THROTTLE_RATES': {'market_public': '120/hour'},
}
