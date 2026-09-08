"""Public commit marker only; loaded once so old workers cannot report new code."""
from pathlib import Path
import re

from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe


def read_version(path):
    try:
        value = Path(path).read_text(encoding='ascii').strip()
    except FileNotFoundError:
        return 'development'
    except (OSError, UnicodeError):
        return 'invalid'
    return value if re.fullmatch(r'[0-9a-f]{40}', value) else 'invalid'


VERSION = read_version(Path(__file__).resolve().parent.parent / '.release-sha')


@never_cache
@require_safe
def deployment_version(request):
    return JsonResponse({'sha': VERSION})
