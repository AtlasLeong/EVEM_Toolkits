from django.urls import path
from . import views

urlpatterns = [
    path('corporations/', views.CorporationList.as_view()),
    path('corporations/<int:pk>/', views.CorporationDetail.as_view()),
    path('corporations/<int:pk>/manage/', views.Manage.as_view()),
    path('corporations/<int:pk>/draft/', views.Draft.as_view()),
    path('corporations/<int:pk>/media/', views.MediaUpload.as_view()),
    path('corporations/<int:pk>/media/<int:asset_id>/', views.PublicMedia.as_view()),
    path('corporations/<int:pk>/visibility/', views.Visibility.as_view()),
    path('capabilities/', views.Capabilities.as_view()),
    path('mine/', views.Mine.as_view()),
    path('claims/', views.Claims.as_view()),
    path('claims/<int:pk>/', views.ClaimDetail.as_view()),
    path('revisions/<int:pk>/', views.RevisionEdit.as_view()),
    path('revisions/<int:pk>/submit/', views.RevisionTransition.as_view(), {'action': 'submit'}),
    path('revisions/<int:pk>/withdraw/', views.RevisionTransition.as_view(), {'action': 'withdraw'}),
    path('media/<int:pk>/private/', views.PrivateMedia.as_view()),
    path('reviews/', views.Reviews.as_view()),
    path('reviews/<str:kind>/<int:pk>/', views.ReviewDetail.as_view()),
    path('reviews/<str:kind>/<int:pk>/decision/', views.Decision.as_view()),
]
