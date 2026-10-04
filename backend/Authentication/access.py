"""Compatibility account-eligibility helper, not an authentication permission."""


def is_viewer_allowed(email):
    """Retire the general email gate without granting API or socket access.

    Ordinary accounts may use the product. Callers must still authenticate an
    active database user and enforce their owner, staff, or membership checks.
    The legacy viewer flags do not override those checks or the public API list.
    """
    return True
