import logging
import random
import re
import time

from django.core.mail import send_mail
from django.db import IntegrityError
from rest_framework import status
from rest_framework.exceptions import Throttled
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import EVEMUser, EmailVerificationCode
from .serializers import UserTokenObtainPairSerializer
from .throttle import DailyThrottle, MinuteThrottle

logger = logging.getLogger(__name__)

EMAIL_PATTERN = r"[^@]+@[^@]+\.[^@]+"
PASSWORD_PATTERN = r"^[A-Za-z0-9@._-]+$"


def clean_expired_verifications():
    expiration_time = int(time.time()) - 600
    EmailVerificationCode.objects.filter(created_at__lt=expiration_time).delete()


def format_wait_seconds(wait):
    if wait is None:
        return '稍后'

    seconds = max(1, int(round(wait)))
    if seconds < 60:
        return f'{seconds}秒'

    minutes, remaining_seconds = divmod(seconds, 60)
    if minutes < 60:
        return f'{minutes}分{remaining_seconds}秒' if remaining_seconds else f'{minutes}分钟'

    hours, remaining_minutes = divmod(minutes, 60)
    return f'{hours}小时{remaining_minutes}分钟' if remaining_minutes else f'{hours}小时'


class RegisterView(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        username = (request.data.get('userName') or '').strip()
        password = (request.data.get('password') or '').strip()
        email = (request.data.get('email') or '').strip()
        email_verification_code = (request.data.get('verificationCode') or '').strip()
        eve_id = (request.data.get('eve_id') or '').strip()

        email_db_code = EmailVerificationCode.objects.filter(email=email).values_list('code', flat=True).first()
        if not email_db_code:
            return Response({'error': 'Email verification code not found.'}, status=status.HTTP_400_BAD_REQUEST)

        if not all([username, password, email, email_verification_code]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(EMAIL_PATTERN, email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(PASSWORD_PATTERN, password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        if email_verification_code != email_db_code:
            return Response({'error': 'Wrong Email verification code.'}, status=status.HTTP_400_BAD_REQUEST)

        if eve_id and (not eve_id.isdigit() or len(eve_id) > 15):
            return Response(
                {'error': 'eve_id must be a numeric value with a maximum length of 15.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if EVEMUser.objects.filter(username=username).exists():
            return Response({'error': 'Username is already taken.'}, status=status.HTTP_400_BAD_REQUEST)

        if EVEMUser.objects.filter(email=email).exists():
            return Response({'error': 'Email is already in use.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            if eve_id:
                user = EVEMUser.objects.create_user(username=username, password=password, email=email, eve_id=eve_id)
            else:
                user = EVEMUser.objects.create_user(username=username, password=password, email=email)

            refresh = UserTokenObtainPairSerializer.get_token(user)
            return Response(
                {
                    'message': 'User created',
                    'refresh': str(refresh),
                    'access': str(refresh.access_token),
                },
                status=status.HTTP_201_CREATED,
            )
        except IntegrityError as exc:
            logger.exception('Failed to register user username=%s email=%s', username, email)
            return Response({'error': str(exc)}, status=status.HTTP_400_BAD_REQUEST)


class EmailVerification(APIView):
    throttle_classes = [DailyThrottle, MinuteThrottle]

    def throttled(self, request, wait):
        raise Throttled(detail=f'请求过于频繁，请{format_wait_seconds(wait)}后再试', wait=wait)

    @staticmethod
    def post(request):
        email = (request.data.get('email') or '').strip()
        clean_expired_verifications()

        if not re.match(EMAIL_PATTERN, email):
            logger.warning('Rejected verification email request with invalid email: %s', email)
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        code = str(random.randint(100000, 999999))
        EmailVerificationCode.objects.update_or_create(
            email=email,
            defaults={'code': code, 'created_at': time.time()},
        )

        mail_subject = 'Your verification code'
        mail_body = f'Your verification code is: {code}'

        try:
            send_mail(mail_subject, mail_body, 'EVEMTK@163.com', [email])
        except Exception:
            logger.exception('Failed to send verification code email to %s', email)
            return Response({'error': '验证码发送失败，请查看后端日志'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        logger.info('Verification code email sent to %s', email)
        return Response({'message': 'Verification Code Send'}, status=status.HTTP_200_OK)


class SignUpCheck(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        accept_username = (request.data.get('userName') or '').strip()
        accept_email = (request.data.get('email') or '').strip()

        if accept_email:
            if not re.match(EMAIL_PATTERN, accept_email):
                return Response({'duplicate': 'email', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)

            if EVEMUser.objects.filter(email=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已被使用'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'emailFalse', 'message': '该邮箱可以使用'}, status=status.HTTP_200_OK)

        if accept_username:
            if EVEMUser.objects.filter(username__iexact=accept_username).exists():
                return Response({'duplicate': 'userName', 'message': '该用户名已被使用'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'userNameFalse', 'message': '该用户名可以使用'}, status=status.HTTP_200_OK)

        return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        email = (request.data.get('login_email') or '').strip()
        password = (request.data.get('login_password') or '').strip()

        if not all([email, password]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = EVEMUser.objects.get(email=email)
        except EVEMUser.DoesNotExist:
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.check_password(password):
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        refresh = UserTokenObtainPairSerializer.get_token(user)
        return Response(
            {
                'message': 'Login successful',
                'refresh': str(refresh),
                'access': str(refresh.access_token),
            },
            status=status.HTTP_200_OK,
        )


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    @staticmethod
    def post(request):
        user = request.user
        old_password = (request.data.get('oldPassword') or '').strip()
        new_password = (request.data.get('newPassword') or '').strip()
        confirm_password = (request.data.get('confirmPassword') or '').strip()

        if not user.check_password(old_password):
            return Response({'error': 'Incorrect old password.'}, status=status.HTTP_400_BAD_REQUEST)

        if new_password != confirm_password:
            return Response({'error': 'New password and confirm password do not match.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(PASSWORD_PATTERN, new_password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        user.set_password(new_password)
        user.save()
        return Response({'message': 'Password successfully updated.'}, status=status.HTTP_200_OK)


class ForgetPasswordEmailCheck(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        accept_email = (request.data.get('email') or '').strip()

        if accept_email:
            if not re.match(EMAIL_PATTERN, accept_email):
                return Response({'duplicate': 'error', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)

            if EVEMUser.objects.filter(email=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已注册'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'error', 'message': '该邮箱未注册'}, status=status.HTTP_200_OK)

        return Response({'error': '邮箱不能为空'}, status=status.HTTP_400_BAD_REQUEST)


class ForgetPassword(APIView):
    throttle_classes = []

    @staticmethod
    def post(request):
        forget_email = (request.data.get('forgetEmail') or '').strip()
        forget_email_verification = (request.data.get('forgetEmailVerification') or '').strip()
        forget_new_password = (request.data.get('forgetNewPassword') or '').strip()
        forget_confirm_password = (request.data.get('forgetConfirmPassword') or '').strip()

        email_db_code = EmailVerificationCode.objects.filter(email=forget_email).values_list('code', flat=True).first()
        if not email_db_code:
            return Response({'error': 'Email verification code not found.'}, status=status.HTTP_400_BAD_REQUEST)

        if not all([forget_email, forget_email_verification, forget_new_password, forget_confirm_password]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(EMAIL_PATTERN, forget_email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(PASSWORD_PATTERN, forget_new_password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        if forget_email_verification != email_db_code:
            return Response({'error': 'Wrong Email verification code.'}, status=status.HTTP_400_BAD_REQUEST)

        if not EVEMUser.objects.filter(email=forget_email).exists():
            return Response({'error': 'Email has not been signup.'}, status=status.HTTP_400_BAD_REQUEST)

        if forget_new_password != forget_confirm_password:
            return Response({'error': 'confirm Password failed.'}, status=status.HTTP_400_BAD_REQUEST)

        user = EVEMUser.objects.get(email=forget_email)
        user.set_password(forget_new_password)
        user.save()
        return Response({'message': 'Password successfully updated.'}, status=status.HTTP_200_OK)
