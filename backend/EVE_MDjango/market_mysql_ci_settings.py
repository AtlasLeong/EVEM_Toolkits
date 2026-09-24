"""Single-schema MySQL settings for the disposable GitHub Actions Market job.

This module never imports website settings or reads backend/.env. It is not a
production configuration and cannot be pointed at a different database host or
schema through environment variables.
"""

import os


if os.environ.get('MARKET_CI_MYSQL') != '1':
    raise RuntimeError('Market MySQL CI must be explicitly enabled.')

_password = os.environ.get('MARKET_CI_DB_PASSWORD')
if not _password:
    raise RuntimeError('Market MySQL CI database password is required.')

SECRET_KEY = 'market-mysql-ci-only-fixed-key'
DEBUG = False
ALLOWED_HOSTS = []
INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'Authentication',
    'Market',
]
AUTH_USER_MODEL = 'Authentication.EVEMUser'
MIDDLEWARE = []
ROOT_URLCONF = None
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': 'market_ci',
        'USER': 'market_ci',
        'PASSWORD': _password,
        'HOST': '127.0.0.1',
        'PORT': '3306',
        'CONN_MAX_AGE': 0,
        'OPTIONS': {'charset': 'utf8mb4'},
    },
}
DATABASE_ROUTERS = []
TIME_ZONE = 'Asia/Shanghai'
USE_TZ = False
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
