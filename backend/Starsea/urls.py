from django.urls import path

from . import views

urlpatterns = [
    path('posts/', views.Posts.as_view()),
    path('posts/<int:pk>/', views.Detail.as_view()),
    path('posts/<int:pk>/manage/', views.Manage.as_view()),
    path('posts/<int:pk>/draft/', views.Draft.as_view()),
    path('posts/<int:pk>/submit/', views.Transition.as_view(), {'action': 'submit'}),
    path('posts/<int:pk>/withdraw/', views.Transition.as_view(), {'action': 'withdraw'}),
    path('posts/<int:pk>/media/', views.MediaUpload.as_view()),
    path('posts/<int:pk>/visibility/', views.Visibility.as_view()),
    path('media/<int:pk>/', views.Media.as_view()),
    path('mine/', views.Mine.as_view()),
    path('capabilities/', views.Capabilities.as_view()),
    path('reviews/', views.Reviews.as_view()),
    path('reviews/<int:pk>/', views.ReviewDetail.as_view()),
    path('reviews/<int:pk>/decision/', views.Decision.as_view()),
    path('ships/', views.Ships.as_view()),
    path('locations/', views.Locations.as_view()),
    path('corporations/', views.Corporations.as_view()),
]
