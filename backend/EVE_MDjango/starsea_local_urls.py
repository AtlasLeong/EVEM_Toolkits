"""Local password login and Starsea only; no production proxy or registrations."""
from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.urls import include, path
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import AnonRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenRefreshView


class LocalLoginThrottle(AnonRateThrottle):
    rate = '30/min'


class LocalLogin(APIView):
    permission_classes = [AllowAny]
    authentication_classes = []
    throttle_classes = [LocalLoginThrottle]

    def post(self, request):
        if not getattr(settings, 'STARSEA_LOCAL_DEMO', False):
            return Response(status=404)
        if not isinstance(request.data, dict):
            return Response({'detail': '请输入邮箱和密码'}, status=400)
        email, password = request.data.get('login_email', ''), request.data.get('login_password', '')
        if not isinstance(email, str) or not isinstance(password, str) or len(email) > 100 or len(password) > 100:
            return Response({'detail': '邮箱或密码不正确'}, status=400)
        record = get_user_model().objects.filter(email=email).first()
        user = authenticate(username=record.username if record else '', password=password)
        if not user:
            return Response({'detail': '邮箱或密码不正确'}, status=401)
        refresh = RefreshToken.for_user(user)
        refresh['userName'] = user.first_name or user.username
        return Response({'access': str(refresh.access_token), 'refresh': str(refresh)})


urlpatterns = [
    # The preview owns an isolated SQLite database, so the full corporation
    # workflow is safe to expose here while never forwarding to production.
    path('api/community/', include('Community.urls')),
    path('api/user/login', LocalLogin.as_view()),
    path('api/user/token/refresh', TokenRefreshView.as_view()),
    path('api/starsea/', include('Starsea.urls')),
]
