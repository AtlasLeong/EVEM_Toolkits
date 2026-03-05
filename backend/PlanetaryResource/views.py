from .PlanetResourcesList import getPlanetResourcesList
from .planetDBmap import RESOURCE_FIELD_MAP
from .serializers import PlanetResourcePriceSerializer, PlanetaryProgrammeSerializer, PlanetaryProgrammeListSerializer

from django.conf import settings
from django.contrib.staticfiles.storage import staticfiles_storage
from django.db.models import Max, F, OuterRef, Subquery
from django.http import JsonResponse
from django.shortcuts import get_object_or_404
from django.shortcuts import render
from django.utils.timezone import now

from rest_framework import generics
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

import hashlib
import json
from .models import (PlanetResource, Region, Constellation, Solarsystem, PlResourcePrice, PreSearchPlanetary,
                     PlanetaryProgramme, UserPrePrice)


class PlResourcePriceList(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        queryset = UserPrePrice.objects.filter(user_id=user_id)
        reset_option = request.GET.get("resetPrice")

        if queryset.exists() and reset_option != 'default':
            pre_price_data = queryset.first().pre_price_element
            return Response(pre_price_data)
        else:
            queryset = PlResourcePrice.objects.all()
            serializer = PlanetResourcePriceSerializer(queryset, many=True)

            return Response(serializer.data)

    @staticmethod
    def post(request):
        user_id = request.user.id
        user_name = request.user.username
        pre_price_element = request.data.get('prePriceElement')

        if isinstance(pre_price_element, str):
            try:
                pre_price_element = json.loads(pre_price_element)
            except json.JSONDecodeError:
                return JsonResponse({'error': 'Invalid JSON format'}, status=400)

        UserPrePrice.objects.update_or_create(
            user_id=user_id,
            defaults={
                'user_name': user_name,
                'pre_price_element': pre_price_element,
                'last_update': now()
            }
        )
        return Response({'message': 'Price data saved for user: {}'.format(user_name)}, status=200)


def planet_resource_list(request):
    base_url = request.build_absolute_uri(settings.STATIC_URL)   # 获取静态文件的绝对URL
    data = getPlanetResourcesList(base_url)                      # 获取行星资源列表

    return JsonResponse(data, safe=False)


class PlanetaryResourceView(APIView):
    def post(self, request, *args, **kwargs):
        data = request.data
        # 从请求数据中提取地点和资源信息
        region_value = data.get('regionValue')
        constellation_value = data.get('constellationValue', None)
        solar_system_value = data.get('systemValue', None)
        planetary_resources = data.get('planetaryResources', [])

        queryset = PlanetResource.objects.select_related('p_region', 'p_constellation', 'p_solarsystem')

        # 处理地点不为空的情况
        if region_value or constellation_value or solar_system_value:
            if solar_system_value:
                queryset = queryset.filter(p_solarsystem_id__in=solar_system_value)
            elif constellation_value:
                queryset = queryset.filter(p_constellation_id__in=constellation_value)
            elif region_value:
                queryset = queryset.filter(p_region_id__in=region_value)

            if region_value and not planetary_resources:
                results = self.get_region_top3_resources(region_value, request)

            elif not planetary_resources:  # 如果行星资源为空，查询该地点下所有种类行星资源前三的地点
                results = self.get_top_resources_by_location(queryset, request)
            else:  # 行星资源、地点都不为空：正常按地点查询行星资源
                results = self.get_resources_by_location_and_type(queryset, planetary_resources)
        else:  # 行星资源不为空、地点为空：显示每个星域中该行星资源产出最高的地点
            if planetary_resources:
                results = self.get_top_resources_by_type_across_regions(planetary_resources)
            else:
                results = []

        return Response(results)

    # 根据地点和资源类型获取资源信息
    def get_resources_by_location_and_type(self, queryset, planetary_resources):
        results = []

        for resource in queryset:
            for res in planetary_resources:
                resource_name = res.get('value')
                field_info = RESOURCE_FIELD_MAP.get(resource_name, {})
                resource_level_field = field_info.get('level')
                resource_yield_field = field_info.get('cnt')
                if resource_level_field and resource_yield_field:
                    resource_level = getattr(resource, resource_level_field, None)
                    resource_yield = getattr(resource, resource_yield_field, None)
                    if resource_level is not None and resource_yield is not None:
                        result = self.format_resource_result(resource, resource_name, res['icon'],
                                                             resource_level, resource_yield)

                        results.append(result)
                        break
        return results

    def get_top_resources_by_type_across_regions(self, planetary_resources):
        # 显示每个星域中该行星资源产出最高的地点
        results = []
        # 子查询获取每个 region_id 中给定 resource_name 的最大 resource_yield
        for res in planetary_resources:
            subquery = PreSearchPlanetary.objects.filter(
                resource_name=res['value'],
                region_ps_name=OuterRef('region_ps_name')
            ).values('region_ps_name').annotate(
                max_yield=Max('resource_yield')
            ).values('max_yield')
            # 主查询，选择与子查询结果匹配的记录
            max_yield_records = PreSearchPlanetary.objects.filter(
                resource_name=res['value'],
                resource_yield=Subquery(subquery)
            ).values(
                'region_ps_name', 'region_security',
                'constellation_ps_name', 'constellation_security',
                'solar_system_ps_name', 'solar_system_security',
                'planet_id', 'resource_level', 'resource_yield', 'resource_name'
            )

            for record in max_yield_records:
                result = self.format_pre_search_result(record, res['icon'])
                results.append(result)

        return results

    def get_region_top3_resources(self, regionIDList, request):
        results = []
        # 查询该地点下所有种类行星资源前三的地点
        base_url = request.build_absolute_uri(settings.STATIC_URL)
        resources_list = getPlanetResourcesList(base_url)
        icon_lookup = {}
        for category in resources_list:
            for option in category["options"]:
                icon_lookup[option["value"]] = option["icon"]
        records = PreSearchPlanetary.objects.filter(region__in=regionIDList).values('region_ps_name', 'region_security',
                                                                                    'constellation_ps_name',
                                                                                    'constellation_security',
                                                                                    'solar_system_ps_name',
                                                                                    'solar_system_security',
                                                                                    'planet_id', 'resource_level',
                                                                                    'resource_yield', 'resource_name')

        for record in records:
            result = self.format_pre_search_result(record, icon_lookup[record['resource_name']])
            results.append(result)
        return results

    def get_top_resources_by_location(self, queryset, request):
        base_url = request.build_absolute_uri(settings.STATIC_URL)
        resources_list = getPlanetResourcesList(base_url)
        icon_lookup = {}
        for category in resources_list:
            for option in category["options"]:
                icon_lookup[option["value"]] = option["icon"]

        results = []
        # 批量查询所有资源，避免N+1问题
        all_resources = queryset.select_related('p_region', 'p_constellation', 'p_solarsystem')

        for field, info in RESOURCE_FIELD_MAP.items():
            resource_level_field = info.get('level')
            resource_yield_field = info.get('cnt')

            # 使用已加载的queryset，只排序和切片
            top_resources = sorted(
                all_resources,
                key=lambda x: getattr(x, resource_yield_field) or 0,
                reverse=True
            )[:3]

            icon_url = icon_lookup[field]
            for resource in top_resources:
                resource_yield = getattr(resource, resource_yield_field)
                if resource_yield is not None:
                    result = self.format_resource_result(
                        resource, field, icon_url,
                        getattr(resource, resource_level_field),
                        resource_yield
                    )
                    results.append(result)
        return results

    # 格式化预搜索结果
    @staticmethod
    def format_pre_search_result(record, icon):
        unique_key = hashlib.md5(
            f"{record['region_ps_name']}-{record['constellation_ps_name']}-{record['solar_system_ps_name']}-"
            f"{record['planet_id']}-{record['resource_name']}-{record['resource_yield']}"
            .encode()).hexdigest()
        return {
            'key': unique_key,
            'region': record['region_ps_name'],
            'region_security': record['region_security'],
            'constellation': record['constellation_ps_name'],
            'constellation_security': record['constellation_security'],
            'solar_system': record['solar_system_ps_name'],
            'solar_system_security': record['solar_system_security'],
            'planet_id': record['planet_id'],
            'resource_level': record['resource_level'],
            'resource_yield': record['resource_yield'],
            'resource_name': record['resource_name'],
            'icon': icon,
        }

    # 格式化资源结果
    @staticmethod
    def format_resource_result(resource, resource_name, icon, resource_level, resource_yield):
        unique_key = hashlib.md5(f"{resource.p_region.r_title}-{resource.p_constellation.co_title}-"
                                 f"{resource.p_solarsystem.ss_title}-{resource.p_title}-"
                                 f"{resource_name}-{resource_yield}".encode()).hexdigest()
        return {
            'key': unique_key,
            'region': resource.p_region.r_title,
            'region_security': resource.p_region.r_safetylvl,
            'constellation': resource.p_constellation.co_title,
            'constellation_security': resource.p_constellation.co_safetylvl,
            'solar_system': resource.p_solarsystem.ss_title,
            'solar_system_security': resource.p_solarsystem.ss_safetylvl,
            'planet_id': resource.p_title,
            'resource_level': resource_level,
            'resource_yield': resource_yield,
            'resource_name': resource_name,
            'icon': icon,
        }


class PlanetaryProgrammeView(APIView):
    permission_classes = [IsAuthenticated]   # 需要认证的权限类

    @staticmethod
    def post(request):
        user_id = request.user.id
        user_name = request.user.username

        programme_name = request.data.get('programmeName')
        programme_desc = request.data.get('programmeDesc')

        programme_length = PlanetaryProgramme.objects.filter(user_id=user_id).count()
        if programme_length > 9:
            return Response({'message': "方案数量已达到上限，请先删除部分方案"}, status=status.HTTP_400_BAD_REQUEST)

        if not all([programme_name.strip(), str(user_id).strip(), user_name.strip()]):
            return Response({'message': '提交保存数据不全'}, status=status.HTTP_400_BAD_REQUEST)

        save_data = request.data.get('data')

        new_planetary = PlanetaryProgramme(
            user_id=user_id,
            user_name=user_name,
            programme_desc=programme_desc,
            programme_name=programme_name,
            programme_element=save_data,
        )
        try:
            new_planetary.save()
            programme_id = new_planetary.programme_id

            # 在这里可以继续处理数据或者返回响应，同时使用 user_id 和 username
            return Response({'message': "成功保存方案", "programme_id": programme_id}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)

    @staticmethod
    def get(request):
        user_id = request.user.id
        programme_id = request.GET.get("programme_id")

        if not programme_id:
            # 从数据库中获取用户的所有方案
            planetary_programmes = PlanetaryProgramme.objects.filter(user_id=user_id)
            serializer = PlanetaryProgrammeListSerializer(planetary_programmes, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)
        else:
            planet_programme = PlanetaryProgramme.objects.filter(user_id=user_id, programme_id=programme_id)
            serializer = PlanetaryProgrammeSerializer(planet_programme, many=True)
            return Response(serializer.data, status=status.HTTP_200_OK)

    @staticmethod
    def delete(request):
        user_id = request.user.id
        programme_id = request.data.get('programme_id')

        if not programme_id:
            return Response({'error': '缺少方案ID'}, status=status.HTTP_400_BAD_REQUEST)

        # 使用 get_object_or_404 确保对象存在，如果不存在则返回 404 错误
        planetary_programme = get_object_or_404(PlanetaryProgramme, user_id=user_id, programme_id=programme_id)

        try:
            planetary_programme.delete()
            return Response({'message': '方案删除成功'}, status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @staticmethod
    def patch(request):
        user_id = request.user.id
        programme_id = request.data.get('programme_id')

        if not programme_id:
            return Response({'error': '缺少方案ID'}, status=status.HTTP_400_BAD_REQUEST)

        # 使用 get_object_or_404 确保对象存在，如果不存在则返回 404 错误
        planetary_programme = get_object_or_404(PlanetaryProgramme, user_id=user_id, programme_id=programme_id)

        # 更新数据，这里假设传入的数据包含了需要更新的字段
        # 例如，更新名称和描述

        element = request.data.get('element')

        # 检查是否提供了有效地更新数据
        if element is not None:
            planetary_programme.programme_element = element

        try:
            planetary_programme.save()  # 保存更新后的对象
            return Response({'message': '方案更新成功'}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
