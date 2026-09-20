"""Generic read-only readiness; this module is the release capability marker."""
from django.http import JsonResponse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_safe

from .models import Corporation, MediaAsset
from .preflight import check_service_storage_access, check_storage_configuration


@never_cache
@require_safe
def readiness(request):
    try:
        root = check_storage_configuration()
        check_service_storage_access(root)
        # Bounded indexed existence queries; no counts, joins, files or writes.
        Corporation.objects.exists()
        MediaAsset.objects.exists()
    except Exception:
        # No paths, credentials, SQL, exception messages or individual gate results.
        return JsonResponse({'status': 'unavailable'}, status=503)
    return JsonResponse({'status': 'ok'})
