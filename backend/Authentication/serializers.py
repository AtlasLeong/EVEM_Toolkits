from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer


# 调用simple-jwt方法，将RefreshToken重新序列化，加入userName
class UserTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        # 调用父类方法，获取一个 RefreshToken
        token = super().get_token(user)

        # 添加额外的数据到令牌中
        token['userName'] = user.username

        return token
