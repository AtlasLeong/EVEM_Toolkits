"""Loopback-only KM visual preview settings; never used by production."""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'local-killboard-preview-only'
DEBUG = False
ALLOWED_HOSTS = ['127.0.0.1', 'localhost']
USE_TZ = True
ROOT_URLCONF = 'EVE_MDjango.killboard_preview_urls'
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework', 'corsheaders',
    'ActivationCode', 'License', 'Killboard',
]
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / '.killboard-preview.sqlite3'}}
DATABASE_ROUTERS = ['EVE_MDjango.db_routers.LicenseDatabaseRouter']
AUTH_USER_MODEL = 'auth.User'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'
MIDDLEWARE = ['corsheaders.middleware.CorsMiddleware', 'django.middleware.common.CommonMiddleware']
PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']
REST_FRAMEWORK = {'DEFAULT_THROTTLE_RATES': {'killboard_public': '120/hour', 'killboard_private': '120/hour'}}
KILLBOARD_OWNER_EMAIL = '2235102484@qq.com'
KILLBOARD_MIN_ISK_LOST = '20000000000.00'
STATIC_URL = '/static/'
CORS_ALLOW_ALL_ORIGINS = True
