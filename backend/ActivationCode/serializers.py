# serializers.py
from rest_framework import serializers
from .models import ActivationCode


class ActivationCodeSerializer(serializers.ModelSerializer):
    class Meta:
        model = ActivationCode
        fields = ['code',   'expires_at',  'last_used']
