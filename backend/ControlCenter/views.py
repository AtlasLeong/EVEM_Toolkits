"""Owner-only feature grants and links; never broaden existing module rights."""
from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import DatabaseError, transaction
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.response import Response

from AnomalyHotspots.history import HistoryError, read_attempts, read_changes
from AnomalyHotspots.snapshot import read_snapshot
from django.conf import settings
from .access import CAPABILITY, can_view_changes, current_user, is_owner
from .http import PrivateView, integer, query_values


def account(user, grant=None):
    return {'id': user.pk, 'username': user.get_username(), 'email': user.email,
            'grant': {'enabled': bool(grant and grant.enabled), 'version': grant.version if grant else 0}}


class AccessView(PrivateView):
    throttle_scope = 'control_center_access'
    def get(self, request):
        query_values(request, ())
        return Response({'can_manage': is_owner(request.user), 'can_view_hotspot_changes': can_view_changes(request.user)})


class OwnerView(PrivateView):
    def check_permissions(self, request):
        super().check_permissions(request)
        if not is_owner(request.user):
            raise PermissionDenied('仅超级管理员可使用管理中心。')


class UsersView(OwnerView):
    def get(self, request):
        from .models import FeatureGrant
        query = query_values(request, ('q',))
        value = query.get('q', '')
        if not value or len(value) > 254:
            raise ValidationError({'detail': '请输入完整邮箱或用户 ID。'})
        users = get_user_model().objects.using('default')
        if value.isascii() and value.isdecimal():
            users = users.filter(pk=integer(value, minimum=1))
        else:
            try:
                validate_email(value)
            except DjangoValidationError:
                raise ValidationError({'detail': '请输入完整邮箱或用户 ID。'}) from None
            users = users.filter(email__iexact=value)
        rows = list(users.order_by('pk')[:100])
        grants = {grant.user_id: grant for grant in FeatureGrant.objects.using('default').filter(
            user_id__in=[user.pk for user in rows], capability=CAPABILITY)}
        return Response({'results': [account(user, grants.get(user.pk)) for user in rows]})


def cursor(request):
    query = query_values(request, ('before_id',))
    return integer(query['before_id'], minimum=1) if 'before_id' in query else None


class GrantsView(OwnerView):
    def get(self, request):
        from .models import FeatureGrant
        before = cursor(request)
        query = FeatureGrant.objects.using('default').filter(capability=CAPABILITY).select_related('user').order_by('-user_id')
        if before is not None:
            query = query.filter(user_id__lt=before)
        rows = list(query[:101])
        return Response({'results': [account(grant.user, grant) for grant in rows[:100]],
                         'next_before': rows[99].user_id if len(rows) > 100 else None})


class GrantView(OwnerView):
    http_method_names = ['put', 'options']

    def put(self, request, user_id):
        from .models import FeatureGrant, GrantAudit
        query_values(request, ())
        if type(user_id) is not int or not 1 <= user_id <= 9007199254740991:
            raise ValidationError({'detail': '用户 ID 无效。'})
        data = request.data
        if (not isinstance(data, dict) or not {'enabled', 'version'} <= set(data)
                or set(data) - {'enabled', 'version', 'reason'}
                or type(data.get('enabled')) is not bool or type(data.get('version')) is not int
                or not 0 <= data['version'] <= 9007199254740991
                or not isinstance(data.get('reason', ''), str) or len(data.get('reason', '')) > 500):
            raise ValidationError({'detail': '授权参数无效。'})
        if user_id == request.user.pk:
            raise ValidationError({'detail': '超级管理员自动具有查看权限，无需为自己授权。'})
        try:
            with transaction.atomic(using='default'):
                if not is_owner(request.user, lock=True):
                    raise PermissionDenied('超级管理员身份已失效。')
                # Always lock the stable user row, including before the first
                # grant exists. A lock on a nonexistent grant cannot serialize
                # concurrent first creation on MySQL/PostgreSQL.
                target = get_user_model().objects.using('default').select_for_update().filter(pk=user_id, is_active=True).first()
                if target is None:
                    raise NotFound('账号不存在或不可用。')
                grant = FeatureGrant.objects.using('default').select_for_update().filter(user=target, capability=CAPABILITY).first()
                version = grant.version if grant else 0
                enabled = bool(grant and grant.enabled)
                if data['version'] != version:
                    return Response({'detail': '授权已被修改，请刷新后重试。'}, status=409)
                if data['enabled'] == enabled:
                    return Response(account(target, grant))
                if version >= 9007199254740991:
                    return Response({'detail': '授权版本已达上限，请联系维护人员。'}, status=409)
                if grant is None:
                    grant = FeatureGrant(user=target, capability=CAPABILITY)
                grant.enabled, grant.version, grant.updated_by_id = data['enabled'], version + 1, request.user.pk
                grant.save(using='default')
                GrantAudit.objects.create(actor_id=request.user.pk, target=target,
                    before_enabled=enabled, after_enabled=grant.enabled, before_version=version,
                    after_version=grant.version, reason=data.get('reason', ''))
                return Response(account(target, grant))
        except DatabaseError:
            return Response({'detail': '授权暂时无法保存，请稍后重试。'}, status=503)


