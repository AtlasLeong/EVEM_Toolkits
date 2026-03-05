from .models import BazaarRank, BazaarBox
from rest_framework import serializers


class BazaarRankSerializer(serializers.ModelSerializer):
    class Meta:
        model = BazaarRank
        fields = ['rank', 'score']


class BazaarChartSerializer(serializers.ModelSerializer):
    class Meta:
        model = BazaarRank
        fields = ['rank', 'score', 'date', 'bazaar_name', 'server']


class BazaarBoxSerializer(serializers.ModelSerializer):
    class Meta:
        model = BazaarBox
        fields = ['id', 'bazaar_name', 'box', 'basic_lucky', 'price', 'expected_value', 'average_expected',
                  'average_basic', 'picture_url', 'unit']
