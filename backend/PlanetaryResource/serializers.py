from rest_framework import serializers
from .models import PlResourcePrice, PlanetaryProgramme


class PlanetResourcePriceSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlResourcePrice
        fields = ['resource_name', 'resource_type', 'resource_price']


class PlanetaryProgrammeListSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanetaryProgramme
        fields = ['programme_id', 'user_id', 'user_name', 'programme_name']


class PlanetaryProgrammeSerializer(serializers.ModelSerializer):
    class Meta:
        model = PlanetaryProgramme
        fields = ['programme_id', 'user_id', 'user_name', 'programme_name', 'programme_desc', 'programme_element']
