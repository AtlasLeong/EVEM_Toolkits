from collections import defaultdict
import re

from rest_framework.response import Response
from rest_framework.views import APIView
from Authentication.throttle import BazaarChartThrottle
from .models import BazaarRank, BazaarBox
from .serializers import BazaarRankSerializer, BazaarChartSerializer, BazaarBoxSerializer

from django.db.models import Avg, Count, Q
from datetime import datetime, timedelta
from rest_framework import status


MAX_CHART_SERIES = 8
MAX_CHART_POINTS_PER_SERIES = 366


def chart_requests(data_list):
    """Validate and de-duplicate the legacy chart shape before database work."""
    if not isinstance(data_list, list) or len(data_list) > MAX_CHART_SERIES:
        raise ValueError('每次最多对比 8 条集市曲线，请减少查询项。')
    requests = []
    seen = set()
    for data in data_list:
        if not isinstance(data, dict) or set(data) != {'bazaarName', 'server', 'rank'}:
            raise ValueError('每条曲线须包含集市名称、服务器和排名。')
        name, server, rank = data['bazaarName'], data['server'], data['rank']
        if not isinstance(name, str) or len(name) > 255 or not name.strip():
            raise ValueError('请输入不超过 255 字的有效集市名称。')
        try:
            name.encode('utf-8')
        except UnicodeError:
            raise ValueError('请输入有效集市名称。') from None
        if not isinstance(server, str) or len(server) > 16 or server.strip().casefold() not in {'china', 'world'}:
            raise ValueError('服务器须为 china 或 world。')
        if type(rank) is int:
            rank_value = rank
        elif isinstance(rank, str) and re.fullmatch(r'[0-9]{1,2}', rank.strip()):
            rank_value = int(rank.strip())
        else:
            raise ValueError('排名须为 1～50 的整数。')
        if not 1 <= rank_value <= 50:
            raise ValueError('排名须为 1～50 的整数。')
        key = (name.strip(), server.strip().casefold(), rank_value)
        if key not in seen:
            seen.add(key)
            requests.append(key)
    return requests


class BazaarNameListView(APIView):
    @staticmethod
    def get(request):
        bazaar_names = BazaarRank.objects.exclude(bazaar_name='赛博克斯').values('bazaar_name').annotate(
            count=Count('bazaar_name'))
        options = [{'value': name['bazaar_name'], 'label': name['bazaar_name']} for name in bazaar_names]
        return Response(options)


class BazaarDateView(APIView):
    @staticmethod
    def post(request):
        bazaarName = request.data.get('bazaarName')
        server = request.data.get('server')
        # 查询最小日期
        min_date = (BazaarRank.objects.filter(bazaar_name=bazaarName, server=server).order_by('date').values('date')
                    .first())

        # 查询最大日期
        max_date = (BazaarRank.objects.filter(bazaar_name=bazaarName, server=server).order_by('-date').values('date')
                    .first())

        response_data = {
            'min_date': min_date['date'] if min_date else None,
            'max_date': max_date['date'] if max_date else None
        }

        return Response(response_data)


