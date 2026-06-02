from .settings import *  # noqa: F401,F403


DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    },
    'license': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': ':memory:',
    },
}

PASSWORD_HASHERS = ['django.contrib.auth.hashers.MD5PasswordHasher']

INSTALLED_APPS = [
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'rest_framework',
    'ActivationCode',
    'License',
]

AUTH_USER_MODEL = 'auth.User'
ROOT_URLCONF = 'License.urls'

MIGRATION_MODULES = {
    'ActivationCode': None,
}
