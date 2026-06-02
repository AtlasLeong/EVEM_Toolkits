import datetime
import uuid
from dataclasses import dataclass

from django.db import OperationalError, ProgrammingError
from django.utils import timezone
from rest_framework import status

from ActivationCode.models import ActivationCode as LegacyActivationCode

from .catalog import DEFAULT_PLAN_CODE, DEFAULT_PLAN_SCRIPT_IDS
from .models import (
    ActivationCodeExtraScript,
    LicenseActivationCode,
    Plan,
    PlanScript,
    ScriptProduct,
    ValidationLog,
)


LICENSE_DB = 'license'
DEFAULT_PERMISSION_PAYLOAD = {
    'plan': DEFAULT_PLAN_CODE,
    'plan_name': '默认组',
    'grant_all_scripts': False,
    'scripts': list(DEFAULT_PLAN_SCRIPT_IDS),
}


@dataclass
class ValidationResult:
    valid: bool
    status_code: int
    payload: dict


def get_request_meta(request):
    """提取最小必要请求信息，用于验证日志。"""
    if request is None:
        return None, None

    forwarded_for = request.META.get('HTTP_X_FORWARDED_FOR')
    if forwarded_for:
        ip_address = forwarded_for.split(',')[0].strip()
    else:
        ip_address = request.META.get('REMOTE_ADDR')
    user_agent = request.META.get('HTTP_USER_AGENT')
    if isinstance(user_agent, str):
        user_agent = user_agent[:255]
    return ip_address, user_agent


def validate_code_with_permissions(code, pc_identifier, request=None):
    """先校验新授权库；找不到新码时兼容旧激活码表。"""
    if not code or not pc_identifier:
        return ValidationResult(
            valid=False,
            status_code=status.HTTP_400_BAD_REQUEST,
            payload={'valid': False, 'message': '缺少必填字段'},
        )

    license_result = _validate_license_code(code, pc_identifier, request)
    if license_result is not None:
        return license_result

    return _validate_legacy_code(code, pc_identifier, request)


def create_license_activation_code(expiration_days, plan_code=DEFAULT_PLAN_CODE, extra_script_ids=None, remark=None):
    """创建新授权库激活码，默认进入 default 套餐。"""
    plan = Plan.objects.using(LICENSE_DB).get(code=plan_code, is_active=True)
    expires_at = timezone.now() + datetime.timedelta(days=int(expiration_days))
    activation = LicenseActivationCode.objects.using(LICENSE_DB).create(
        code=str(uuid.uuid4()),
        expires_at=expires_at,
        plan=plan,
        remark=remark,
    )

    set_extra_scripts(activation, extra_script_ids or [])
    return activation


def build_permissions_for_activation(activation):
    """根据套餐和单码额外脚本计算最终权限。"""
    plan = activation.plan
    if plan.grant_all_scripts:
        scripts = list(
            ScriptProduct.objects.using(LICENSE_DB)
            .filter(is_active=True)
            .order_by('sort_order', 'id')
            .values_list('script_id', flat=True)
        )
        return {
            'plan': plan.code,
            'plan_name': plan.name,
            'grant_all_scripts': True,
            'scripts': scripts,
        }

    script_ids = []
    seen = set()

    plan_scripts = (
        PlanScript.objects.using(LICENSE_DB)
        .filter(plan=plan, script__is_active=True)
        .select_related('script')
        .order_by('sort_order', 'id')
    )
    extra_scripts = (
        ActivationCodeExtraScript.objects.using(LICENSE_DB)
        .filter(activation_code=activation, script__is_active=True)
        .select_related('script')
        .order_by('sort_order', 'id')
    )

    for relation in list(plan_scripts) + list(extra_scripts):
        script_id = relation.script.script_id
        if script_id in seen:
            continue
        seen.add(script_id)
        script_ids.append(script_id)

    return {
        'plan': plan.code,
        'plan_name': plan.name,
        'grant_all_scripts': False,
        'scripts': script_ids,
    }


def get_default_permission_payload():
    """返回旧激活码兼容权限；授权库不可用时仍有常量兜底。"""
    try:
        plan = Plan.objects.using(LICENSE_DB).get(code=DEFAULT_PLAN_CODE, is_active=True)
        script_ids = list(
            PlanScript.objects.using(LICENSE_DB)
            .filter(plan=plan, script__is_active=True)
            .select_related('script')
            .order_by('sort_order', 'id')
            .values_list('script__script_id', flat=True)
        )
        if script_ids:
            return {
                'plan': plan.code,
                'plan_name': plan.name,
                'grant_all_scripts': False,
                'scripts': script_ids,
            }
    except (Plan.DoesNotExist, OperationalError, ProgrammingError):
        pass

    return dict(DEFAULT_PERMISSION_PAYLOAD)


