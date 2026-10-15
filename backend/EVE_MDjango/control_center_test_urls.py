from django.urls import include, path

urlpatterns = [path('api/anomaly-hotspots/', include('AnomalyHotspots.urls')),
               path('api/control-center/', include('ControlCenter.urls'))]
