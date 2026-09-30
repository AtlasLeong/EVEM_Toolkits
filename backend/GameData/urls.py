from django.urls import path
from .views import ItemsView, ItemView, StatusView

urlpatterns = [
    path('items/', ItemsView.as_view()),
    path('items/<int:item_id>/', ItemView.as_view()),
    path('status/', StatusView.as_view()),
]
