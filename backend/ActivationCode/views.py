import datetime
import uuid

from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import ActivationCode
from .serializers import ActivationCodeSerializer


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

        if not code or not pc_identifier:
            return Response({'valid': False, 'message': '缺少必填字段'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            activation = ActivationCode.objects.get(code=code)
        except ActivationCode.DoesNotExist:
            return Response({'valid': False, 'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)

        if activation.expires_at < timezone.now():
            return Response({'valid': False, 'message': '激活码已过期'}, status=status.HTTP_400_BAD_REQUEST)

        if activation.pc_identifier and activation.pc_identifier != pc_identifier:
            return Response({'valid': False, 'message': '该激活码已绑定其他电脑'}, status=status.HTTP_400_BAD_REQUEST)

        # is_active now represents whether the code is enabled, not whether it has
        # already been used once. For compatibility, previously consumed codes that
        # were incorrectly written as inactive remain valid on their bound machine.
        if activation.is_active == 0 and not activation.pc_identifier:
            return Response({'valid': False, 'message': '激活码已停用'}, status=status.HTTP_400_BAD_REQUEST)

        if not activation.pc_identifier:
            activation.pc_identifier = pc_identifier

        activation.last_used = timezone.now()
        activation.save(update_fields=['pc_identifier', 'last_used'])

        serializer = ActivationCodeSerializer(activation)
        return Response({'valid': True, 'activation': serializer.data}, status=status.HTTP_200_OK)
