from rest_framework import serializers
from .models import BoardSystems, BoardStargates, BoardRegions, BoardConstellations

# 星域接口序列化
class BoardRegionSerializers(serializers.ModelSerializer):
    class Meta:
        model = BoardRegions
        fields = ['region_id', 'zh_name']


# 星系接口序列化
class BoardSystemSerializers(serializers.ModelSerializer):
    class Meta:
        model = BoardSystems
        fields = ['system_id', 'zh_name', 'security_status', 'x', 'y', 'z']


# 星系接口序列化
class BoardConstellationsSerializers(serializers.ModelSerializer):
    class Meta:
        model = BoardConstellations
        fields = ['constellation_id', 'zh_name', 'region_id', 'x', 'y', 'z']


# 星门接口序列化
class BoardStarGateSerializers(serializers.ModelSerializer):
    class Meta:
        model = BoardStargates
        fields = ['system_id', 'stargate_id', 'destination_system_id', 'destination_stargate_id']
