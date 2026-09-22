"""Isolated loopback preview; deliberately does not load production settings."""
from pathlib import Path
from .ci_settings import *  # noqa: F403

BASE_DIR = Path(__file__).resolve().parent.parent
SECRET_KEY = 'starsea-local-preview-only-never-production'
DEBUG = False
ALLOWED_HOSTS = ['127.0.0.1', 'localhost', '[::1]', 'testserver']
INSTALLED_APPS = [
    'django.contrib.auth', 'django.contrib.contenttypes', 'rest_framework',
    'corsheaders', 'Community', 'TacticalBoard', 'Starsea',
]
DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3',
                       'NAME': BASE_DIR / '.starsea-local.sqlite3', 'OPTIONS': {'timeout': 30}}}
DATABASE_ROUTERS = []
MIGRATION_MODULES = {}
ROOT_URLCONF = 'EVE_MDjango.starsea_local_urls'
MIDDLEWARE = ['corsheaders.middleware.CorsMiddleware', 'django.middleware.common.CommonMiddleware']
CORS_ALLOWED_ORIGINS = ['http://127.0.0.1:4195', 'http://localhost:4195', 'http://127.0.0.1:4196']
STARSEA_LOCAL_DEMO = True
PASSWORD_HASHERS = ['django.contrib.auth.hashers.PBKDF2PasswordHasher']
# Locate the already archived source outside worktrees without downloading it.
_archive_rel = Path('.local-data/eve-echoes/sweet/218811-c47d33925de2d61c/echoes.db')
_archive = next((parent / _archive_rel for parent in BASE_DIR.parents if (parent / _archive_rel).is_file()), None)
STARSEA_SHIP_DB = str(_archive) if _archive else ''
_private_base = _archive.parents[3] if _archive else BASE_DIR.parent.parent
STARSEA_UPLOAD_ROOT = _private_base / 'starsea-preview' / BASE_DIR.parent.name / 'images'
COMMUNITY_UPLOAD_ROOT = STARSEA_UPLOAD_ROOT
DATA_UPLOAD_MAX_MEMORY_SIZE = 6 * 1024 * 1024
FILE_UPLOAD_MAX_MEMORY_SIZE = 1024 * 1024
