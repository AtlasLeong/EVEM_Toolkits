from django.shortcuts import render
from rest_framework.views import APIView, Response, status
from .models import (FraudList, FraudAuthUserGroup, FraudBehaviorFlow, FraudAuthGroup, FraudListReportFlow,
                     FraudEvidenceFlow)
from .serializers import FraudListSerializer, FraudBehaviorFlowSerializer, FraudListReportFlowSerializer
from .permissions import get_user_group_ids
from Authentication.models import EVEMUser
from Authentication.serializers import UserTokenObtainPairSerializer
from rest_framework.permissions import IsAuthenticated
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.conf import settings
import uuid
import os
import hashlib
from django.core.files.storage import default_storage
from django.core.files.base import ContentFile
from django.core.files.storage import FileSystemStorage

# 公共举报组默认图标
PUBLIC_REPORT_GROUP_ICON = getattr(settings, 'PUBLIC_REPORT_GROUP_ICON',
                                   'https://www.evemtk.com/static/source-group-icon/jitashangyeaijiang.jpg')


# Create your views here.

class FraudListSearch(APIView):
    @staticmethod
    def post(request):
        search_number = request.data.get("searchNumber").strip()
        result = FraudList.objects.filter(fraud_account=search_number)

        serializers = FraudListSerializer(result, many=True)
        if len(result) != 0:
            return Response(serializers.data, status=status.HTTP_200_OK)
        else:
            return Response([], status=status.HTTP_200_OK)


