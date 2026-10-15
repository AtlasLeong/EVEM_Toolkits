"""No web environment, database, account ORM or HTTP in the anomaly worker."""
import os

SECRET_KEY = 'anomaly-worker-no-http'
DEBUG = False
ALLOWED_HOSTS = []
INSTALLED_APPS = ['AnomalyHotspots']
MIDDLEWARE = []
ROOT_URLCONF = None
DATABASES = {'default': {'ENGINE': 'django.db.backends.dummy'}}
DATABASE_ROUTERS = []
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}
ANOMALY_SNAPSHOT_FILE = os.environ.get('ANOMALY_SNAPSHOT_FILE', '')
ANOMALY_HISTORY_DIR = os.environ.get('ANOMALY_HISTORY_DIR', '')
TIME_ZONE = 'Asia/Shanghai'
USE_TZ = True
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LOGGING = {'version': 1, 'disable_existing_loggers': False,
           'handlers': {'console': {'class': 'logging.StreamHandler'}},
           'root': {'handlers': ['console'], 'level': 'WARNING'}}
