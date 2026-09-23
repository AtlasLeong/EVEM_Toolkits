"""Loopback-only synthetic demo. Never imports production settings or .env."""
from pathlib import Path
from .ci_settings import *  # noqa: F403

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'local-tactical-demo-not-a-production-secret'
DEBUG = False
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '[::1]', 'testserver']
DATABASES = {'default': {
    'ENGINE': 'EVE_MDjango.tactical_sqlite',
    'NAME': BASE_DIR / '.tactical-local.sqlite3',
    'OPTIONS': {'timeout': 30},
}}
DATABASE_ROUTERS = []
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework',
    'corsheaders', 'TacticalBoard', 'TacticalCollaboration',
]
MIDDLEWARE = ['corsheaders.middleware.CorsMiddleware', 'django.middleware.common.CommonMiddleware']
ROOT_URLCONF = 'EVE_MDjango.tactical_local_urls'
CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:4194', 'http://localhost:4194', 'http://127.0.0.1:4193']
TACTICAL_ALLOWED_ORIGINS = CORS_ALLOWED_ORIGINS
TACTICAL_LOCAL_DEMO = True
TACTICAL_POLL_SECONDS = 1.0
PASSWORD_HASHERS = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
