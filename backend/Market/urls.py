from django.urls import path

from . import views


urlpatterns = [
    path('categories/', views.PublicCategoriesView.as_view(), name='market-categories'),
    path('items/', views.PublicItemsView.as_view(), name='market-items'),
    path('items/<int:item_id>/series/', views.PublicSeriesView.as_view(), name='market-item-series'),
    path('items/<int:item_id>/history/', views.PublicHistoryView.as_view(), name='market-item-history'),
    path('admin/config/', views.AdminConfigView.as_view(), name='market-admin-config'),
    path('admin/items/', views.AdminItemsView.as_view(), name='market-admin-items'),
    path('admin/items/<int:item_id>/', views.AdminItemDetailView.as_view(), name='market-admin-item-detail'),
    path('admin/runs/', views.AdminRunsView.as_view(), name='market-admin-runs'),
    path('admin/run/', views.AdminRunView.as_view(), name='market-admin-run'),
]
