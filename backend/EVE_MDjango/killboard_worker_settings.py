"""Least-privilege collector ORM: no web .env, accounts, HTTP or file logs."""
import os


def required(name):
    value = os.environ.get('KILLBOARD_DB_' + name)
    if not value:
        raise RuntimeError('KILLBOARD_DB_' + name + ' must be set')
    return value


_port = required('PORT')
if not _port.isdecimal() or not 1 <= int(_port) <= 65535:
    raise RuntimeError('KILLBOARD_DB_PORT must be a valid TCP port')
SECRET_KEY = 'killboard-worker-no-http'
DEBUG = False
ALLOWED_HOSTS = []
INSTALLED_APPS = ['django.contrib.contenttypes', 'Killboard']
MIDDLEWARE = []
ROOT_URLCONF = None
DATABASE_ROUTERS = []
DATABASES = {'default': {
    'ENGINE': 'django.db.backends.mysql', 'NAME': required('NAME'), 'USER': required('USER'),
    'PASSWORD': required('PASSWORD'), 'HOST': required('HOST'), 'PORT': _port,
    'CONN_MAX_AGE': 0, 'OPTIONS': {'charset': 'utf8mb4'},
}}
CACHES = {'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}}
TIME_ZONE = 'Asia/Shanghai'
USE_TZ = False
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
LOGGING = {'version': 1, 'disable_existing_loggers': False,
           'handlers': {'console': {'class': 'logging.StreamHandler'}},
           'root': {'handlers': ['console'], 'level': 'WARNING'}}
