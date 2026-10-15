from django.urls import path
from .views import AccessView, AuditView, GrantsView, GrantView, OverviewView, UsersView

urlpatterns = [path('access/', AccessView.as_view()), path('users/', UsersView.as_view()),
               path('grants/', GrantsView.as_view()), path('grants/<int:user_id>/', GrantView.as_view()),
               path('audit/', AuditView.as_view()), path('overview/', OverviewView.as_view())]
