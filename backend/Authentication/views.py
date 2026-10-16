import logging
import re
import secrets
import time

from django.core.mail import send_mail
from django.core.exceptions import ValidationError
from django.core.validators import validate_email
from django.db import IntegrityError, transaction
from django.utils.crypto import constant_time_compare
from rest_framework import status
from rest_framework.exceptions import Throttled
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenRefreshView

from .models import EVEMUser, EmailVerificationCode
from .serializers import AllowlistedTokenRefreshSerializer, UserTokenObtainPairSerializer
from .throttle import (
    AuthPrecheckThrottle, DailyThrottle, LoginAccountThrottle, LoginIPThrottle, MinuteThrottle,
    PasswordResetAccountThrottle, PasswordResetIPThrottle, RegistrationAccountThrottle,
    RegistrationIPThrottle, TokenRefreshIPThrottle,
    VerificationIPDayThrottle, VerificationIPHourThrottle,
)

logger = logging.getLogger(__name__)

PASSWORD_PATTERN = r"^[A-Za-z0-9@._-]+$"
VERIFICATION_LIFETIME_SECONDS = 600


class AllowlistedTokenRefreshView(TokenRefreshView):
    serializer_class = AllowlistedTokenRefreshSerializer
    throttle_classes = [TokenRefreshIPThrottle]


def request_text(request, field):
    value = request.data.get(field) if hasattr(request.data, 'get') else None
    if not isinstance(value, str):
        return ''
    try:
        value.encode('utf-8')
    except UnicodeError:
        return ''
    return value.strip()


def valid_email(email):
    if len(email) > EVEMUser._meta.get_field('email').max_length:
        return False
    try:
        validate_email(email)
    except ValidationError:
        return False
    return True


def verification_error(verification, code):
    if verification is None:
        return 'Email verification code not found.'
    if verification.created_at <= time.time() - VERIFICATION_LIFETIME_SECONDS:
        return 'Email verification code has expired.'
    if not re.fullmatch(r'[0-9]{6}', code) or not constant_time_compare(code, verification.code):
        return 'Wrong Email verification code.'
    return None


