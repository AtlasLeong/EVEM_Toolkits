from django.urls import path

from .views import FiltersView, ReportDetailView, ReportsView, StatusView


urlpatterns = [
    path('reports/', ReportsView.as_view(), name='killboard-reports'),
    path('reports/<int:kill_id>/', ReportDetailView.as_view(), name='killboard-report-detail'),
    path('filters/', FiltersView.as_view(), name='killboard-filters'),
    path('status/', StatusView.as_view(), name='killboard-status'),
]
