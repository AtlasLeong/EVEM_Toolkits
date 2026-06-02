import datetime
import uuid

from django.db import OperationalError, ProgrammingError
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from License.serializers import LicenseActivationCodeSerializer
from License.services import create_license_activation_code, validate_code_with_permissions

from .models import ActivationCode
from .serializers import ActivationCodeSerializer


class GenerateActivationCode(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_staff:
            return Response({'message': '无权限'}, status=status.HTTP_403_FORBIDDEN)

        expiration_date = request.data.get("expiration_date")
        try:
            new_code = create_license_activation_code(
                expiration_days=expiration_date,
                plan_code=request.data.get('plan') or 'default',
                extra_script_ids=request.data.get('extra_script_ids') or [],
                remark=request.data.get('remark'),
            )
            serializer = LicenseActivationCodeSerializer(new_code)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except (OperationalError, ProgrammingError):
            expiration_date = timezone.now() + datetime.timedelta(days=int(expiration_date))
            new_code = ActivationCode.objects.create(expires_at=expiration_date, code=uuid.uuid4())
            serializer = ActivationCodeSerializer(new_code)
            return Response(serializer.data, status=status.HTTP_201_CREATED)
        except Exception as exc:
            return Response({'message': f'生成激活码失败: {exc}'}, status=status.HTTP_400_BAD_REQUEST)


class ValidateActivationCode(APIView):
    def post(self, request):
        result = validate_code_with_permissions(
            request.data.get('code'),
            request.data.get('pc_identifier'),
            request=request,
        )
        return Response(result.payload, status=result.status_code)