def log_validation(code, pc_identifier, source, is_valid, message=None, request=None):
    """写入验证日志；日志失败不影响激活码校验主流程。"""
    ip_address, user_agent = get_request_meta(request)
    try:
        ValidationLog.objects.using(LICENSE_DB).create(
            code=code,
            pc_identifier=pc_identifier,
            source=source,
            is_valid=is_valid,
            message=message,
            ip_address=ip_address,
            user_agent=user_agent,
        )
    except (OperationalError, ProgrammingError):
        return


def _validate_license_code(code, pc_identifier, request=None):
    try:
        activation = (
            LicenseActivationCode.objects.using(LICENSE_DB)
            .select_related('plan')
            .get(code=code)
        )
    except LicenseActivationCode.DoesNotExist:
        return None
    except (OperationalError, ProgrammingError):
        return None

    if not activation.is_active or not activation.plan.is_active:
        message = '激活码已停用'
        log_validation(code, pc_identifier, 'license', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    if activation.expires_at < timezone.now():
        message = '激活码已过期'
        log_validation(code, pc_identifier, 'license', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    if activation.pc_identifier and activation.pc_identifier != pc_identifier:
        message = '该激活码已绑定其他电脑'
        log_validation(code, pc_identifier, 'license', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    update_fields = ['last_used']
    if not activation.pc_identifier:
        activation.pc_identifier = pc_identifier
        update_fields.append('pc_identifier')
    activation.last_used = timezone.now()
    activation.save(using=LICENSE_DB, update_fields=update_fields)

    permissions = build_permissions_for_activation(activation)
    from .serializers import LicenseActivationCodeSerializer

    serializer = LicenseActivationCodeSerializer(activation)
    payload = {
        'valid': True,
        'activation': serializer.data,
        'permissions': permissions,
    }
    log_validation(code, pc_identifier, 'license', True, None, request)
    return ValidationResult(True, status.HTTP_200_OK, payload)


def _validate_legacy_code(code, pc_identifier, request=None):
    try:
        activation = LegacyActivationCode.objects.using('default').get(code=code)
    except LegacyActivationCode.DoesNotExist:
        message = '激活码不存在'
        log_validation(code, pc_identifier, 'missing', False, message, request)
        return ValidationResult(False, status.HTTP_404_NOT_FOUND, {'valid': False, 'message': message})

    if activation.expires_at < timezone.now():
        message = '激活码已过期'
        log_validation(code, pc_identifier, 'legacy', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    if activation.pc_identifier and activation.pc_identifier != pc_identifier:
        message = '该激活码已绑定其他电脑'
        log_validation(code, pc_identifier, 'legacy', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    if activation.is_active == 0 and not activation.pc_identifier:
        message = '激活码已停用'
        log_validation(code, pc_identifier, 'legacy', False, message, request)
        return ValidationResult(False, status.HTTP_400_BAD_REQUEST, {'valid': False, 'message': message})

    update_fields = ['last_used']
    if not activation.pc_identifier:
        activation.pc_identifier = pc_identifier
        update_fields.append('pc_identifier')
    activation.last_used = timezone.now()
    activation.save(using='default', update_fields=update_fields)

    payload = {
        'valid': True,
        'activation': {
            'code': activation.code,
            'expires_at': activation.expires_at,
            'last_used': activation.last_used,
        },
        'permissions': get_default_permission_payload(),
    }
    log_validation(code, pc_identifier, 'legacy', True, None, request)
    return ValidationResult(True, status.HTTP_200_OK, payload)


def set_extra_scripts(activation, script_ids):
    """覆盖某个激活码的额外脚本权限。"""
    ActivationCodeExtraScript.objects.using(LICENSE_DB).filter(activation_code=activation).delete()

    if not script_ids:
        return []

    scripts = list(
        ScriptProduct.objects.using(LICENSE_DB)
        .filter(script_id__in=list(script_ids), is_active=True)
        .order_by('sort_order', 'id')
    )
    found_ids = {script.script_id for script in scripts}
    missing_ids = [str(script_id) for script_id in script_ids if str(script_id) not in found_ids]
    if missing_ids:
        raise ValueError(f"未知或未启用脚本: {', '.join(missing_ids)}")

    for index, script in enumerate(scripts, start=1):
        ActivationCodeExtraScript.objects.using(LICENSE_DB).get_or_create(
            activation_code=activation,
            script=script,
            defaults={'sort_order': index},
        )
    return scripts
