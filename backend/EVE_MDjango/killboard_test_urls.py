from django.urls import include, path


urlpatterns = [path('api/killboard/', include('Killboard.urls'))]
