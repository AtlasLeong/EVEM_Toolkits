from pathlib import Path

from django.conf import settings
from django.core.files.storage import FileSystemStorage
from Community.media import StorageUnavailable


def private_storage():
    """Fail closed; Starsea images never share any public or release directory."""
    try:
        value = getattr(settings, 'STARSEA_UPLOAD_ROOT', None)
        if not value or not Path(value).is_absolute():
            raise ValueError
        configured, root = Path(value), Path(value).resolve()
        forbidden = [getattr(settings, key, None) for key in ('MEDIA_ROOT', 'STATIC_ROOT', 'BASE_DIR')]
        forbidden += [item[1] if isinstance(item, (tuple, list)) else item for item in getattr(settings, 'STATICFILES_DIRS', [])]
        forbidden_paths = [candidate for item in forbidden if item for candidate in (Path(item).absolute(), Path(item).resolve())]
        paths = (configured, root)
        reserved = {'static', 'uploads', 'public', 'dist', 'assets', 'releases', 'current'}
        if (root == Path(root.anchor) or not root.is_dir()
                or any(part.lower() in reserved or part.lower().startswith('.staging-') for path in paths for part in path.parts)
                or any(path.is_relative_to(public) for path in paths for public in forbidden_paths)):
            raise ValueError
        return FileSystemStorage(location=root, base_url=None, file_permissions_mode=0o600, directory_permissions_mode=0o700)
    except (OSError, RuntimeError, TypeError, ValueError) as exc:
        raise StorageUnavailable() from exc
