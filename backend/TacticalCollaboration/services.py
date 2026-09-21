"""Domain operations shared by authenticated HTTP and realtime transports.

Authorization checks and writes share the same organization transaction/row lock;
the Python process is never the source of truth for capacity or permissions.
"""
import hashlib
import json
import secrets
from datetime import datetime, timedelta, timezone as datetime_timezone
from uuid import UUID

from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Max, Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import APIException, NotFound, PermissionDenied, Throttled, ValidationError

from TacticalBoard.models import BoardRegions, BoardStargates, BoardSystems
from .models import (AuditLog, CommandReceipt, ConnectionLease, Force, ForceSource, Invite,
                     JoinApplication, Membership, Organization, Report, ReportRevision)


class Conflict(APIException):
    status_code = 409
    default_detail = '状态已变化，请刷新后重试。'
    default_code = 'conflict'


def bad(message):
    raise ValidationError({'detail': message})


def fields(data, required=(), optional=()):
    if not isinstance(data, dict) or set(data) - set(required) - set(optional) or set(required) - set(data):
        bad('请求字段不完整或包含不支持的字段。')


def text(value, limit, blank=False):
    if (not isinstance(value, str) or len(value) > limit or
            any(0xD800 <= ord(c) <= 0xDFFF for c in value) or (not blank and not value.strip())):
        bad(f'请输入不超过 {limit} 字的有效文本。')
    return value.strip()


def uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, TypeError, AttributeError):
        bad('请求标识必须是 UUID。')


def integer(value, low=1, high=2147483647):
    if type(value) is not int or not low <= value <= high:
        bad('数值不在允许范围内。')
    return value


def active_user(user):
    if not getattr(user, 'is_authenticated', False) or not get_user_model().objects.filter(pk=user.pk, is_active=True).exists():
        raise PermissionDenied('账号不可用。')


def locked_org(organization_id):
    try:
        return Organization.objects.select_for_update().get(pk=organization_id)
    except Organization.DoesNotExist:
        raise NotFound('组织不存在。')


def membership(user, org, command=False):
    active_user(user)
    member = Membership.objects.filter(organization=org, user=user, status='active').first()
    if member is None or (command and member.role not in ('founder', 'commander')):
        raise PermissionDenied('你没有此操作权限或已被移出组织。')
    return member


def display_name(user):
    full_name = user.get_full_name() if callable(getattr(user, 'get_full_name', None)) else ''
    return getattr(user, 'eve_id', None) or full_name or user.get_username()