class BazaarInfoView(APIView):
    @staticmethod
    def get(request):
        bazaar_name = request.GET.get('bazaarName')
        server = request.GET.get('server')
        select_date = request.GET.get('selectDate')
        queryset = BazaarRank.objects.filter(bazaar_name=bazaar_name, server=server)

        averages = queryset.aggregate(
            average_score_5=Avg('score', filter=Q(rank=5)),
            average_score_20=Avg('score', filter=Q(rank=20)),
        )
        average_score_5 = averages['average_score_5'] or 0
        average_score_20 = averages['average_score_20'] or 0

        if select_date is None or select_date == 'undefined':

            # 返回平均值
            return Response({'average_score_5': average_score_5, 'average_score_20': average_score_20})

        else:

            # 获取当天的排名分数
            queryset = BazaarRank.objects.filter(bazaar_name=bazaar_name, server=server, date=select_date,
                                                 rank__in=[5, 20, 50])
            serializer = BazaarRankSerializer(queryset, many=True)

            # 处理查询结果，构建所需的数据格式
            processed_data = {}
            for item in serializer.data:
                processed_data[f'rank_{item["rank"]}'] = item["score"]

            # 计算前一天的日期
            select_date_obj = datetime.strptime(select_date, '%Y-%m-%d')
            previous_date_obj = select_date_obj - timedelta(days=1)
            previous_date_str = previous_date_obj.strftime('%Y-%m-%d')

            # 获取前一天的排名分数
            queryset_previous = BazaarRank.objects.filter(bazaar_name=bazaar_name, server=server,
                                                          date=previous_date_str,
                                                          rank__in=[5, 20, 50])
            serializer_previous = BazaarRankSerializer(queryset_previous, many=True)

            # 计算昨日分数线与今日分数线的差值
            diff_data = {}
            for item in serializer_previous.data:
                rank = item["rank"]
                score_yesterday = item["score"] or 0
                score_today = processed_data.get(f'rank_{rank}', 0) or 0
                diff_data[f'pre_rank_diff_{rank}'] = score_today - score_yesterday

            # 将差值数据合并到处理后的数据中
            processed_data.update(diff_data)

            # 将平均值加入到处理后的数据中
            processed_data['average_score_5'] = average_score_5
            processed_data['average_score_20'] = average_score_20
            # 返回处理后的数据
            return Response(processed_data)


class BazaarChartInfo(APIView):
    throttle_classes = [BazaarChartThrottle]

    @staticmethod
    def post(request):
        try:
            requests = chart_requests(request.data)
        except ValueError as error:
            return Response({'error': str(error)}, status=status.HTTP_400_BAD_REQUEST)
        if not requests:
            return Response([])

        filters = Q(pk__in=[])
        for name, server, rank in requests:
            filters |= Q(bazaar_name=name, server__iexact=server, rank=rank)
        point_limit = len(requests) * MAX_CHART_POINTS_PER_SERIES
        rows = list(BazaarRank.objects.filter(filters).order_by('date', 'pk')[:point_limit + 1])
        if len(rows) > point_limit:
            return Response({'error': '集市历史记录过多，请减少对比项或选择其他集市。'},
                            status=status.HTTP_400_BAD_REQUEST)
        rows_by_key = defaultdict(list)
        for row in rows:
            series = rows_by_key[(row.bazaar_name, row.server.casefold(), row.rank)]
            series.append(row)
            if len(series) > MAX_CHART_POINTS_PER_SERIES:
                return Response({'error': '单条集市曲线超过 366 个历史点，请选择其他集市。'},
                                status=status.HTTP_400_BAD_REQUEST)

        # Preserve the request order while using one database query for all
        # requested series instead of one query per chart.
        results = [
            formatData(BazaarChartSerializer(rows_by_key[key], many=True))
            for key in requests
        ]

        return Response(results)


class BazaarBoxView(APIView):
    @staticmethod
    def get(request):
        bazaar_name = request.GET.get('bazaarName')
        if not bazaar_name:
            return Response({'error': 'wrong bazaar name'}, status=status.HTTP_400_BAD_REQUEST)
        queryset = BazaarBox.objects.filter(bazaar_name=bazaar_name)
        serializer = BazaarBoxSerializer(queryset, many=True)
        return Response(serializer.data)


def formatData(serializer_data):
    data = []
    i = 1
    for item in serializer_data.data:
        formatItem = {}
        bazaar_name = item['bazaar_name']
        rank = item['rank']
        server = formatServer(item['server'])
        formatItem[f'{bazaar_name}{server}第{rank}名'] = item['score']
        formatItem['date'] = f'第{i}日'
        i += 1
        data.append(formatItem)

    return data


def formatServer(server):
    if server.casefold() == 'china':
        return '国服'
    else:
        return '国际服'
