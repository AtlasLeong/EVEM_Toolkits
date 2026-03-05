from rest_framework import serializers
from .models import Region, Constellation, Solarsystem


# 星域接口序列化
class RegionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Region
        fields = ['r_title', 'r_id', 'r_safetylvl']


# 星系接口序列化
# 每个星系包含co_region_title, co_region_id 其对应的星域名称与id，给予前端用于级联选择器分组
class ConstellationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Constellation
        fields = ['co_id', 'co_title', 'co_safetylvl', 'co_region_id', 'co_region_title']


# 星座接口序列化
# 每个星座包含ss_constellation_title, ss_constellation_id 其对应的星座名称与id，给予前端用于级联选择器分组
class SolarSystemSerializer(serializers.ModelSerializer):
    class Meta:
        model = Solarsystem
        fields = ['ss_id', 'ss_title', 'ss_safetylvl', 'ss_constellation_id', 'ss_constellation_title',
                  'ss_region_id']
