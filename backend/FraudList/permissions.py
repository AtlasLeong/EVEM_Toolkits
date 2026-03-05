from rest_framework.permissions import BasePermission
from .models import FraudAuthUserGroup


class IsFraudAdmin(BasePermission):
    """
    检查用户是否属于任何诈骗管理组
    """
    def has_permission(self, request, view):
        if not request.user.is_authenticated:
            return False
        return FraudAuthUserGroup.objects.filter(user_id=request.user.id).exists()


def get_user_group_ids(user_id):
    """
    获取用户所属的所有权限组ID列表
    """
    return list(FraudAuthUserGroup.objects.filter(user_id=user_id).values_list('group_id', flat=True))
