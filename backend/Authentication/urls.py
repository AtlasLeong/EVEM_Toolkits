from django.urls import path
from .views import (RegisterView, EmailVerification, SignUpCheck, LoginView, ChangePasswordView,
                    ForgetPasswordEmailCheck, ForgetPassword)
from rest_framework_simplejwt.views import (
    TokenRefreshView,
)

urlpatterns = [
    path('register', RegisterView.as_view(), name='register'),  # 注册路由
    path('login', LoginView.as_view(), name='login'),  # 登录路由
    path('emailcode', EmailVerification.as_view(), name="email_verification"),  # 邮箱验证码路由
    path('signupcheck', SignUpCheck.as_view(), name="signup_check"),  # 注册的信息检查路由
    path('token/refresh', TokenRefreshView.as_view(), name='token_refresh'),  # 自动刷新token路由
    path('changepwd', ChangePasswordView.as_view(), name='change_password'),  # 修改密码路由
    path('forgetemailcheck', ForgetPasswordEmailCheck.as_view(), name='forget_email_check'),  # 忘记密码步骤中的邮箱检查
    path('forgetPassword', ForgetPassword.as_view(), name='forget_password'),

]
