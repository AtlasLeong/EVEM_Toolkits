# views.py
import uuid

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from .models import ActivationCode
from .serializers import ActivationCodeSerializer
import datetime


class GenerateActivationCode(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_staff:
            return Response({'message': '无权限'}, status=status.HTTP_403_FORBIDDEN)

        expiration_date = request.data.get("expiration_date")
        expiration_date = timezone.now() + datetime.timedelta(days=int(expiration_date))
        new_code = ActivationCode.objects.create(expires_at=expiration_date, code=uuid.uuid4())
        serializer = ActivationCodeSerializer(new_code)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ValidateActivationCode(APIView):
    def post(self, request):
        code = request.data.get('code')
        pc_identifier = request.data.get('pc_identifier')

        try:
            activation = ActivationCode.objects.get(code=code)
            if activation.is_active == 0:
                return Response({'valid': False, 'message': '激活码已被使用'}, status=status.HTTP_400_BAD_REQUEST)
            if activation.expires_at < timezone.now():
                return Response({'valid': False, 'message': '激活码已过期'}, status=status.HTTP_400_BAD_REQUEST)
            if activation.pc_identifier and activation.pc_identifier != pc_identifier:
                return Response({'valid': False, 'message': '该激活码已绑定其他PC电脑'},
                                status=status.HTTP_400_BAD_REQUEST)

            activation.pc_identifier = pc_identifier
            activation.last_used = timezone.now()
            activation.is_active = 0
            activation.save()

            serializer = ActivationCodeSerializer(activation)
            return Response({'valid': True, 'activation': serializer.data}, status=status.HTTP_200_OK)
        except ActivationCode.DoesNotExist:
            return Response({'valid': False, 'message': 'Invalid code'}, status=status.HTTP_404_NOT_FOUND)
