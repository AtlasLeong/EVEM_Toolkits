import datetime

from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .catalog import DEFAULT_PLAN_CODE
from .models import LicenseActivationCode, Plan
from .serializers import (
    LicenseActivationCodeCreateSerializer,
    LicenseActivationCodeExtendSerializer,
    LicenseActivationCodeManagementSerializer,
    LicenseActivationCodeSerializer,
    LicenseActivationCodeUpdateSerializer,
)
from .services import LICENSE_DB, create_license_activation_code, set_extra_scripts, validate_code_with_permissions


def require_staff(request):
    if not request.user or not request.user.is_authenticated:
        return Response({'message': '请先登录'}, status=status.HTTP_401_UNAUTHORIZED)
    if not request.user.is_staff:
        return Response({'message': '无权限'}, status=status.HTTP_403_FORBIDDEN)
    return None


def get_activation_or_404(pk):
    try:
        return (
            LicenseActivationCode.objects.using(LICENSE_DB)
            .select_related('plan')
            .prefetch_related('extra_scripts')
            .get(pk=pk)
        )
    except LicenseActivationCode.DoesNotExist:
        return None


class GenerateLicenseActivationCode(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.user.is_staff:
            return Response({'message': '无权限'}, status=status.HTTP_403_FORBIDDEN)

        expiration_date = request.data.get('expiration_date')
        if expiration_date is None:
            return Response({'message': '缺少 expiration_date'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            int(expiration_date)
        except (TypeError, ValueError):
            return Response({'message': 'expiration_date 必须是天数'}, status=status.HTTP_400_BAD_REQUEST)

        plan_code = request.data.get('plan') or DEFAULT_PLAN_CODE
        extra_script_ids = request.data.get('extra_script_ids') or []
        if not isinstance(extra_script_ids, list):
            return Response({'message': 'extra_script_ids 必须是数组'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            activation = create_license_activation_code(
                expiration_days=expiration_date,
                plan_code=plan_code,
                extra_script_ids=extra_script_ids,
                remark=request.data.get('remark'),
            )
        except Exception as exc:
            return Response({'message': f'生成激活码失败: {exc}'}, status=status.HTTP_400_BAD_REQUEST)

        serializer = LicenseActivationCodeSerializer(activation)
        return Response(serializer.data, status=status.HTTP_201_CREATED)


class ValidateLicenseActivationCode(APIView):
    def post(self, request):
        result = validate_code_with_permissions(
            request.data.get('code'),
            request.data.get('pc_identifier'),
            request=request,
        )
        return Response(result.payload, status=result.status_code)


class LicenseActivationCodeListCreate(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        denied = require_staff(request)
        if denied:
            return denied

        queryset = (
            LicenseActivationCode.objects.using(LICENSE_DB)
            .select_related('plan')
            .prefetch_related('extra_scripts')
            .order_by('-created_at', 'id')
        )
        search = request.query_params.get('search')
        if search:
            queryset = queryset.filter(
                Q(code__icontains=search)
                | Q(remark__icontains=search)
                | Q(pc_identifier__icontains=search)
            )

        plan = request.query_params.get('plan')
        if plan:
            queryset = queryset.filter(plan__code=plan)

        is_active = request.query_params.get('is_active')
        if is_active in {'true', 'false', '1', '0'}:
            queryset = queryset.filter(is_active=is_active in {'true', '1'})

        bound = request.query_params.get('bound')
        if bound in {'true', 'false', '1', '0'}:
            if bound in {'true', '1'}:
                queryset = queryset.exclude(pc_identifier__isnull=True).exclude(pc_identifier='')
            else:
                queryset = queryset.filter(Q(pc_identifier__isnull=True) | Q(pc_identifier=''))

        expired = request.query_params.get('expired')
        if expired in {'true', 'false', '1', '0'}:
            if expired in {'true', '1'}:
                queryset = queryset.filter(expires_at__lt=timezone.now())
            else:
                queryset = queryset.filter(expires_at__gte=timezone.now())

        try:
            limit = min(max(int(request.query_params.get('limit', 50)), 1), 200)
            offset = max(int(request.query_params.get('offset', 0)), 0)
        except (TypeError, ValueError):
            return Response({'message': 'limit/offset 必须是数字'}, status=status.HTTP_400_BAD_REQUEST)
        count = queryset.count()
        items = list(queryset[offset:offset + limit])
        serializer = LicenseActivationCodeManagementSerializer(items, many=True)
        return Response({'count': count, 'results': serializer.data}, status=status.HTTP_200_OK)

    def post(self, request):
        denied = require_staff(request)
        if denied:
            return denied

        serializer = LicenseActivationCodeCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            activation = create_license_activation_code(
                expiration_days=serializer.validated_data['expiration_days'],
                plan_code=serializer.validated_data.get('plan') or DEFAULT_PLAN_CODE,
                extra_script_ids=serializer.validated_data.get('extra_script_ids') or [],
                remark=serializer.validated_data.get('remark'),
            )
        except Exception as exc:
            return Response({'message': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        output = LicenseActivationCodeManagementSerializer(activation)
        return Response(output.data, status=status.HTTP_201_CREATED)


class LicenseActivationCodeDetail(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, pk):
        denied = require_staff(request)
        if denied:
            return denied

        activation = get_activation_or_404(pk)
        if activation is None:
            return Response({'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)
        return Response(LicenseActivationCodeManagementSerializer(activation).data, status=status.HTTP_200_OK)

    def patch(self, request, pk):
        denied = require_staff(request)
        if denied:
            return denied

        activation = get_activation_or_404(pk)
        if activation is None:
            return Response({'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)

        serializer = LicenseActivationCodeUpdateSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        update_fields = []
        if 'plan' in data:
            try:
                activation.plan = Plan.objects.using(LICENSE_DB).get(code=data['plan'], is_active=True)
            except Plan.DoesNotExist:
                return Response({'message': '套餐不存在或已停用'}, status=status.HTTP_400_BAD_REQUEST)
            update_fields.append('plan')
        for field in ('is_active', 'expires_at', 'remark'):
            if field in data:
                setattr(activation, field, data[field])
                update_fields.append(field)
        if update_fields:
            activation.save(using=LICENSE_DB, update_fields=update_fields)
        if 'extra_script_ids' in data:
            try:
                set_extra_scripts(activation, data['extra_script_ids'])
            except ValueError as exc:
                return Response({'message': str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        activation = get_activation_or_404(pk)
        return Response(LicenseActivationCodeManagementSerializer(activation).data, status=status.HTTP_200_OK)


class LicenseActivationCodeUnbind(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        denied = require_staff(request)
        if denied:
            return denied

        activation = get_activation_or_404(pk)
        if activation is None:
            return Response({'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)
        activation.pc_identifier = None
        activation.save(using=LICENSE_DB, update_fields=['pc_identifier'])
        return Response(LicenseActivationCodeManagementSerializer(activation).data, status=status.HTTP_200_OK)


class LicenseActivationCodeExtend(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        denied = require_staff(request)
        if denied:
            return denied

        activation = get_activation_or_404(pk)
        if activation is None:
            return Response({'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)

        serializer = LicenseActivationCodeExtendSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        base_time = activation.expires_at if activation.expires_at > timezone.now() else timezone.now()
        activation.expires_at = base_time + datetime.timedelta(days=serializer.validated_data['days'])
        activation.save(using=LICENSE_DB, update_fields=['expires_at'])
        return Response(LicenseActivationCodeManagementSerializer(activation).data, status=status.HTTP_200_OK)


class LicenseActivationCodeExtraScripts(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, pk):
        denied = require_staff(request)
        if denied:
            return denied

        activation = get_activation_or_404(pk)
        if activation is None:
            return Response({'message': '激活码不存在'}, status=status.HTTP_404_NOT_FOUND)

        script_ids = request.data.get('extra_script_ids', [])
        if not isinstance(script_ids, list):
            return Response({'message': 'extra_script_ids 必须是数组'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            set_extra_scripts(activation, script_ids)
        except ValueError as exc:
            return Response({'message': str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        activation = get_activation_or_404(pk)
        return Response(LicenseActivationCodeManagementSerializer(activation).data, status=status.HTTP_200_OK)
