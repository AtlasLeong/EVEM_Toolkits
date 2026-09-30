import hashlib

from django.http import Http404, HttpResponseNotModified
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from . import registry


def version_parameter(request):
    version = request.query_params.get('version')
    if version is not None and not registry.REVISION.fullmatch(version):
        raise ValidationError({'version': 'Use an imported revision hash.'})
    return version


def request_snapshot(version):
    try:
        return registry.catalog_snapshot(version)
    except KeyError:
        raise Http404


def cached_response(request, payload, revision, *, immutable=False):
    token = hashlib.sha256(f'{revision}:{request.get_full_path()}'.encode()).hexdigest()
    etag = f'"{token}"'
    response = HttpResponseNotModified() if request.headers.get('If-None-Match') == etag else Response(payload)
    response['ETag'] = etag
    response['Cache-Control'] = 'public, max-age=31536000, immutable' if immutable else 'public, max-age=60'
    return response


class CatalogThrottle(SimpleRateThrottle):
    scope = 'game_data_public'
    rate = '240/hour'

    def get_cache_key(self, request, view):
        return self.cache_format % {'scope': self.scope, 'ident': self.get_ident(request)}


class PublicCatalogView(APIView):
    authentication_classes = []
    permission_classes = []
    throttle_classes = [CatalogThrottle]

    def handle_exception(self, exc):
        if isinstance(exc, registry.CatalogUnavailable):
            response = Response({'detail': 'Shared game data temporarily unavailable.'}, status=503)
            response['Cache-Control'] = 'no-store'
            return response
        return super().handle_exception(exc)


class ItemsView(PublicCatalogView):
    def get(self, request):
        version = version_parameter(request)
        try:
            page = int(request.query_params.get('page', '1'))
            size = int(request.query_params.get('page_size', '50'))
        except (TypeError, ValueError):
            raise ValidationError({'page': 'Use integer page/page_size.'})
        if not 1 <= page <= 10000 or not 1 <= size <= 100:
            raise ValidationError({'page_size': 'Use page 1–10000 and page_size 1–100.'})
        query = request.query_params.get('q', '').strip()
        kind = request.query_params.get('kind', '')
        if len(query) > 100 or kind not in ('', 'ships'):
            raise ValidationError({'q': 'Use up to 100 characters and optional kind=ships.'})
        raw_ids = request.query_params.get('ids')
        ids = raw_ids.split(',') if raw_ids is not None else None
        if ids is not None and (len(ids) > 100 or any(not registry.item_key(key) for key in ids)):
            raise ValidationError({'ids': 'Use 1–100 positive item IDs separated by commas.'})
        revision, catalog = request_snapshot(version)
        count, rows = registry.find_items(ids=ids, query=query, kind=kind, page=page, page_size=size, catalog=catalog)
        return cached_response(request, {'count': count, 'results': rows, 'revision': revision}, revision, immutable=bool(version))


class ItemView(PublicCatalogView):
    def get(self, request, item_id):
        version = version_parameter(request)
        revision, catalog = request_snapshot(version)
        row = registry.item_payload(item_id, catalog=catalog)
        if row is None:
            raise Http404
        return cached_response(request, row, revision, immutable=bool(version))


class StatusView(PublicCatalogView):
    def get(self, request):
        status = registry.catalog_status()
        if not status.get('revision'):
            raise registry.CatalogUnavailable('Shared game catalog temporarily unavailable')
        return cached_response(request, status, status['revision'])
