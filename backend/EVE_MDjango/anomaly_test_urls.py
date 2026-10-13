from django.urls import path, include

urlpatterns = [path('api/anomaly-hotspots/', include('AnomalyHotspots.urls'))]
