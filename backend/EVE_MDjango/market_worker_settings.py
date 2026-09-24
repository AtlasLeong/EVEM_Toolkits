"""Isolated ORM settings for the short-lived market collector process.

The website settings module reads backend/.env and configures unrelated
services. Never import it from this worker-only module.
Provision MARKET_DB_USER with DML grants limited to Market tables; do not run
schema migrations under this settings module.
"""

import os


def required_environment(name):
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f'{name} must be set in the worker process environment.')
    return value


_database_name = required_environment('MARKET_DB_NAME')
_database_user = required_environment('MARKET_DB_USER')
_database_password = required_environment('MARKET_DB_PASSWORD')
_database_host = required_environment('MARKET_DB_HOST')
_port = required_environment('MARKET_DB_PORT')
if not _port.isdecimal() or not 1 <= int(_port) <= 65535:
    raise RuntimeError('MARKET_DB_PORT must be a valid TCP port.')

SECRET_KEY = 'market-worker-only-no-http-fixed-key'
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
        'NAME': _database_name,
        'USER': _database_user,
        'PASSWORD': _database_password,
        'HOST': _database_host,
        'PORT': _port,
        'CONN_MAX_AGE': 0,
        'OPTIONS': {'charset': 'utf8mb4'},
    },
}
DATABASE_ROUTERS = []
TIME_ZONE = 'Asia/Shanghai'
USE_TZ = False
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