class AuditView(OwnerView):
    def get(self, request):
        from .models import GrantAudit
        before = cursor(request)
        query = GrantAudit.objects.using('default').select_related('actor', 'target').order_by('-pk')
        if before is not None:
            query = query.filter(pk__lt=before)
        rows = list(query[:101])
        return Response({'results': [
            {'id': row.pk, 'actor': {'id': row.actor_id, 'username': row.actor.get_username()},
             'target': {'id': row.target_id, 'username': row.target.get_username()},
             'before': {'enabled': row.before_enabled, 'version': row.before_version},
             'after': {'enabled': row.after_enabled, 'version': row.after_version},
             'reason': row.reason, 'created_at': row.created_at.isoformat(), 'request_id': str(row.request_id)}
            for row in rows[:100]], 'next_before': rows[99].pk if len(rows) > 100 else None})


def module_links(user):
    fresh = current_user(user)
    staff = bool(fresh and fresh.is_staff)
    items = [('license', '激活码管理', '/licenseadmin', 'License', staff),
             ('market', '市场采集管理', '/market/admin', 'Market', staff),
             ('corporation_review', '军团审核', '/corporations/review', 'Community', staff),
             ('starsea_review', '星海见闻审核', '/starsea/review', 'Starsea', staff),
             ('fraud', '防诈管理', '/fraudadmin', 'FraudList', False),
             ('feedback', '反馈管理', '/feedback', 'Feedback', staff),
             ('tactical_usage', '战术板使用统计', '/tactical/usage', 'TacticalCollaboration', False)]
    result = []
    for key, label, path, app, allowed in items:
        if not apps.is_installed(app):
            allowed = False
        elif key == 'fraud':
            try:
                allowed = bool(fresh and apps.get_model('FraudList', 'FraudAuthUserGroup').objects.filter(user_id=fresh.pk).exists())
            except DatabaseError:
                allowed = False
        elif key == 'tactical_usage':
            try:
                from TacticalCollaboration.usage import can_view_usage
                allowed = can_view_usage(fresh)
            except (DatabaseError, ImportError):
                allowed = False
        result.append({'key': key, 'label': label, 'path': path, 'allowed': bool(allowed)})
    return result


class OverviewView(OwnerView):
    def get(self, request):
        query_values(request, ())
        snapshot = read_snapshot(getattr(settings, 'ANOMALY_SNAPSHOT_FILE', ''))
        history_dir = getattr(settings, 'ANOMALY_HISTORY_DIR', '')
        try:
            changes = read_changes(history_dir, limit=1)
            attempts = read_attempts(history_dir)
            history_status, latest_interval = changes['status'], changes['interval']
        except HistoryError:
            attempts, history_status, latest_interval = [], 'unavailable', None
        return Response({'collection': {'status': snapshot['status'], 'collected_at_ms': snapshot['collected_at_ms'],
            'last_attempt_at_ms': snapshot['last_attempt_at_ms'], 'system_count': len(snapshot['systems']),
            'history_status': history_status, 'latest_interval': latest_interval, 'attempts': attempts},
            'modules': module_links(request.user)})
