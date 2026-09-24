from collections import defaultdict

from rest_framework.response import Response
from rest_framework.views import APIView
from .models import BazaarRank, BazaarBox
from .serializers import BazaarRankSerializer, BazaarChartSerializer, BazaarBoxSerializer

from django.db.models import Avg, Count, Q
from datetime import datetime, timedelta
from rest_framework import status


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
    throttle_classes = []

    @staticmethod
    def post(request):
        data_list = request.data  # 假设 data_list 是一个列表
        print(data_list)
        if not isinstance(data_list, list):
            return Response({'error': 'Expected a list of items.'}, status=status.HTTP_400_BAD_REQUEST)

        requests = []
        filters = Q(pk__in=[])
        for data in data_list:
            bazaarName = data.get('bazaarName', '').strip()
            server = data.get('server', '').strip()
            rank = str(data.get('rank', '')).strip()

            if not all([bazaarName, server, rank]):
                return Response({'error': 'All fields must be filled and not empty.'},
                                status=status.HTTP_400_BAD_REQUEST)

            try:
                rank_value = int(rank)
            except (TypeError, ValueError):
                return Response({'error': 'rank must be an integer.'}, status=status.HTTP_400_BAD_REQUEST)
            request_key = (bazaarName, server, rank_value)
            requests.append(request_key)
            filters |= Q(bazaar_name=bazaarName, server=server, rank=rank_value)

        if not requests:
            return Response([])

        rows_by_key = defaultdict(list)
        for row in BazaarRank.objects.filter(filters).order_by('date'):
            rows_by_key[(row.bazaar_name, row.server, row.rank)].append(row)

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
    if server == 'China':
        return '国服'
    else:
        return '国际服'