class FraudAdminCheck(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        check_admin = FraudAuthUserGroup.objects.filter(user_id=user_id).exists()

        if check_admin:
            return Response({"message": "Authorized Users"}, status=status.HTTP_200_OK)
        else:
            return Response({"message": "UnAuthorized Users"}, status=status.HTTP_200_OK)


class AdminFraudList(APIView):
    # 仅允许已认证管理员访问
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        group_id_list = get_user_group_ids(user_id)

        if len(group_id_list) == 0:
            return Response({"message": "UnAuthorized Users"}, status=status.HTTP_401_UNAUTHORIZED)

        else:
            result = FraudList.objects.filter(source_group_id__in=group_id_list)
            serializers = FraudListSerializer(result, many=True)
            return Response(serializers.data, status=status.HTTP_200_OK)

    @staticmethod
    def delete(request):
        user_id = request.user.id
        fraud_id = request.data.get("fraudID")

        target_fraud = get_object_or_404(FraudList, id=fraud_id)
        source_group_id = target_fraud.source_group_id

        group_id_list = get_user_group_ids(user_id)

        if source_group_id not in group_id_list:
            return Response({"message": "No permission."}, status=status.HTTP_403_FORBIDDEN)

        try:
            delete_record = FraudBehaviorFlow(
                operation_user_id=user_id,
                operation_id=str(uuid.uuid4()),
                action_type='delete',
                change='D',
                fraud_id=target_fraud.id,
                fraud_account=target_fraud.fraud_account,
                account_type=target_fraud.account_type,
                remark=target_fraud.remark,
                fraud_type=target_fraud.fraud_type,
                source_group_id=target_fraud.source_group_id,
                source_group_name=target_fraud.source_group_name,
                icon=target_fraud.icon,
                change_time=timezone.now()
            )
            target_fraud.delete()
            delete_record.save()
            return Response({'message': '诈骗记录删除成功'}, status=status.HTTP_204_NO_CONTENT)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @staticmethod
    def post(request):
        user_id = request.user.id
        fraud_record = request.data.get("fraudRecord")

        if not fraud_record:
            return Response({"error": "Invalid data."}, status=status.HTTP_400_BAD_REQUEST)

        target_group_id = fraud_record.get("source_group_id")

        group_id_list = get_user_group_ids(user_id)

        if target_group_id not in group_id_list:
            return Response({"message": "No permission."}, status=status.HTTP_403_FORBIDDEN)

        try:
            target_group = FraudAuthGroup.objects.get(group_id=target_group_id)
        except FraudAuthGroup.DoesNotExist:
            return Response({"error": "Target group not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            # 从 FraudAuthGroup 中获取 source_group_name 与 icon
            target_group = FraudAuthGroup.objects.get(group_id=target_group_id)
            source_group_name = target_group.group_name
            icon = target_group.icon

            new_fraud = FraudList(
                fraud_account=fraud_record.get('fraud_account'),
                account_type=fraud_record.get('account_type'),
                remark=fraud_record.get('remark'),
                fraud_type=fraud_record.get('fraud_type'),
                source_group_id=target_group_id,
                source_group_name=source_group_name,
                icon=icon
            )
            new_fraud.save()

            operation_record = FraudBehaviorFlow(
                operation_user_id=user_id,
                operation_id=str(uuid.uuid4()),
                action_type='add',
                change='A',
                fraud_id=new_fraud.id,
                fraud_account=fraud_record.get('fraud_account'),
                account_type=fraud_record.get('account_type'),
                remark=fraud_record.get('remark'),
                fraud_type=fraud_record.get('fraud_type'),
                source_group_id=target_group_id,
                source_group_name=source_group_name,
                icon=icon,
                change_time=timezone.now()
            )

            operation_record.save()

            return Response({"message": "Fraud record and operation record created successfully."},
                            status=status.HTTP_201_CREATED)
        except FraudAuthGroup.DoesNotExist:
            return Response({'error': 'Target group not found.'}, status=status.HTTP_404_NOT_FOUND)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    @staticmethod
    def patch(request):
        user_id = request.user.id
        fraud_record = request.data.get("fraudRecord")

        if not fraud_record:
            return Response({"error": "Invalid data."}, status=status.HTTP_400_BAD_REQUEST)

        fraud_id = fraud_record.get("fraud_id")
        if not fraud_id:
            return Response({"error": "Fraud ID is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            existing_fraud = FraudList.objects.get(id=fraud_id)
        except FraudList.DoesNotExist:
            return Response({"error": "Fraud record not found."}, status=status.HTTP_404_NOT_FOUND)

        target_group_id = fraud_record.get("source_group_id", existing_fraud.source_group_id)
        try:
            target_group_id = int(target_group_id)
        except (TypeError, ValueError):
            return Response({"error": "Target group is invalid."}, status=status.HTTP_400_BAD_REQUEST)

        # 检查用户是否属于目标群组
        group_id_list = FraudAuthUserGroup.objects.filter(user_id=user_id).values_list('group_id', flat=True)

        if target_group_id not in group_id_list:
            return Response({"message": "No permission."}, status=status.HTTP_403_FORBIDDEN)

        try:
            target_group = FraudAuthGroup.objects.get(group_id=target_group_id)
        except FraudAuthGroup.DoesNotExist:
            return Response({"error": "Target group not found."}, status=status.HTTP_404_NOT_FOUND)

        shared_operation_id = str(uuid.uuid4())
        # 记录更新前状态
        operation_record_before = FraudBehaviorFlow(
            operation_user_id=user_id,
            operation_id=shared_operation_id,
            action_type='update',
            change='B',
            fraud_id=existing_fraud.id,
            fraud_account=existing_fraud.fraud_account,
            account_type=existing_fraud.account_type,
            remark=existing_fraud.remark,
            fraud_type=existing_fraud.fraud_type,
            source_group_id=existing_fraud.source_group_id,
            source_group_name=existing_fraud.source_group_name,
            icon=existing_fraud.icon,
            change_time=timezone.now()
        )
        operation_record_before.save()

        try:
            # 更新 FraudList 记录
            for key, value in fraud_record.items():
                if key in ("source_group_name", "icon"):
                    continue
                if hasattr(existing_fraud, key) and value is not None:
                    setattr(existing_fraud, key, value)
            existing_fraud.source_group_id = target_group_id
            existing_fraud.source_group_name = target_group.group_name
            existing_fraud.icon = target_group.icon
            existing_fraud.save()

            # 记录更新后状态
            operation_record_after = FraudBehaviorFlow(
                operation_user_id=user_id,
                operation_id=shared_operation_id,
                action_type='update',
                change='F',
                fraud_id=existing_fraud.id,
                fraud_account=existing_fraud.fraud_account,
                account_type=existing_fraud.account_type,
                remark=existing_fraud.remark,
                fraud_type=existing_fraud.fraud_type,
                source_group_id=existing_fraud.source_group_id,
                source_group_name=existing_fraud.source_group_name,
                icon=existing_fraud.icon,
                change_time=timezone.now()
            )
            operation_record_after.save()

            return Response({"message": "Fraud record updated successfully."}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GetFraudAdminUserGroup(APIView):
    # 仅允许已认证管理员访问
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        # 获取用户所属的全部群组 ID
        user_groups = FraudAuthUserGroup.objects.filter(user_id=user_id).values_list('group_id', flat=True)

        if not user_groups:
            return Response({"message": "Unauthorized User"}, status=status.HTTP_403_FORBIDDEN)

        # 根据 group_id 查询群组名称
        group_details = FraudAuthGroup.objects.filter(group_id__in=user_groups).values('group_id', 'group_name')

        # 组装前端下拉选项
        groups = [
            {'value': group['group_id'], 'label': f"{group['group_name']}-{group['group_id']}"}
            for group in group_details
        ]
        return Response(groups, status=status.HTTP_200_OK)


class GetAdminBehaviorFlow(APIView):
    # 仅允许已认证管理员访问
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        group_id_list = FraudAuthUserGroup.objects.filter(user_id=user_id).values_list('group_id', flat=True)

        if len(group_id_list) == 0:
            return Response({"message": "UnAuthorized Users"}, status=status.HTTP_401_UNAUTHORIZED)

        admin_behavior_flow = FraudBehaviorFlow.objects.filter(source_group_id__in=group_id_list)

        serializer = FraudBehaviorFlowSerializer(admin_behavior_flow, many=True)

        return Response(serializer.data, status=status.HTTP_200_OK)


class UploadImageView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        user_id = request.user.id
        today = timezone.now().date()

        upload_count = FraudEvidenceFlow.objects.filter(
            user_id=user_id,
            upload_time__date=today
        ).count()

        if upload_count >= 15:
            return Response({"error": "You have exceeded the daily limit of image uploads."},
                            status=status.HTTP_403_FORBIDDEN)

        if 'image' not in request.FILES:
            return Response({"error": "No image file provided"}, status=status.HTTP_400_BAD_REQUEST)

        image = request.FILES['image']

        allowed_types = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'image/bmp', 'image/svg+xml',
        ]

        if image.content_type not in allowed_types:
            return Response(
                {"error": "Invalid file type. Allowed types are JPEG, PNG, GIF, WEBP, BMP, SVG."},
                status=status.HTTP_400_BAD_REQUEST)

        if image.size > 2 * 1024 * 1024:
            return Response({"error": "File size exceeds 2MB limit."}, status=status.HTTP_400_BAD_REQUEST)

        image_content = image.read()
        file_hash = hashlib.md5(image_content).hexdigest()

        existing_record = FraudEvidenceFlow.objects.filter(file_hash=file_hash).first()
        if existing_record:
            self.record_evidence(user_id, existing_record.image_url, is_exists=1, file_hash=file_hash)
            return Response({"message": "File already exists", "file_url": existing_record.image_url},
                          status=status.HTTP_200_OK)

        if settings.STATICFILES_DIRS:
            static_dir = settings.STATICFILES_DIRS[0]
        else:
            return Response({"error": "Static file directory not configured"},
                            status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        storage_path = os.path.join(static_dir, 'uploads', 'fraudlist_evidence')
        os.makedirs(storage_path, exist_ok=True)

        file_extension = os.path.splitext(image.name)[1]
        unique_filename = f"{uuid.uuid4()}{file_extension}"
        fs = FileSystemStorage(location=storage_path)
        filename = fs.save(unique_filename, ContentFile(image_content))
        file_url = request.build_absolute_uri(settings.STATIC_URL + 'uploads/fraudlist_evidence/' + filename)

        self.record_evidence(user_id, file_url, is_exists=0, file_hash=file_hash)
        return Response({"message": "Image uploaded successfully", "file_url": file_url},
                        status=status.HTTP_201_CREATED)

    @staticmethod
    def record_evidence(user_id, image_url, is_exists, file_hash):
        FraudEvidenceFlow.objects.create(
            user_id=user_id,
            image_url=image_url,
            upload_time=timezone.now(),
            is_exists=is_exists,
            file_hash=file_hash
        )


class FraudListReport(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        create_user = request.user.id
        user_report_list = FraudListReportFlow.objects.filter(create_user_id=create_user)

        if not user_report_list.exists():
            return Response([], status=status.HTTP_200_OK)

        serializer = FraudListReportFlowSerializer(user_report_list, many=True)
        return Response(serializer.data, status=status.HTTP_200_OK)

    @staticmethod
    def post(request):
        create_user = request.user.id

        # 检查是否存在待审核记录
        pending_reports = FraudListReportFlow.objects.filter(
            create_user_id=create_user,
            report_status='pending'
        )

        if pending_reports.exists():
            return Response({"error": "已存在等待审核记录，审核完成前无法添加新记录"}, status=status.HTTP_400_BAD_REQUEST)

        # 获取请求数据
        fraud_account = request.data.get('fraud_account')
        account_type = request.data.get('account_type')
        description = request.data.get('description')
        contact_number = request.data.get('contact_number')
        evidence_list = request.data.get('evidence_dict', [])

        # 验证必填字段
        if not all([fraud_account, account_type, description, contact_number]):
            return Response({"error": "必填字段未填写"}, status=status.HTTP_400_BAD_REQUEST)

        # 验证 evidence_list 中的 URL 是否都存在于 FraudEvidenceFlow
        valid_evidence = []
        for evidence_url in evidence_list:
            if FraudEvidenceFlow.objects.filter(image_url=evidence_url, user_id=create_user).exists():
                valid_evidence.append(evidence_url)

        if not valid_evidence:
            return Response({"error": "没有有效的证据 URL"}, status=status.HTTP_400_BAD_REQUEST)

        # 将 evidence_list 转成逗号分隔字符串
        evidence_string = ','.join(valid_evidence)

        # 创建新的举报记录
        new_report = FraudListReportFlow.objects.create(
            create_user_id=create_user,
            report_status='pending',
            fraud_account=fraud_account,
            account_type=account_type,
            description=description,
            contact_number=contact_number,
            evidence_dict=evidence_string,
            create_time=timezone.now()
        )

        return Response({
            "message": "新的举报已成功提交，等待审核。",
            "report_id": new_report.id
        }, status=status.HTTP_201_CREATED)


class FraudAdminListReport(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def get(request):
        user_id = request.user.id
        group_id_list = get_user_group_ids(user_id)

        if len(group_id_list) == 0:
            return Response({"message": "UnAuthorized Users"}, status=status.HTTP_401_UNAUTHORIZED)

        else:
            result = FraudListReportFlow.objects.filter(approver_group__in=[
                FraudAuthGroup.objects.get(group_id=gid).group_name for gid in group_id_list
            ]) | FraudListReportFlow.objects.filter(report_status='pending')
            serializers = FraudListReportFlowSerializer(result, many=True)
            return Response(serializers.data, status=status.HTTP_200_OK)

    @staticmethod
    def post(request):
        user_id = request.user.id
        group_id_list = get_user_group_ids(user_id)

        if len(group_id_list) == 0:
            return Response({"message": "UnAuthorized Users"}, status=status.HTTP_401_UNAUTHORIZED)

        approve_status = request.data.get("approve_status")
        approve_remark = request.data.get("approve_remark")
        report_id = request.data.get('report_id')

        # 验证必填字段
        if not all([approve_status, approve_remark]):
            return Response({"error": "必填字段未填写"}, status=status.HTTP_400_BAD_REQUEST)

        try:
            report = FraudListReportFlow.objects.get(id=report_id)
        except FraudListReportFlow.DoesNotExist:
            return Response({"error": "举报记录不存在"}, status=status.HTTP_404_NOT_FOUND)

        if report.report_status != 'pending':
            return Response({"error": "该举报已被处理"}, status=status.HTTP_400_BAD_REQUEST)

        # 过滤掉公共举报组 99，只允许真实审核组审批
        valid_group_ids = [gid for gid in group_id_list if gid != 99]
        if not valid_group_ids:
            return Response({"error": "没有有效的审核组"}, status=status.HTTP_400_BAD_REQUEST)

        # 选择第一个有效的审核组
        selected_group_id = valid_group_ids[0]

        try:
            selected_group = FraudAuthGroup.objects.get(group_id=selected_group_id)
        except FraudAuthGroup.DoesNotExist:
            return Response({"error": "选中的审核组不存在"}, status=status.HTTP_400_BAD_REQUEST)

        # 更新举报状态
        report.report_status = approve_status
        report.approve_remark = approve_remark
        report.approver_id = str(user_id)
        report.approver_group = selected_group.group_name
        report.approve_time = timezone.now()
        report.save()

        # 审核通过时，将举报内容写入 FraudList
        if approve_status == 'accept':
            new_fraud = FraudList.objects.create(
                fraud_account=report.fraud_account,
                account_type=report.account_type,
                remark=report.description,
                fraud_type="用户举报",
                source_group_id=99,
                source_group_name='公共举报组',
                icon=PUBLIC_REPORT_GROUP_ICON
            )

            # 记录审核通过行为
            FraudBehaviorFlow.objects.create(
                operation_user_id=user_id,
                operation_id=str(uuid.uuid4()),
                action_type='accept',
                change='AR',
                fraud_id=new_fraud.id,
                fraud_account=new_fraud.fraud_account,
                account_type=new_fraud.account_type,
                remark=new_fraud.remark,
                fraud_type=new_fraud.fraud_type,
                source_group_id=new_fraud.source_group_id,
                source_group_name=new_fraud.source_group_name,
                icon=new_fraud.icon,
                change_time=timezone.now()
            )
        else:
            # 审核拒绝时，记录拒绝行为
            FraudBehaviorFlow.objects.create(
                operation_user_id=user_id,
                operation_id=str(uuid.uuid4()),
                action_type='reject',
                change='RR',
                fraud_id=report.id,
                fraud_account=report.fraud_account,
                account_type=report.account_type,
                remark=report.description,
                fraud_type="用户举报",
                source_group_id=99,
                source_group_name="公共举报组",
                icon=selected_group.icon,
                change_time=timezone.now()
            )
        return Response({
            "message": "完成审核",
            "report_id": report.id
        }, status=status.HTTP_200_OK)



