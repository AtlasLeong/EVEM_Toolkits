"""Real account/outbox tests in isolated SQLite; never load production settings."""
from datetime import timedelta

from django.db.backends.signals import connection_created

from .viewer_access_test_settings import *  # noqa: F403

ROOT_URLCONF = 'Authentication.test_public_auth'
REST_FRAMEWORK = {**REST_FRAMEWORK, 'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated']}  # noqa: F405
VIEWER_ALLOWLIST_ENABLED = True
VIEWER_EMAIL_ALLOWLIST = ('previously-authorized@example.com',)
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=10),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=20),
    'ROTATE_REFRESH_TOKENS': False,
    'BLACKLIST_AFTER_ROTATION': True,
    'USER_ID_FIELD': 'id',
    'USER_ID_CLAIM': 'user_id',
}


def sqlite_auth_collation(sender, connection, **kwargs):
    if connection.vendor == 'sqlite':
        connection.connection.create_collation('utf8mb4_bin', lambda left, right: (left > right) - (left < right))


connection_created.connect(sqlite_auth_collation, dispatch_uid='public-auth-test.sqlite-collation', weak=False)
