from .models import EVEMUser, EmailVerificationCode
from .serializers import UserTokenObtainPairSerializer
from .throttle import DailyThrottle, MinuteThrottle
from django.utils import timezone
from django.core.cache import cache
from django.core.mail import send_mail
from django.db import IntegrityError
from django.shortcuts import render
from django.utils.timezone import now
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken
import random
import re
import time


def clean_expired_verifications():
    # 设置过期时间为 10 分钟，即 600 秒
    expiration_time = int(time.time()) - 600
    EmailVerificationCode.objects.filter(created_at__lt=expiration_time).delete()


class RegisterView(APIView):
    # 注册视图，不使用节流限制
    throttle_classes = []

    @staticmethod
    def post(request):
        # 从请求中获取数据
        username = request.data.get('userName')
        password = request.data.get('password')
        email = request.data.get('email')
        emailVerificationCode = request.data.get("verificationCode")
        eve_id = request.data.get("eve_id")

        emailDBCode = EmailVerificationCode.objects.filter(email=email).values_list('code', flat=True).first()
        if not emailDBCode:
            return Response({'error': 'Email verification code not found.'}, status=status.HTTP_400_BAD_REQUEST)

        # 验证所有字段是否填写
        if not all([username.strip(), password.strip(), email.strip(), emailVerificationCode.strip()]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        # 验证邮箱格式
        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        # 验证密码格式（这里的正则表达式应与实际密码要求相匹配）
        if not re.match(r"^[A-Za-z0-9@._-]+$", password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        # 验证邮箱验证码是否正确
        if emailVerificationCode != emailDBCode:
            return Response({'error': 'Wrong Email verification code.'}, status=status.HTTP_400_BAD_REQUEST)

        # 新增验证条件：eve_id存在且不为空时必须为纯数字且位数不大于15
        if eve_id and eve_id.strip():
            if not eve_id.isdigit() or len(eve_id) > 15:
                return Response({'error': 'eve_id must be a numeric value with a maximum length of 15.'},
                                status=status.HTTP_400_BAD_REQUEST)

        # 检查用户名和邮箱是否已被使用
        if EVEMUser.objects.filter(username=username).exists():
            return Response({'error': 'Username is already taken.'}, status=status.HTTP_400_BAD_REQUEST)

        if EVEMUser.objects.filter(email=email).exists():
            return Response({'error': 'Email is already in use.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            if eve_id and eve_id.strip():
                user = EVEMUser.objects.create_user(username=username, password=password, email=email, eve_id=eve_id)
            else:
                user = EVEMUser.objects.create_user(username=username, password=password, email=email)
            # 生成 JWT 令牌
            refresh = UserTokenObtainPairSerializer.get_token(user)  # 使用自定义的 get_token 方法

            return Response({
                'message': 'User created',
                'refresh': str(refresh),
                'access': str(refresh.access_token),
            }, status=status.HTTP_201_CREATED)
        except IntegrityError as e:
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class EmailVerification(APIView):
    # 邮箱验证视图，应用日和分钟级别的节流限制
    throttle_classes = [DailyThrottle, MinuteThrottle]

    @staticmethod
    def post(request):
        email = request.data.get("email")
        # 清除过期记录
        clean_expired_verifications()
        # 验证邮箱格式
        if not re.match(r"[^@]+@[^@]+\.[^@]+", email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        # 生成随机的验证码
        code = str(random.randint(100000, 999999))
        # 存储或更新验证码
        obj, created = EmailVerificationCode.objects.update_or_create(
            email=email,
            defaults={'code': code, 'created_at': time.time()}
        )
        # 发送验证邮件
        mail_subject = 'Your verification code'
        mail_body = 'Your verification code is: ' + code

        send_mail(mail_subject, mail_body, 'EVEMTK@163.com', [email])

        return Response({'message': 'Verification Code Send'}, status=status.HTTP_200_OK)


class SignUpCheck(APIView):
    # 注册信息检查视图 不使用节流限制
    throttle_classes = []

    @staticmethod
    def post(request):
        accept_userName = request.data.get("userName")
        accept_email = request.data.get("email")

        # 验证邮箱格式
        if accept_email and accept_email.strip():
            if not re.match(r"[^@]+@[^@]+\.[^@]+", accept_email):
                return Response({'duplicate': 'email', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)

            if EVEMUser.objects.filter(email=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已被使用'}, status=status.HTTP_200_OK)
            else:
                return Response({'duplicate': 'emailFalse', 'message': '该邮箱可以使用'}, status=status.HTTP_200_OK)

        # 检查用户名和邮箱是否可用
        if accept_userName and accept_userName.strip():
            if EVEMUser.objects.filter(username__iexact=accept_userName).exists():
                return Response({'duplicate': 'userName', 'message': '该用户名已被使用'}, status=status.HTTP_200_OK)
            else:
                return Response({'duplicate': 'userNameFalse', 'message': '该用户名可以使用'},
                                status=status.HTTP_200_OK)

        return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    # 登录视图，不使用节流限制
    throttle_classes = []

    @staticmethod
    def post(request):
        email = request.data.get("login_email")
        password = request.data.get("login_password")

        if not all([email.strip(), password.strip()]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            user = EVEMUser.objects.get(email=email)
        except EVEMUser.DoesNotExist:
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.check_password(password):
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        # 生成 JWT 令牌
        refresh = UserTokenObtainPairSerializer.get_token(user)  # 使用自定义的 get_token 方法

        return Response({
            'message': 'Login successful',
            'refresh': str(refresh),
            'access': str(refresh.access_token),
        }, status=status.HTTP_200_OK)


class ChangePasswordView(APIView):
    # 更改密码视图，只允许已认证用户访问
    permission_classes = [IsAuthenticated]

    @staticmethod
    def post(request):
        user = request.user
        old_password = request.data.get('oldPassword')
        new_password = request.data.get('newPassword')
        confirm_password = request.data.get('confirmPassword')

        # 验证旧密码是否正确
        if not user.check_password(old_password):
            return Response({'error': 'Incorrect old password.'}, status=status.HTTP_400_BAD_REQUEST)

        # 检查新密码和确认密码是否一致
        if new_password != confirm_password:
            return Response({'error': 'New password and confirm password do not match.'},
                            status=status.HTTP_400_BAD_REQUEST)

            # 验证密码格式（这里的正则表达式应与实际密码要求相匹配）
        if not re.match(r"^[A-Za-z0-9@._-]+$", new_password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        # 更新密码
        user.set_password(new_password)
        user.save()

        return Response({'message': 'Password successfully updated.'}, status=status.HTTP_200_OK)


class ForgetPasswordEmailCheck(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        accept_email = request.data.get("email")

        # 验证邮箱格式
        if accept_email and accept_email.strip():
            if not re.match(r"[^@]+@[^@]+\.[^@]+", accept_email):
                return Response({'duplicate': 'error', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)
            # 验证邮箱是否已被注册
            if EVEMUser.objects.filter(email=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已被注册'}, status=status.HTTP_200_OK)
            else:
                return Response({'duplicate': 'error', 'message': '该邮箱未被注册'}, status=status.HTTP_200_OK)

        else:
            return Response({'error': '邮箱不能为空'}, status=status.HTTP_400_BAD_REQUEST)


class ForgetPassword(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        forgetEmail = request.data.get("forgetEmail")
        forgetEmailVerification = request.data.get("forgetEmailVerification")
        forgetNewPassword = request.data.get("forgetNewPassword")
        forgetConfirmPassword = request.data.get("forgetConfirmPassword")

        emailDBCode = EmailVerificationCode.objects.filter(email=forgetEmail).values_list('code', flat=True).first()
        if not emailDBCode:
            return Response({'error': 'Email verification code not found.'}, status=status.HTTP_400_BAD_REQUEST)

        if not all([forgetEmail.strip(), forgetEmailVerification.strip(), forgetNewPassword.strip(),
                    forgetConfirmPassword.strip()]):
            return Response({'error': 'All fields must be filled and not empty.'},
                            status=status.HTTP_400_BAD_REQUEST)

            # 验证邮箱格式
        if not re.match(r"[^@]+@[^@]+\.[^@]+", forgetEmail):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

            # 验证密码格式（这里的正则表达式应与实际密码要求相匹配）
        if not re.match(r"^[A-Za-z0-9@._-]+$", forgetNewPassword):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

            # 验证邮箱验证码是否正确
        if forgetEmailVerification != emailDBCode:
            return Response({'error': 'Wrong Email verification code.'}, status=status.HTTP_400_BAD_REQUEST)

            # 验证邮箱是否已被注册
        if not EVEMUser.objects.filter(email=forgetEmail).exists():
            return Response({'error': 'Email has not been signup.'}, status=status.HTTP_400_BAD_REQUEST)

        if forgetNewPassword != forgetConfirmPassword:
            return Response({'error': 'confirm Password failed.'}, status=status.HTTP_400_BAD_REQUEST)

        user = EVEMUser.objects.get(email=forgetEmail)
        user.set_password(forgetNewPassword)
        user.save()

        return Response({'message': 'Password successfully updated.'}, status=status.HTTP_200_OK)
