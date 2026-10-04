"""Isolated legacy fraud ACL regressions; never load production settings or tables."""
from .public_auth_test_settings import *  # noqa: F403

INSTALLED_APPS = [*INSTALLED_APPS, 'FraudList']  # noqa: F405
