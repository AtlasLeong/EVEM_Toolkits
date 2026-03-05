from django.urls import path
from .views import BazaarInfoView, BazaarNameListView, BazaarDateView, BazaarChartInfo, BazaarBoxView

urlpatterns = [
    path('bazaarinfo', BazaarInfoView.as_view(), name='bazaar_rank_info'),
    path('bazaarnamelist', BazaarNameListView.as_view(), name='bazaar_name_list'),
    path('bazaardate', BazaarDateView.as_view(), name='bazaar_date'),
    path('bazaarchart', BazaarChartInfo.as_view(), name='bazaar_chart'),
    path('bazaarbox', BazaarBoxView.as_view(), name='bazaar_box')
]
