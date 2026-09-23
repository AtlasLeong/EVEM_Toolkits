"""Read-only storage gates. Never create, chmod, enumerate or write user files."""
import os
from pathlib import Path

from django.conf import settings


class PreflightError(RuntimeError):
    """Intentionally generic: safe for HTTP and shared deployment logs."""


def check_storage_configuration(forbidden_roots=()):
    configured = getattr(settings, 'COMMUNITY_UPLOAD_ROOT', None)
    if not configured or not Path(configured).is_absolute():
        raise PreflightError('Community storage configuration is unavailable.')
    configured = Path(configured)
    root = configured.resolve()
    forbidden = list(forbidden_roots)
    forbidden.extend(getattr(settings, key, None) for key in ('MEDIA_ROOT', 'STATIC_ROOT', 'BASE_DIR'))
    for value in getattr(settings, 'STATICFILES_DIRS', []):
        forbidden.append(value[1] if isinstance(value, (tuple, list)) else value)
    reserved = {'static', 'uploads', 'public', 'dist', 'assets', 'releases', 'current'}
    # Reject both the configured spelling and its resolved target. A path through
    # current/releases is not persistent even when today's symlink points safely
    # outside that tree. Unrelated private aliases remain valid.
    paths = (configured, root)
    forbidden_paths = [candidate for value in forbidden if value
                       for candidate in (Path(value).absolute(), Path(value).resolve())]
    if (root == Path(root.anchor) or not root.is_dir()
            or any(part.lower() in reserved or part.lower().startswith('.staging-')
                   for path in paths for part in path.parts)
            or any(path.is_relative_to(forbidden) for path in paths for forbidden in forbidden_paths)):
        raise PreflightError('Community storage configuration is unavailable.')
    return root


def check_service_storage_access(root):
    """Check the running service identity, not the deployment user's permissions.

    This is advisory POSIX/ACL access checking, not a write probe: it cannot prove
    SELinux policy, filesystem capacity or a later write will succeed.
    """
    # Linux access() defaults to real UID; use effective UID where supported.
    effective = {'effective_ids': True} if os.access in os.supports_effective_ids else {}
    if (not os.access(root, os.R_OK | os.W_OK | os.X_OK, **effective)
            or any(not os.access(parent, os.X_OK, **effective) for parent in root.parents)):
        raise PreflightError('Community storage access is unavailable.')
