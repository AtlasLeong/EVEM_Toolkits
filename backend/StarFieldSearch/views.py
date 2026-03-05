import requests
from django.shortcuts import render
from .models import Region, Constellation, Solarsystem
from rest_framework import generics
from .serializers import RegionSerializer, ConstellationSerializer, SolarSystemSerializer


# 返回所有星域列表
class SearchRegionList(generics.ListAPIView):
    queryset = Region.objects.all()
    serializer_class = RegionSerializer


# 接收 星域列表数组 返回数组中包含的所有星系
class ConstellationList(generics.ListAPIView):
    serializer_class = ConstellationSerializer

    def get_queryset(self):
        regionID = self.request.query_params.get("regionID")
        regionIDList = regionID.split(",")
        queryset = Constellation.objects.filter(co_region__in=regionIDList)
        return queryset


# 接收 星系列表数组 返回数组中包含的所有星座
class SolarSystemList(generics.ListAPIView):
    serializer_class = SolarSystemSerializer

    def get_queryset(self):
        constellationID = self.request.query_params.get("constellationID")
        constellationIDList = constellationID.split(",")
        queryset = Solarsystem.objects.filter(ss_constellation__in=constellationIDList)
        return queryset
