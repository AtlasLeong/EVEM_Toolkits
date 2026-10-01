"""Viewer access policy shared by authentication and protected read APIs."""

from django.conf import settings


def _normalise_email(email):
    return str(email or '').strip().casefold()


def is_viewer_allowed(email):
    """Return whether an account may view the currently gated product.

    Production is fail-closed when the allowlist switch is enabled. To open
    the product later, set ``VIEWER_PUBLIC_ACCESS_ENABLED=true`` explicitly.
    """
    if not getattr(settings, 'VIEWER_ALLOWLIST_ENABLED', False):
        return True
    allowed = {
        _normalise_email(value)
        for value in getattr(settings, 'VIEWER_EMAIL_ALLOWLIST', ())
        if _normalise_email(value)
    }
    return bool(allowed) and _normalise_email(email) in allowed
