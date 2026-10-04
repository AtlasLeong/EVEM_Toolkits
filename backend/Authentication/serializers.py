from django.contrib.auth import get_user_model
from rest_framework.exceptions import AuthenticationFailed
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.settings import api_settings


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
    """Keep the historical import name; validate the current DB account."""

    def validate(self, attrs):
        refresh = self.token_class(attrs['refresh'])
        user_model = get_user_model()
        user_id = refresh.get(api_settings.USER_ID_CLAIM)
        if isinstance(user_id, bool) or not isinstance(user_id, (int, str)):
            raise AuthenticationFailed('No active account found for the given token.', code='no_active_account')
        try:
            user = user_model.objects.get(**{api_settings.USER_ID_FIELD: user_id})
        except (user_model.DoesNotExist, user_model.MultipleObjectsReturned, TypeError, ValueError, OverflowError):
            raise AuthenticationFailed('No active account found for the given token.', code='no_active_account')
        if not user.is_active:
            raise AuthenticationFailed('No active account found for the given token.', code='no_active_account')
        # Display claims follow the authenticated DB identity, never an email
        # supplied by the client or a stale refresh-token email.
        refresh['email'] = user.email
        refresh['userName'] = user.username
        return super().validate({'refresh': str(refresh)})
