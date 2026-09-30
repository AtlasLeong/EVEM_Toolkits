from django.urls import include, path

urlpatterns = [path('api/killboard/', include('Killboard.urls')), path('api/game-data/', include('GameData.urls'))]
