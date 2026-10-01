"""Isolated viewer-access policy tests; no production environment or database."""
from .ci_settings import *  # noqa: F403

INSTALLED_APPS = [*INSTALLED_APPS, 'Authentication']  # noqa: F405
AUTH_USER_MODEL = 'Authentication.EVEMUser'
