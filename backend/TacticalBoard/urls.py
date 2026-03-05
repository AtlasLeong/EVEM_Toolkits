from django.urls import path
from .views import (GetBoardSystemCoordinates, GetStarGateData, GetBoardConstellationsCoordinates, AStarLocation,
                    GetBoardRegionCoordinates)

urlpatterns = [
    path('boardsystems', GetBoardSystemCoordinates.as_view(), name='board_systems'),
    path('boardconstellations', GetBoardConstellationsCoordinates.as_view(), name='board_constellations'),
    path('boardstargate', GetStarGateData.as_view(), name='board_stargate'),
    path('jumppath', AStarLocation.as_view(), name='jump_path'),
    path('boardregions', GetBoardRegionCoordinates.as_view(), name='board_regions')
]
