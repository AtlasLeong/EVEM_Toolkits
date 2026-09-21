from django.urls import path
from . import views

urlpatterns = [
    path('organizations/', views.Organizations.as_view()),
    path('join/', views.Join.as_view()),
    path('organizations/<int:organization_id>/members/', views.Members.as_view()),
    path('organizations/<int:organization_id>/commands/', views.Commands.as_view()),
    path('organizations/<int:organization_id>/presence/', views.Presence.as_view()),
    path('organizations/<int:organization_id>/snapshot/', views.Snapshot.as_view()),
    path('organizations/<int:organization_id>/map/', views.Map.as_view()),
    path('organizations/<int:organization_id>/catalog/', views.Catalog.as_view()),
]
