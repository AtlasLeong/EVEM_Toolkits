from .models import Region, Constellation, Solarsystem
from rest_framework import generics
from .serializers import RegionSerializer, ConstellationSerializer, SolarSystemSerializer
from rest_framework.exceptions import ValidationError
from PlanetaryResource.query_limits import bounded_rows, location_ids, RESULT_LIMIT


def csv_ids(params, name):
    values = params.getlist(name)
    if len(values) != 1 or not values[0] or len(values[0]) > 2000:
        raise ValidationError({'error': '请选择有效的地点，每次最多 100 项，请缩小查询条件。'})
    return location_ids(values[0].split(','))


# 返回所有星域列表
class SearchRegionList(generics.ListAPIView):
    queryset = Region.objects.all()
    serializer_class = RegionSerializer


# 接收 星域列表数组 返回数组中包含的所有星系
class ConstellationList(generics.ListAPIView):
    serializer_class = ConstellationSerializer

    def get_queryset(self):
        region_ids = csv_ids(self.request.query_params, 'regionID')
        queryset = Constellation.objects.filter(co_region__in=region_ids).order_by('pk')
        return bounded_rows(queryset, RESULT_LIMIT)


# 接收 星系列表数组 返回数组中包含的所有星座
class SolarSystemList(generics.ListAPIView):
    serializer_class = SolarSystemSerializer

    def get_queryset(self):
        constellation_ids = csv_ids(self.request.query_params, 'constellationID')
        queryset = Solarsystem.objects.filter(ss_constellation__in=constellation_ids).order_by('pk')
        return bounded_rows(queryset, RESULT_LIMIT)
