"""Isolated anomaly tests; never import deployment .env or game sessions."""
SECRET_KEY = 'anomaly-isolated-tests-only'
DEBUG = False
ALLOWED_HOSTS = ['testserver', 'localhost']
USE_TZ = True
INSTALLED_APPS = ['django.contrib.auth', 'django.contrib.contenttypes',
                  'rest_framework', 'StarFieldSearch', 'AnomalyHotspots']
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}}
MIGRATION_MODULES = {'StarFieldSearch': None}
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
ROOT_URLCONF = 'EVE_MDjango.anomaly_test_urls'
MIDDLEWARE = []
PUBLIC_READ_ACCESS_ENABLED = True
REST_FRAMEWORK = {'DEFAULT_THROTTLE_RATES': {'anomaly_hotspots': '120/hour'}}
ANOMALY_SNAPSHOT_FILE = ''
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}
# Unmanaged production geography includes MySQL-only display comments.
SILENCED_SYSTEM_CHECKS = ['fields.W163', 'models.W046']
