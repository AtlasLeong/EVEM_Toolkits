from django.urls import path
from .views import AnomalyHotspotsView
from .private_views import ChangesView

urlpatterns = [path('', AnomalyHotspotsView.as_view(), name='anomaly_hotspots'),
               path('changes/', ChangesView.as_view(), name='anomaly_hotspot_changes')]
