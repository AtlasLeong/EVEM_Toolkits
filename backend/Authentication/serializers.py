from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer

from .access import is_viewer_allowed


# 调用simple-jwt方法，将RefreshToken重新序列化，加入userName
class UserTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        # 调用父类方法，获取一个 RefreshToken
        token = super().get_token(user)

        # 添加额外的数据到令牌中
        token['userName'] = user.username
        token['email'] = user.email

        return token


class AllowlistedTokenRefreshSerializer(TokenRefreshSerializer):
    """Reject refresh tokens issued for an account outside the gate."""

    def validate(self, attrs):
        refresh = self.token_class(attrs['refresh'])
        if not is_viewer_allowed(refresh.get('email', '')):
            raise PermissionDenied('当前账号暂无查看权限。')
        return super().validate(attrs)
