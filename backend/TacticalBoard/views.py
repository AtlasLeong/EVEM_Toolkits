import math

from django.core.cache import cache
from django.conf import settings
from rest_framework.response import Response
from rest_framework.views import APIView
from .models import BoardSystems, BoardStargates, BoardConstellations, BoardRegions
from rest_framework import status
from django.http import HttpResponse
import gzip
import json
from .A_Star import distance
from .routing_data import SnapshotUnavailable, get_route_snapshot
from .scope import public_board_filter_kwargs, stargate_cache_key


def coerce_bool(value):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"true", "1", "yes", "on"}
    return bool(value)


def _board_cache_key(name):
    scope = "local" if getattr(settings, "TACTICAL_LOCAL_DEMO", False) else "production"
    return f"board:{name}:{scope}:v1"


def _cached_board_response(cache_name, queryset, fields):
    data = cache.get(cache_name)
    if data is None:
        # The board tables are static map data. Returning dictionaries avoids
        # model construction and serializer work on every map load.
        data = list(queryset.values(*fields))
        cache.set(cache_name, data, 3600)
    return Response(data, status=status.HTTP_200_OK)


class GetBoardRegionCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardRegions.objects.filter(**public_board_filter_kwargs("region_id")).exclude(
            zh_name__isnull=True
        )
        return _cached_board_response(
            _board_cache_key("regions"), queryset, ("region_id", "zh_name")
        )


class GetBoardSystemCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardSystems.objects.filter(**public_board_filter_kwargs("system_id")).exclude(
            system_id__contains='3100').exclude(
            system_id__contains='3200').exclude(system_id__contains='3400')
        return _cached_board_response(
            _board_cache_key("systems"),
            queryset,
            ("system_id", "zh_name", "security_status", "x", "y", "z"),
        )


class GetBoardConstellationsCoordinates(APIView):
    @staticmethod
    def get(request):
        queryset = BoardConstellations.objects.filter(**public_board_filter_kwargs("constellation_id")).exclude(
            constellation_id__contains='2100').exclude(
            constellation_id__contains='2200').exclude(constellation_id__contains='2400')
        return _cached_board_response(
            _board_cache_key("constellations"),
            queryset,
            ("constellation_id", "zh_name", "region_id", "x", "y", "z"),
        )


class GetStarGateData(APIView):
    @staticmethod
    def get(request):
        # 尝试从缓存获取
        cache_key = stargate_cache_key()
        cached_data = cache.get(cache_key)

        if cached_data is not None:
            return HttpResponse(cached_data, content_type='application/json', headers={
                'Content-Encoding': 'gzip',
                'Content-Length': str(len(cached_data))
            })

        queryset = BoardStargates.objects.filter(**public_board_filter_kwargs("stargate_id")).values(
            'stargate_id', 'system_id', 'destination_system_id', 'destination_stargate_id'
        )

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
        if not isinstance(start_system, str) or not isinstance(end_system, str):
            return Response({"error": "起始或目标星系必须是文本"}, status=status.HTTP_400_BAD_REQUEST)
        try:
            max_distance = float(request.data.get('max_distance'))
        except (TypeError, ValueError):
            return Response({"error": "最大跳跃距离必须是正数"}, status=status.HTTP_400_BAD_REQUEST)
        if not math.isfinite(max_distance) or max_distance <= 0:
            return Response({"error": "最大跳跃距离必须是正数"}, status=status.HTTP_400_BAD_REQUEST)
        dict_road = coerce_bool(request.data.get("dict_road", False))
        in_high_security = coerce_bool(request.data.get("inHighSecurity", False))

        try:
            snapshot = get_route_snapshot(in_high_security)
        except SnapshotUnavailable:
            return Response({"error": "星图数据暂时不可用，请稍后重试"}, status=status.HTTP_503_SERVICE_UNAVAILABLE)

        if isCrossNew8System(start_system, end_system, snapshot=snapshot):
            return Response({"error": "无法跨越新八星域进行诱导"}, status=status.HTTP_404_NOT_FOUND)

        start = snapshot.systems_by_name.get(start_system)
        goal = snapshot.systems_by_name.get(end_system)

        if start is None or goal is None:
            return Response({"error": "起始或目标星系未找到"}, status=status.HTTP_400_BAD_REQUEST)

        path = snapshot.graph.find_route(start, goal, max_distance, allow_dirt=dict_road)

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


def isCrossNew8System(start_system, end_system, snapshot=None):
    if not isinstance(start_system, str) or not isinstance(end_system, str):
        return False
    if snapshot is None:
        snapshot = get_route_snapshot(True)
    return snapshot.crosses_new8(start_system, end_system)
