from django.urls import path
from .views import planet_resource_list, PlanetaryResourceView, PlResourcePriceList, PlanetaryProgrammeView

urlpatterns = [
    path('planetresources', planet_resource_list, name='planet_resources'),                         # 获取行星资源列表路由
    path('searchplanetresource', PlanetaryResourceView.as_view(), name='search_planet_resource'),   # 查询行星资源路由
    path('planetresourceprice', PlResourcePriceList.as_view(), name="planet_resource_price"),       # 行星资源预设价格路由
    path('programme', PlanetaryProgrammeView.as_view(), name='save_programme'),                     # 行星资源方案路由
]
