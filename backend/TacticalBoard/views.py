import datetime
import time

from django.shortcuts import render
from django.core.cache import cache
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import BoardSystems, BoardStargates, BoardConstellations, BoardRegions
from .serializers import (BoardSystemSerializers, BoardStarGateSerializers, BoardConstellationsSerializers,
                          BoardRegionSerializers)
from rest_framework import status
from django.http import JsonResponse, HttpResponse
import gzip
import json
from decimal import Decimal
from .A_Star import distance, a_star, get_neighbors, Galaxy, get_move_type_and_cost
from django.db.models.functions import Cast
from django.db.models import CharField
from django.db.models import F, FloatField
from django.db.models.functions import Round


def coerce_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return bool(value)


class GetBoardRegionCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardRegions.objects.exclude(zh_name__isnull=True)
        serializer = BoardRegionSerializers(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class GetBoardSystemCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardSystems.objects.exclude(system_id__contains='3100').exclude(
            system_id__contains='3200').exclude(system_id__contains='3400')
        serializer = BoardSystemSerializers(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class GetBoardConstellationsCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardConstellations.objects.exclude(constellation_id__contains='2100').exclude(
            constellation_id__contains='2200').exclude(constellation_id__contains='2400')
        serializer = BoardConstellationsSerializers(queryset, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)


class GetStarGateData(APIView):
    @staticmethod
    def get(request):
        # 尝试从缓存获取
        cache_key = 'stargate_data'
        cached_data = cache.get(cache_key)

        if cached_data:
            return HttpResponse(cached_data, content_type='application/json', headers={
                'Content-Encoding': 'gzip',
                'Content-Length': str(len(cached_data))
            })

        queryset = BoardStargates.objects.values('stargate_id', 'system_id', 'destination_system_id',
                                                 'destination_stargate_id')

        x = time.time()

        data = [
            {
                'stargate_id': item['stargate_id'],
                'system_id': item['system_id'],
                'destination_system_id': item['destination_system_id'],
                'destination_stargate_id': item['destination_stargate_id'],
            }
            for item in queryset
        ]

        response_data = json.dumps(data)
        compressed_data = gzip.compress(response_data.encode('utf-8'))

        # 缓存1小时
        cache.set(cache_key, compressed_data, 3600)

        response = HttpResponse(compressed_data, content_type='application/json')
        response['Content-Encoding'] = 'gzip'
        response['Content-Length'] = str(len(compressed_data))
        return response


class AStarLocation(APIView):
    @staticmethod
    def post(request):
        start_system = request.data.get('start_system')
        end_system = request.data.get('end_system')
        max_distance = float(request.data.get('max_distance'))
        dict_road = coerce_bool(request.data.get("dict_road", False))
        in_high_security = coerce_bool(request.data.get("inHighSecurity", False))

        if isCrossNew8System(start_system,end_system):
            return Response({"error": "无法跨越新八星域进行诱导"}, status=status.HTTP_404_NOT_FOUND)
        # 获取星门数据
        stargates = BoardStargates.objects.values('stargate_id', 'system_id', 'destination_system_id',
                                                  'destination_stargate_id')
        stargate_connections = {}
        for gate in stargates:
            if gate['system_id'] not in stargate_connections:
                stargate_connections[gate['system_id']] = set()
            stargate_connections[gate['system_id']].add(gate['destination_system_id'])
            # 添加反向连接
            if gate['destination_system_id'] not in stargate_connections:
                stargate_connections[gate['destination_system_id']] = set()
            stargate_connections[gate['destination_system_id']].add(gate['system_id'])

        if in_high_security:
            queryset = BoardSystems.objects.exclude(system_id__contains='3100').exclude(
                system_id__contains='3200').exclude(system_id__contains='3400') \
                .values('system_id', 'zh_name', 'x', 'y', 'z', 'security_status')
        else:
            queryset = (BoardSystems.objects.exclude(system_id__contains='3100').exclude(
                system_id__contains='3200').exclude(system_id__contains='3400')
                        .annotate(rounded_security=Round(F('security_status'), 1))
                        .filter(rounded_security__lt=0.5)
                        .values('system_id', 'zh_name', 'x', 'y', 'z', 'security_status'))

        galaxies = [Galaxy(system['system_id'], system['zh_name'], system['x'], system['y'], system['z'],
                           system['security_status']) for system in queryset]

        start = next((g for g in galaxies if g.zh_name == start_system), None)
        goal = next((g for g in galaxies if g.zh_name == end_system), None)

        if start is None or goal is None:
            return Response({"error": "起始或目标星系未找到"}, status=400)

        path = a_star(start, goal, max_distance, galaxies, dict_road, stargate_connections)

        if path:

            result = []
            for i in range(len(path) - 1):
                current_galaxy, current_move_type = path[i]
                next_galaxy, next_move_type = path[i + 1]

                segment = {
                    "start": {
                        "system_id": current_galaxy.system_id,
                        "zh_name": current_galaxy.zh_name,
                        "move_type": next_move_type,  # 使用下一步的移动类型
                    },
                    "end": {
                        "system_id": next_galaxy.system_id,
                        "zh_name": next_galaxy.zh_name,
                        "move_type": next_move_type,
                    },
                    "distance": round(distance(current_galaxy, next_galaxy), 2)
                }
                result.append(segment)

            return Response(result, status=status.HTTP_200_OK)
        else:
            return Response({"error": "未找到路径"}, status=status.HTTP_404_NOT_FOUND)


def isCrossNew8System(start_system, end_system):
    new8Regions = [10000027, 10000018, 10000013, 10000021, 10000053, 10000034, 10000040, 10000066]
    new8Constellations = set(BoardConstellations.objects.filter(region__in=new8Regions).values_list('constellation_id', flat=True))

    start_constellation = BoardSystems.objects.filter(zh_name=start_system).values_list('constellation_id', flat=True).first()
    end_constellation = BoardSystems.objects.filter(zh_name=end_system).values_list('constellation_id', flat=True).first()

    if start_constellation is None or end_constellation is None:
        return False  # 如果找不到星座，返回False

    # 检查是否两个星座都在新8区域内，或者都不在
    start_in_new8 = start_constellation in new8Constellations
    end_in_new8 = end_constellation in new8Constellations

    if start_in_new8 != end_in_new8:
        return start_in_new8 != end_in_new8  # 如果一个在内一个在外，则返回True
    elif not start_in_new8 and not end_in_new8:
        return False

    start_region = BoardConstellations.objects.filter(constellation_id=start_constellation).values_list('region_id', flat=True).first()
    end_region = BoardConstellations.objects.filter(constellation_id=end_constellation).values_list('region_id',flat=True).first()

    if start_region == end_region:
        return False
    else:
        return True
