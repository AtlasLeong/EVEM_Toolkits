from django.urls import path
from .views import AnomalyHotspotsView

urlpatterns = [path('', AnomalyHotspotsView.as_view(), name='anomaly_hotspots')]
