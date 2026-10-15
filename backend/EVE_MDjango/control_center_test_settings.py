"""Disposable account/permission tests; no production environment is loaded."""
from datetime import timedelta
from django.db.backends.signals import connection_created

SECRET_KEY = 'control-center-isolated-test-secret-never-production'
DEBUG = False
ALLOWED_HOSTS = ['testserver', 'localhost']
USE_TZ = True
TIME_ZONE = 'Asia/Shanghai'
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework',
                  'Authentication', 'StarFieldSearch', 'AnomalyHotspots', 'ControlCenter']
AUTH_USER_MODEL = 'Authentication.EVEMUser'
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
MIGRATION_MODULES = {'StarFieldSearch': None}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
ROOT_URLCONF = 'EVE_MDjango.control_center_test_urls'
MIDDLEWARE = ['Authentication.middleware.ViewerAccessMiddleware']
PUBLIC_READ_ACCESS_ENABLED = True
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': ['rest_framework_simplejwt.authentication.JWTAuthentication'],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_THROTTLE_RATES': {'anomaly_hotspots': '120/hour', 'control_center': '600/hour',
                              'control_center_access': '360/hour', 'anomaly_changes': '360/hour'},
}
SIMPLE_JWT = {'ACCESS_TOKEN_LIFETIME': timedelta(minutes=10), 'USER_ID_FIELD': 'id',
              'USER_ID_CLAIM': 'user_id'}
ANOMALY_SNAPSHOT_FILE = ''
ANOMALY_HISTORY_DIR = ''
CONTROL_CENTER_OWNER_ID = ''
KILLBOARD_OWNER_EMAIL = ''
KILLBOARD_COLLECTION_ENABLED = False
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
SILENCED_SYSTEM_CHECKS = ['fields.W163', 'models.W046']


def sqlite_auth_collation(sender, connection, **kwargs):
    if connection.vendor == 'sqlite':
        connection.connection.create_collation('utf8mb4_bin', lambda a, b: (a > b) - (a < b))


connection_created.connect(sqlite_auth_collation, dispatch_uid='control-center.sqlite-collation', weak=False)
