from django.urls import path
from . import views
from . import usage

urlpatterns = [
    path('usage/access/', usage.UsageAccess.as_view()),
    path('usage/overview/', usage.UsageOverview.as_view()),
    path('organizations/', views.Organizations.as_view()),
    path('join/', views.Join.as_view()),
    path('organizations/<int:organization_id>/members/', views.Members.as_view()),
    path('organizations/<int:organization_id>/boards/', views.Boards.as_view()),
    path('organizations/<int:organization_id>/boards/<int:board_id>/map/', views.BoardMap.as_view()),
    path('organizations/<int:organization_id>/boards/<int:board_id>/pirate/', views.Pirate.as_view()),
    path('organizations/<int:organization_id>/boards/<int:board_id>/pirate/commands/', views.PirateCommands.as_view()),
    path('organizations/<int:organization_id>/commands/', views.Commands.as_view()),
    path('organizations/<int:organization_id>/presence/', views.Presence.as_view()),
    path('organizations/<int:organization_id>/snapshot/', views.Snapshot.as_view()),
    path('organizations/<int:organization_id>/map/', views.Map.as_view()),
    path('organizations/<int:organization_id>/catalog/', views.Catalog.as_view()),
]
