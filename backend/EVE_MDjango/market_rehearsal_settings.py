"""Opt-in, loopback-only settings for a restored Market migration rehearsal.

This intentionally does not import website settings or read backend/.env. The
account must be separately provisioned with grants limited to the named QA
schema; never use the website or production database user here.
"""

import os
import re


_schema = os.environ.get('EVEM_REHEARSAL_DB_NAME', '')
_user = os.environ.get('EVEM_REHEARSAL_DB_USER', '')
_password = os.environ.get('EVEM_REHEARSAL_DB_PASSWORD', '')
if (os.environ.get('EVEM_REHEARSAL_ENABLE') != '1'
        or not re.fullmatch(r'evem_market_qa_[0-9a-f]{12}', _schema)
        or _user != _schema
        or len(_password) < 24):
    raise RuntimeError('A dedicated, explicitly enabled Market QA database is required')


SECRET_KEY = 'market-rehearsal-only-fixed-key'
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
        'NAME': _schema,
        'USER': _user,
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
