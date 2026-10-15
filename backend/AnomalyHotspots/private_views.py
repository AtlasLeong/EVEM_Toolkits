"""Authorized stored history only; neither HTTP reads nor grants trigger RPC."""
from django.apps import apps
from django.conf import settings
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from ControlCenter.http import PrivateView, integer, query_values
from . import history
from .views import system_metadata


class ChangesView(PrivateView):
    throttle_scope = 'anomaly_changes'
    def check_permissions(self, request):
        super().check_permissions(request)
        # App-independent import keeps the original isolated public tests and
        # database-free worker settings free of ControlCenter model imports.
        if not apps.is_installed('ControlCenter'):
            raise PermissionDenied('当前账号暂无变化榜权限。')
        from ControlCenter.access import can_view_changes
        if not can_view_changes(request.user):
            raise PermissionDenied('当前账号暂无变化榜权限。')

    def get(self, request):
        query = query_values(request, ('interval', 'before', 'limit'))
        options = {key: integer(query[key], minimum=1 if key == 'limit' else 0,
                               maximum=100 if key == 'limit' else 9007199254740991) for key in query}
        try:
            value = history.read_changes(getattr(settings, 'ANOMALY_HISTORY_DIR', ''), **options)
        except history.HistoryError:
            return Response({'detail': '所选历史区间不可用。' if 'interval' in options else '历史数据暂不可用。'},
                            status=404 if 'interval' in options else 503)
        if 'interval' in options and value['interval'] is None:
            return Response({'detail': '所选历史区间不可用。'}, status=404)
        metadata = system_metadata(value['systems'])
        unknown = {'system_name': None, 'region_id': None, 'region_name': None}
        value['systems'] = [{**row, **metadata.get(row['solar_system_id'], unknown)} for row in value['systems']]
        return Response(value)