def clean_expired_verifications():
    expiration_time = time.time() - VERIFICATION_LIFETIME_SECONDS
    EmailVerificationCode.objects.filter(created_at__lte=expiration_time).delete()


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
    permission_classes = [AllowAny]
    throttle_classes = [RegistrationIPThrottle, RegistrationAccountThrottle]

    @staticmethod
    def post(request):
        username = request_text(request, 'userName')
        password = request_text(request, 'password')
        email = request_text(request, 'email').casefold()
        email_verification_code = request_text(request, 'verificationCode')
        eve_id = request_text(request, 'eve_id')

        if not all([username, password, email, email_verification_code]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        if not valid_email(email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(PASSWORD_PATTERN, password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        if len(username) > EVEMUser._meta.get_field('username').max_length:
            return Response({'error': 'Enter a valid username.'}, status=status.HTTP_400_BAD_REQUEST)

        if eve_id and (not eve_id.isdigit() or len(eve_id) > 15):
            return Response(
                {'error': 'eve_id must be a numeric value with a maximum length of 15.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if EVEMUser.objects.filter(username=username).exists():
            return Response({'error': 'Username is already taken.'}, status=status.HTTP_400_BAD_REQUEST)

        if EVEMUser.objects.filter(email__iexact=email).exists():
            return Response({'error': 'Email is already in use.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            with transaction.atomic():
                verification = EmailVerificationCode.objects.select_for_update().filter(email__iexact=email).first()
                error = verification_error(verification, email_verification_code)
                if error:
                    return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
                user = EVEMUser.objects.create_user(username=username, password=password, email=email, **({'eve_id': eve_id} if eve_id else {}))
                verification.delete()
                refresh = UserTokenObtainPairSerializer.get_token(user)
                return Response(
                    {'message': 'User created', 'refresh': str(refresh), 'access': str(refresh.access_token)},
                    status=status.HTTP_201_CREATED,
                )
        except IntegrityError:
            logger.exception('Failed to register user username=%s email=%s', username, email)
            return Response({'error': 'Username or email is already in use.'}, status=status.HTTP_400_BAD_REQUEST)


class EmailVerification(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [DailyThrottle, MinuteThrottle, VerificationIPHourThrottle, VerificationIPDayThrottle]

    def throttled(self, request, wait):
        raise Throttled(detail=f'请求过于频繁，请{format_wait_seconds(wait)}后再试', wait=wait)

    @staticmethod
    def post(request):
        email = request_text(request, 'email').casefold()
        clean_expired_verifications()

        if not valid_email(email):
            logger.warning('Rejected verification email request with invalid email: %s', email)
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        code = str(secrets.randbelow(900000) + 100000)
        mail_subject = 'Your verification code'
        mail_body = f'Your verification code is: {code}'

        try:
            # update_or_create locks an existing row. Keep that lock through
            # delivery so a failed resend rolls back to the last delivered code,
            # including its original expiry, and concurrent sends cannot reorder it.
            with transaction.atomic():
                EmailVerificationCode.objects.update_or_create(
                    email=email,
                    defaults={'code': code, 'created_at': time.time()},
                )
                if send_mail(mail_subject, mail_body, 'EVEMTK@163.com', [email]) != 1:
                    raise RuntimeError('Verification email was not accepted by the mail backend')
        except Exception:
            logger.exception('Failed to send verification code email to %s', email)
            return Response({'error': '验证码发送失败，请查看后端日志'}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        logger.info('Verification code email sent to %s', email)
        return Response({'message': 'Verification Code Send'}, status=status.HTTP_200_OK)


class SignUpCheck(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [AuthPrecheckThrottle]

    @staticmethod
    def post(request):
        accept_username = request_text(request, 'userName')
        accept_email = request_text(request, 'email').casefold()

        if accept_email:
            if not valid_email(accept_email):
                return Response({'duplicate': 'email', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)

            if EVEMUser.objects.filter(email__iexact=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已被使用'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'emailFalse', 'message': '该邮箱可以使用'}, status=status.HTTP_200_OK)

        if accept_username:
            if EVEMUser.objects.filter(username__iexact=accept_username).exists():
                return Response({'duplicate': 'userName', 'message': '该用户名已被使用'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'userNameFalse', 'message': '该用户名可以使用'}, status=status.HTTP_200_OK)

        return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [LoginIPThrottle, LoginAccountThrottle]

    @staticmethod
    def post(request):
        email = request_text(request, 'login_email').casefold()
        password = request_text(request, 'login_password')

        if not all([email, password]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        try:
            user = EVEMUser.objects.get(email__iexact=email)
        except (EVEMUser.DoesNotExist, EVEMUser.MultipleObjectsReturned):
            return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)

        if not user.check_password(password) or not user.is_active:
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
    throttle_classes = [PasswordResetIPThrottle]

    @staticmethod
    def post(request):
        user = request.user
        old_password = request_text(request, 'oldPassword')
        new_password = request_text(request, 'newPassword')
        confirm_password = request_text(request, 'confirmPassword')

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
    permission_classes = [AllowAny]
    throttle_classes = [AuthPrecheckThrottle]

    @staticmethod
    def post(request):
        accept_email = request_text(request, 'email').casefold()

        if accept_email:
            if not valid_email(accept_email):
                return Response({'duplicate': 'error', 'message': '邮箱格式错误'}, status=status.HTTP_200_OK)

            if EVEMUser.objects.filter(email__iexact=accept_email).exists():
                return Response({'duplicate': 'email', 'message': '该邮箱已注册'}, status=status.HTTP_200_OK)

            return Response({'duplicate': 'error', 'message': '该邮箱未注册'}, status=status.HTTP_200_OK)

        return Response({'error': '邮箱不能为空'}, status=status.HTTP_400_BAD_REQUEST)


class ForgetPassword(APIView):
    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetIPThrottle, PasswordResetAccountThrottle]

    @staticmethod
    def post(request):
        forget_email = request_text(request, 'forgetEmail').casefold()
        forget_email_verification = request_text(request, 'forgetEmailVerification')
        forget_new_password = request_text(request, 'forgetNewPassword')
        forget_confirm_password = request_text(request, 'forgetConfirmPassword')

        if not all([forget_email, forget_email_verification, forget_new_password, forget_confirm_password]):
            return Response({'error': 'All fields must be filled and not empty.'}, status=status.HTTP_400_BAD_REQUEST)

        if not valid_email(forget_email):
            return Response({'error': 'Enter a valid email.'}, status=status.HTTP_400_BAD_REQUEST)

        if not re.match(PASSWORD_PATTERN, forget_new_password):
            return Response({'error': 'Enter a valid password.'}, status=status.HTTP_400_BAD_REQUEST)

        if forget_new_password != forget_confirm_password:
            return Response({'error': 'confirm Password failed.'}, status=status.HTTP_400_BAD_REQUEST)

        with transaction.atomic():
            verification = EmailVerificationCode.objects.select_for_update().filter(email__iexact=forget_email).first()
            error = verification_error(verification, forget_email_verification)
            if error:
                return Response({'error': error}, status=status.HTTP_400_BAD_REQUEST)
            try:
                user = EVEMUser.objects.select_for_update().get(email__iexact=forget_email)
            except (EVEMUser.DoesNotExist, EVEMUser.MultipleObjectsReturned):
                return Response({'error': 'Email has not been signup.'}, status=status.HTTP_400_BAD_REQUEST)
            if not user.is_active:
                return Response({'error': 'Invalid email or password.'}, status=status.HTTP_401_UNAUTHORIZED)
            user.set_password(forget_new_password)
            user.save(update_fields=['password'])
            verification.delete()
        return Response({'message': 'Password successfully updated.'}, status=status.HTTP_200_OK)