def digest(data):
    return hashlib.sha256(json.dumps(data, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


def receipt(user, scope, data):
    request_id = uuid(data.get('request_id'))
    row = CommandReceipt.objects.filter(actor=user, scope=scope, request_id=request_id).first()
    if row and row.payload_hash != digest(data):
        raise Conflict('同一请求标识不能用于不同内容。')
    return row


def rate_limit(user, scope, limit=120):
    if CommandReceipt.objects.filter(actor=user, scope=scope, created_at__gte=timezone.now() - timedelta(minutes=1)).count() >= limit:
        raise Throttled(detail='操作过于频繁，请稍后重试。', wait=60)


def remember(user, scope, data, result, org=None):
    CommandReceipt.objects.create(actor=user, scope=scope, request_id=uuid(data['request_id']), payload_hash=digest(data), result=result)
    if org is not None:
        metadata = {key: value for key, value in result.items() if key != 'invite_code'}
        if data.get('action') == 'force.move':
            metadata.update(kind=data['kind'], reason=data.get('reason', ''))
        AuditLog.objects.create(organization=org, actor=user, action=data.get('action', scope), request_id=uuid(data['request_id']), metadata=metadata)
    return result


@transaction.atomic
def create_organization(user, data):
    fields(data, ('name', 'request_id'))
    name = text(data['name'], 80)
    get_user_model().objects.select_for_update().get(pk=user.pk)
    active_user(user)
    cached = receipt(user, 'create', data)
    if cached:
        return cached.result
    rate_limit(user, 'create', 5)
    if Membership.objects.filter(user=user, role='founder', status='active').count() >= 10:
        bad('最多创建 10 个组织。')
    org = Organization.objects.create(name=name, founder=user)
    Membership.objects.create(organization=org, user=user, role='founder')
    return remember(user, 'create', data, {'id': org.id, 'name': org.name, 'role': 'founder', 'status': 'active'}, org)


@transaction.atomic
def join_organization(user, data):
    fields(data, ('invite_code', 'request_id'))
    code = text(data['invite_code'], 100)
    active_user(user)
    cached = receipt(user, 'join', data)
    if cached:
        return cached.result
    invite = Invite.objects.filter(code_hash=hashlib.sha256(code.encode()).hexdigest(), expires_at__gt=timezone.now()).first()
    if invite is None:
        bad('邀请链接无效或已过期。')
    org = locked_org(invite.organization_id)
    # Org-before-user ordering avoids a join/appoval deadlock when approval
    # inserts a membership FK referencing this same applicant account.
    get_user_model().objects.select_for_update().get(pk=user.pk)
    active_user(user)
    cached = receipt(user, 'join', data)
    if cached:
        return cached.result
    if invite.expires_at <= timezone.now():
        bad('邀请链接无效或已过期。')
    rate_limit(user, 'join', 10)
    member = Membership.objects.filter(organization=org, user=user).first()
    if member:
        raise Conflict('已加入此组织，或需要统帅恢复被移除的成员。')
    application = JoinApplication.objects.filter(organization=org, user=user, status='pending').first()
    if application is None:
        application = JoinApplication.objects.create(organization=org, user=user)
    return remember(user, 'join', data, {'id': application.id, 'organization_id': org.id,
                                       'organization_name': org.name, 'status': application.status})


def list_organizations(user):
    active_user(user)
    result = [{'id': m.organization_id, 'name': m.organization.name, 'role': m.role, 'status': m.status}
              for m in Membership.objects.filter(user=user).select_related('organization').order_by('id')]
    known = {r['id'] for r in result}
    for app in JoinApplication.objects.filter(user=user, status='pending').select_related('organization').order_by('id'):
        if app.organization_id not in known:
            result.append({'id': app.organization_id, 'name': app.organization.name, 'role': 'scout', 'status': 'pending'})
            known.add(app.organization_id)
    return {'organizations': result}


def member_data(m):
    return {'id': m.id, 'user_id': m.user_id, 'display_name': display_name(m.user), 'role': m.role, 'status': m.status}


@transaction.atomic
def members(user, organization_id):
    org = locked_org(organization_id)
    membership(user, org, command=True)
    return {'members': [member_data(m) for m in Membership.objects.filter(organization=org).select_related('user').order_by('id')],
            'applications': [{'id': a.id, 'user_id': a.user_id, 'display_name': display_name(a.user), 'status': a.status}
                             for a in JoinApplication.objects.filter(organization=org, status='pending').select_related('user').order_by('id')],
            **presence_data(org, include_roster=True)}


ADMIN_FIELDS = {
    'invite.create': (), 'join.review': ('application_id', 'decision'),
    'member.role': ('member_id', 'role'), 'member.remove': ('member_id',), 'member.restore': ('member_id',),
}
CONTENT_FIELDS = ('system_id', 'people', 'ships', 'notes', 'observed_at')
TACTICAL_FIELDS = {
    'report.create': CONTENT_FIELDS,
    'report.update': ('report_id', 'expected_version', *CONTENT_FIELDS),
    'report.confirm': ('report_id', 'expected_version', 'name'),
    'force.create': ('name', 'side', *CONTENT_FIELDS),
    'force.update': ('force_id', 'expected_version', 'name', 'side', *CONTENT_FIELDS),
    'force.move': ('force_id', 'expected_version', 'destination_system_id', 'kind'),
    'force.archive': ('force_id', 'expected_version'),
    'scope.update': ('expected_version', 'region_ids', 'border_hops'),
}
OPTIONAL_FIELDS = {'report.confirm': ('force_id', 'force_expected_version'), 'force.move': ('reason',)}
SHIP_KEYS = {'cruiser', 'battleship', 'light_carrier', 'assault_carrier', 'dreadnought', 'heavy_carrier', 'titan', 'other'}


@transaction.atomic
def command(user, organization_id, data):
    if not isinstance(data, dict) or not isinstance(data.get('action'), str) or data['action'] not in {*ADMIN_FIELDS, *TACTICAL_FIELDS}:
        bad('不支持的操作。')
    action = data['action']
    tactical = action in TACTICAL_FIELDS
    required = ('action', 'request_id', 'connection_id', *TACTICAL_FIELDS[action]) if tactical else ('action', 'request_id', *ADMIN_FIELDS[action])
    fields(data, required, OPTIONAL_FIELDS.get(action, ()))
    org = locked_org(organization_id)
    actor = membership(user, org, command=action not in ('report.create', 'report.update'))
    if action in ('member.role', 'member.restore') and actor.role != 'founder':
        raise PermissionDenied('只有统帅可以调整或恢复成员角色。')
    if tactical:
        require_lease(user, org, data['connection_id'])
    # Replays do not bypass current object-level authorization.
    if action == 'report.update':
        report = org_object(Report, org, data['report_id'])
        if report.author_id != user.pk:
            raise PermissionDenied('只能修改自己的上报。')
    if action == 'member.remove' and actor.role == 'commander':
        target = org_object(Membership, org, data['member_id'])
        if target.role != 'scout':
            raise PermissionDenied('指挥只能移除斥候。')
    scope = f'org:{org.pk}'
    cached = receipt(user, scope, data)
    if cached:
        return cached.result
    rate_limit(user, scope)
    result = tactical_command(user, org, data) if tactical else admin_command(user, org, actor, data)
    return remember(user, scope, data, result, org)


def admin_command(user, org, actor, data):
    action = data['action']
    if action == 'invite.create':
        code = secrets.token_urlsafe(32)
        expires = timezone.now() + timedelta(days=7)
        Invite.objects.create(organization=org, creator=user, code_hash=hashlib.sha256(code.encode()).hexdigest(), expires_at=expires)
        return {'invite_code': code, 'expires_at': expires.isoformat()}
    if action == 'join.review':
        app = JoinApplication.objects.filter(pk=integer(data['application_id']), organization=org).first()
        if app is None:
            raise NotFound('申请不存在。')
        if data['decision'] not in ('approve', 'reject'):
            bad('审批结果无效。')
        if app.status != 'pending':
            raise Conflict('申请已处理。')
        if data['decision'] == 'approve':
            existing = Membership.objects.filter(organization=org, user_id=app.user_id).first()
            if existing:
                raise Conflict('成员已存在；恢复被移除成员必须由统帅单独操作。')
            Membership.objects.create(organization=org, user_id=app.user_id, role='scout')
        app.status = 'approved' if data['decision'] == 'approve' else 'rejected'
        app.reviewer = user
        app.reviewed_at = timezone.now()
        app.save(update_fields=['status', 'reviewer', 'reviewed_at'])
        return {'id': app.id, 'status': app.status}
    target = Membership.objects.filter(pk=integer(data['member_id']), organization=org).first()
    if target is None:
        raise NotFound('成员不存在。')
    if target.role == 'founder' or target.user_id == user.pk:
        raise PermissionDenied('不能移除或降级统帅及自身。')
    if action == 'member.remove':
        if actor.role == 'commander' and target.role != 'scout':
            raise PermissionDenied('指挥只能移除斥候。')
        target.status = 'removed'
    elif action == 'member.restore':
        if target.status != 'removed':
            raise Conflict('成员没有被移除。')
        target.status, target.role = 'active', 'scout'
    else:
        if data['role'] not in ('commander', 'scout'):
            bad('无效角色。')
        if target.status != 'active':
            raise Conflict('请先恢复成员。')
        target.role = data['role']
    target.permission_version += 1
    target.save(update_fields=['role', 'status', 'permission_version'])
    if target.status == 'removed':
        ConnectionLease.objects.filter(organization=org, user_id=target.user_id).delete()
    return {'id': target.id, 'role': target.role, 'status': target.status}


def org_object(model, org, object_id):
    row = model.objects.filter(pk=integer(object_id), organization=org).first()
    if row is None:
        raise NotFound('对象不存在。')
    return row


def expect_version(row, version):
    if row.version != integer(version):
        raise Conflict('其他成员已修改此项，请刷新并核对。')


def system(system_id):
    row = BoardSystems.objects.filter(pk=integer(system_id)).first()
    if row is None:
        bad('星系不存在。')
    return row


def content(data):
    location = system(data['system_id'])
    people = None if data['people'] is None else integer(data['people'], 0, 1000000)
    ships = data['ships']
    if not isinstance(ships, dict) or set(ships) - SHIP_KEYS:
        bad('舰船分类无效。')
    ships = {key: None if value is None else integer(value, 0, 1000000) for key, value in ships.items()}
    raw_time = text(data['observed_at'], 40)
    try:
        observed = parse_datetime(raw_time)
    except ValueError:
        observed = None
    if (observed is None or timezone.is_naive(observed) or
            observed < datetime(2000, 1, 1, tzinfo=datetime_timezone.utc) or observed > timezone.now() + timedelta(minutes=5)):
        bad('观测时间必须包含时区，且不能在未来。')
    return {'system_id': location.pk, 'system_name': location.zh_name or location.name,
            'people': people, 'ships': ships, 'notes': text(data['notes'], 1000, blank=True), 'observed_at': observed}


def entity_data(row):
    result = {key: getattr(row, key) for key in ('id', 'version', 'system_id', 'system_name', 'people', 'ships', 'notes')}
    result.update(observed_at=row.observed_at.isoformat(), updated_at=row.updated_at.isoformat())
    if isinstance(row, Force):
        result.update(name=row.name, side=row.side)
    else:
        result.update(author_id=row.author_id, author_name=display_name(row.author), status=row.status)
    return result


def revise(report):
    # Append-only through all application entry points. The adopted revision is
    # never overwritten when the scout later corrects the current report.
    return ReportRevision.objects.create(report=report, version=report.version, content=entity_data(report))


def tactical_command(user, org, data):
    action = data['action']
    if action.startswith('report.'):
        if action == 'report.create':
            if Report.objects.filter(organization=org).count() >= 5000:
                bad('此战术板上报数量已达上限。')
            report = Report.objects.create(organization=org, author=user, **content(data))
            revise(report)
            return entity_data(report)
        report = org_object(Report, org, data['report_id'])
        expect_version(report, data['expected_version'])
        if action == 'report.update':
            for key, value in content(data).items():
                setattr(report, key, value)
            report.version += 1
            if ForceSource.objects.filter(revision__report=report).exists():
                report.status = 'corrected'
            report.save()
            revise(report)
            return entity_data(report)
        revision = ReportRevision.objects.get(report=report, version=report.version)
        if ForceSource.objects.filter(revision=revision).exists():
            raise Conflict('此版本情报已确认，不能重复生成部署。')
        name = text(data['name'], 80)
        values = {key: getattr(report, key) for key in (*CONTENT_FIELDS, 'system_name')}
        if 'force_id' in data:
            if 'force_expected_version' not in data:
                bad('关联已有部署需要部署版本。')
            force = org_object(Force, org, data['force_id'])
            expect_version(force, data['force_expected_version'])
            if force.archived:
                raise Conflict('此部署已归档，不能继续关联或修改。')
            if force.side != 'enemy':
                bad('敌情只能关联敌方部署。')
            for key, value in values.items():
                setattr(force, key, value)
            force.name = name
            force.version += 1
            force.save()
        else:
            if 'force_expected_version' in data:
                bad('部署版本必须和部署标识一起提交。')
            # Corrections to an adopted report must explicitly replace an
            # existing force, never create another copy of the same fleet.
            if ForceSource.objects.filter(revision__report=report).exists():
                raise Conflict('此上报已有部署，请明确关联已有部署并核对版本。')
            if Force.objects.filter(organization=org, archived=False).count() >= 1000:
                bad('此战术板部署数量已达上限。')
            force = Force.objects.create(organization=org, name=name, side='enemy', **values)
        ForceSource.objects.create(force=force, revision=revision, confirmer=user, force_version=force.version)
        report.status = 'confirmed'
        report.save(update_fields=['status', 'updated_at'])
        return entity_data(force)
    if action.startswith('force.'):
        force = None
        if action != 'force.create':
            force = org_object(Force, org, data['force_id'])
            expect_version(force, data['expected_version'])
            if force.archived:
                raise Conflict('此部署已归档，不能继续关联或修改。')
        if action == 'force.archive':
            force.archived = True
            force.version += 1
            force.save(update_fields=['archived', 'version', 'updated_at'])
            return {'id': force.pk, 'version': force.version, 'archived': True}
        if action == 'force.move':
            destination = system(data['destination_system_id'])
            if data['kind'] == 'gate_move':
                adjacent = BoardStargates.objects.filter(Q(system_id=force.system_id, destination_system_id=destination.pk) |
                                                         Q(system_id=destination.pk, destination_system_id=force.system_id)).exists()
                if not adjacent:
                    bad('只能沿真实星门移动到相邻星系；位置修正需注明原因。')
            elif data['kind'] == 'correction':
                text(data.get('reason', ''), 300)
            else:
                bad('移动类型无效。')
            if 'reason' in data:
                text(data['reason'], 300, blank=True)
            force.system_id, force.system_name = destination.pk, destination.zh_name or destination.name
        else:
            name = text(data['name'], 80)
            if data['side'] not in ('enemy', 'friendly'):
                bad('部署阵营无效。')
            values = content(data)
            if force is None:
                if Force.objects.filter(organization=org, archived=False).count() >= 1000:
                    bad('此战术板部署数量已达上限。')
                force = Force.objects.create(organization=org, name=name, side=data['side'], **values)
                return entity_data(force)
            force.name, force.side = name, data['side']
            for key, value in values.items():
                setattr(force, key, value)
        force.version += 1
        force.save()
        return entity_data(force)
    if org.scope_version != integer(data['expected_version']):
        raise Conflict('战区范围已被修改，请刷新后重试。')
    regions = data['region_ids']
    if not isinstance(regions, list) or len(regions) > 20:
        bad('最多选择 20 个星域。')
    regions = sorted({integer(r) for r in regions})
    if BoardRegions.objects.filter(pk__in=regions).count() != len(regions):
        bad('星域不存在。')
    org.region_ids, org.border_hops = regions, integer(data['border_hops'], 0, 2)
    org.scope_version += 1
    org.save(update_fields=['region_ids', 'border_hops', 'scope_version'])
    return scope_data(org)


def scope_data(org):
    return {'region_ids': org.region_ids, 'border_hops': org.border_hops, 'version': org.scope_version}


def active_leases(org):
    # Also filter removed/disabled accounts: a stale lease never restores access.
    active_ids = Membership.objects.filter(organization=org, status='active', user__is_active=True).values('user_id')
    return ConnectionLease.objects.filter(organization=org, expires_at__gt=timezone.now(), user_id__in=active_ids)


def presence_data(org, include_roster=False):
    leases = active_leases(org)
    result = {'online_count': leases.values('user_id').distinct().count(), 'capacity': 100}
    if include_roster:
        roles = dict(Membership.objects.filter(organization=org, status='active').values_list('user_id', 'role'))
        roster = {}
        for lease in leases.select_related('user').order_by('joined_at', 'id'):
            if lease.user_id not in roster:
                roster[lease.user_id] = {'user_id': lease.user_id, 'display_name': display_name(lease.user),
                                         'role': roles[lease.user_id], 'joined_at': lease.joined_at.isoformat(),
                                         'last_seen_at': lease.last_seen_at.isoformat()}
            else:
                row = roster[lease.user_id]
                row['last_seen_at'] = max(row['last_seen_at'], lease.last_seen_at.isoformat())
        last_reports = dict(ReportRevision.objects.filter(report__organization=org, report__author_id__in=roster)
                            .values('report__author_id').annotate(last_reported_at=Max('created_at'))
                            .values_list('report__author_id', 'last_reported_at'))
        reconnecting_before = (timezone.now() - timedelta(seconds=30)).isoformat()
        for user_id, row in roster.items():
            # A missed heartbeat is a reconnect hint, not proof of logout; the
            # 60-second lease still owns the slot until it expires.
            row['connection_status'] = 'reconnecting' if row['last_seen_at'] < reconnecting_before else 'online'
            last_reported = last_reports.get(user_id)
            row['last_reported_at'] = last_reported.isoformat() if last_reported is not None else None
        result['online'] = list(roster.values())
    return result


def require_lease(user, org, connection_id):
    if not ConnectionLease.objects.filter(organization=org, user=user, connection_id=uuid(connection_id), expires_at__gt=timezone.now()).exists():
        raise PermissionDenied('尚未进入战术板或连接已过期，请重新连接。')


@transaction.atomic
def admit(user, organization_id, connection_id):
    connection_id = uuid(connection_id)
    org = locked_org(organization_id)
    membership(user, org)
    now = timezone.now()
    existing = ConnectionLease.objects.filter(connection_id=connection_id).first()
    if existing and (existing.user_id != user.pk or existing.organization_id != org.pk):
        raise Conflict('连接标识已被使用。')
    own = active_leases(org).filter(user=user)
    # Renewal never consumes an additional unique-account slot.
    if not existing or existing.expires_at <= now:
        if own.count() >= 4:
            raise Throttled(detail='每个账号最多同时打开 4 个战术板连接。', wait=60)
        if not own.exists() and active_leases(org).values('user_id').distinct().count() >= 100:
            raise Conflict('战术板已达到 100 人上限。', code='board_full')
    # Avoid write amplification from repeated browser/transport renewals.
    if not existing:
        ConnectionLease.objects.create(organization=org, user=user, connection_id=connection_id, expires_at=now + timedelta(seconds=60))
    elif existing.last_seen_at <= now - timedelta(seconds=5) or existing.expires_at <= now:
        existing.last_seen_at, existing.expires_at = now, now + timedelta(seconds=60)
        existing.save(update_fields=['last_seen_at', 'expires_at'])
    # Expired rows are disposable presence state, not intelligence history.
    ConnectionLease.objects.filter(organization=org, expires_at__lte=now).exclude(connection_id=connection_id).delete()
    return {'connection_id': str(connection_id), 'lease_seconds': 60, **presence_data(org)}


@transaction.atomic
def leave(user, organization_id, connection_id):
    org = locked_org(organization_id)
    ConnectionLease.objects.filter(organization=org, user=user, connection_id=uuid(connection_id)).delete()
    return {'ok': True}


@transaction.atomic
def snapshot(user, organization_id, connection_id):
    org = locked_org(organization_id)
    member = membership(user, org)
    require_lease(user, org, connection_id)
    commanding = member.role in ('founder', 'commander')
    forces = Force.objects.filter(organization=org, archived=False)
    reports = Report.objects.filter(organization=org).select_related('author')
    if not commanding:
        forces = forces.filter(side='enemy')
        reports = reports.filter(author=user)
    return {'organization': {'id': org.pk, 'name': org.name}, 'role': member.role, 'user_id': user.pk,
            'permission_version': member.permission_version, 'scope': scope_data(org),
            'forces': [entity_data(force) for force in forces.order_by('id')],
            'reports': [entity_data(report) for report in reports.order_by('id')],
            **presence_data(org, include_roster=commanding), 'server_time': timezone.now().isoformat()}


def require_socket(user, org, connection_id, generation):
    """Validate the transport generation while holding the organization lock."""
    lease = ConnectionLease.objects.filter(organization=org, user=user, connection_id=uuid(connection_id),
                                           expires_at__gt=timezone.now()).first()
    if lease is None or lease.socket_generation != uuid(generation):
        raise PermissionDenied('此连接已过期或被新的连接替代。', code='socket_superseded')
    return lease


@transaction.atomic
def claim_socket(user, organization_id, connection_id, generation):
    """The server generates a fresh UUID per physical socket, never the client.

    HTTP admission/renewal retains the logical tab lease. A replacement WS takes
    its sole transport generation, so the superseded socket fails its next read
    or heartbeat instead of creating an unlimited independent subscriber.
    """
    org = locked_org(organization_id)
    membership(user, org)
    result = admit(user, organization_id, connection_id)
    lease = ConnectionLease.objects.get(organization=org, user=user, connection_id=uuid(connection_id))
    generation = uuid(generation)
    if lease.socket_generation == generation:
        return result
    now = timezone.now()
    if lease.socket_claim_window_at is None or lease.socket_claim_window_at <= now - timedelta(minutes=1):
        lease.socket_claim_window_at, lease.socket_claim_count = now, 0
    if lease.socket_claim_count >= 12:
        raise Throttled(detail='重新连接过于频繁，请稍后再试。', wait=60)
    lease.socket_generation = generation
    lease.socket_claim_count += 1
    lease.save(update_fields=['socket_generation', 'socket_claim_window_at', 'socket_claim_count'])
    return result


@transaction.atomic
def socket_snapshot(user, organization_id, connection_id, generation):
    org = locked_org(organization_id)
    membership(user, org)
    require_socket(user, org, connection_id, generation)
    return snapshot(user, organization_id, connection_id)


@transaction.atomic
def socket_heartbeat(user, organization_id, connection_id, generation):
    org = locked_org(organization_id)
    membership(user, org)
    require_socket(user, org, connection_id, generation)
    return admit(user, organization_id, connection_id)
