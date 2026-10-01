from django.urls import path

from .views import CollectorLogsView, FiltersView, KillboardAccessView, ReportDetailView, ReportsView, StatusView


urlpatterns = [
    path('access/', KillboardAccessView.as_view(), name='killboard-access'),
    path('reports/', ReportsView.as_view(), name='killboard-reports'),
    path('reports/<int:kill_id>/', ReportDetailView.as_view(), name='killboard-report-detail'),
    path('filters/', FiltersView.as_view(), name='killboard-filters'),
    path('status/', StatusView.as_view(), name='killboard-status'),
    path('collector/logs/', CollectorLogsView.as_view(), name='killboard-collector-logs'),
]
