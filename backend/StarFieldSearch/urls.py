from django.urls import path
from .views import SearchRegionList, ConstellationList, SolarSystemList

urlpatterns = [
    # 将 SearchRegionList 视图函数绑定到 /region/ URL
    path('regions', SearchRegionList.as_view(), name='SearchRegionList'),               # 星域列表路由
    path('constellations', ConstellationList.as_view(), name='constellation_list'),     # 星系列表路由
    path('solarsystem', SolarSystemList.as_view(), name='SearchSolarSystemList')        # 星座列表路由
]
