"""Board-local pirate sightings. Every reader filters ownership before aggregation."""
import re
import unicodedata
from datetime import datetime, timedelta, timezone as datetime_timezone

from django.conf import settings
from django.db import transaction
from django.db.models import Count, Sum
from django.utils import timezone
from django.utils.crypto import salted_hmac
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import NotFound, PermissionDenied

from TacticalBoard.models import BoardConstellations, BoardRegions, BoardSystems
from .models import Organization, PirateSighting
from .services import (Conflict, bad, board_data, display_name, fields, integer, locked_org, membership,
                       rate_limit, receipt, remember, resolve_board, scope_data, text,
                       wire_time)


def normalized(value):
    return ' '.join(unicodedata.normalize('NFKC', value).casefold().split())


def observation_time(value):
    raw = text(value, 40)
    try:
        observed = parse_datetime(raw)
    except ValueError:
        observed = None
    if observed is None or timezone.is_naive(observed) or not (
        datetime(2000, 1, 1, tzinfo=datetime_timezone.utc) <= observed <=
        datetime.now(datetime_timezone.utc) + timedelta(minutes=5)
    ):
        bad('观测时间必须包含时区，且不能在未来。')
    if not settings.USE_TZ:
        observed = timezone.make_naive(observed, timezone.get_default_timezone())
    return observed


def activity_time(value):
    if value in (None, ''):
        return None
    if not isinstance(value, str) or re.fullmatch(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', value) is None:
        bad('活跃时间应为 UTC HH:MM。')
    return value


def location(kind, location_id):
    if kind == 'system':
        row = BoardSystems.objects.filter(pk=integer(location_id)).first()
    elif kind == 'constellation':
        row = BoardConstellations.objects.filter(pk=integer(location_id)).first()
    else:
        bad('地点类型无效。')
    if row is None:
        bad('地点不存在。')
    return row.pk, row.zh_name or row.name


def sighting_data(row):
    return {'id': row.pk, 'version': row.version, 'character_name': row.character_name,
            'ship_type': row.ship_type, 'target_key': [row.normalized_name, row.normalized_ship],
            'location_kind': row.location_kind, 'location_id': row.location_id,
            'location_name': row.location_name, 'observed_at': wire_time(row.observed_at),
            'activity_start_utc': row.activity_start_utc,
            'activity_end_utc': row.activity_end_utc, 'notes': row.notes,
            'status': row.status, 'author_id': row.author_id, 'author_name': display_name(row.author),
            'created_at': wire_time(row.created_at), 'updated_at': wire_time(row.updated_at)}


def visible_sightings(board, member):
    query = PirateSighting.objects.filter(board=board).select_related('author')
    if member.role == 'scout':
        query = query.filter(author_id=member.user_id)
    return query


def sighting_token(board, member):
    # Creates add a positive version and withdrawals increment one; neither
    # operation deletes rows. Match the projection's ownership filter so a
    # scout does not scan or retry for another scout's private sightings.
    values = visible_sightings(board, member).aggregate(count=Count('pk'), version_sum=Sum('version'))
    return values['count'], values['version_sum'] or 0


def snapshot_revision(user, board, member, content_token):
    material = ':'.join(str(value) for value in (
        user.pk, board.pk, member.role, member.permission_version,
        board.scope_version, *content_token))
    return salted_hmac('tactical.pirate.snapshot', material, algorithm='sha256').hexdigest()


def snapshot(user, organization_id, board_id, requested_revision=None):
    for _ in range(3):
        org = Organization.objects.filter(pk=organization_id).first()
        if org is None:
            raise NotFound('组织不存在。')
        member = membership(user, org)
        board = resolve_board(org, board_id, kind='pirate')
        content_token = sighting_token(board, member)
        scope_version = board.scope_version
        revision = snapshot_revision(user, board, member, content_token)
        unchanged = requested_revision == revision
        if not unchanged:
            visible = visible_sightings(board, member)
            sightings = []
            active_targets = set()
            # The potentially large projection must not hold the organization
            # row lock needed by writes and membership changes.
            for row in visible.order_by('-observed_at', '-id'):
                sightings.append(sighting_data(row))
                if row.status == 'active':
                    active_targets.add((row.normalized_name, row.normalized_ship))

        with transaction.atomic():
            org = locked_org(organization_id)
            current_member = membership(user, org)
            board = resolve_board(org, board_id, kind='pirate')
            if (current_member.role != member.role or
                    current_member.permission_version != member.permission_version or
                    board.scope_version != scope_version or
                    sighting_token(board, current_member) != content_token):
                # Re-read under current permissions and one consistent board
                # state if any command committed during the unlocked projection.
                continue
            if unchanged:
                return {'unchanged': True, 'revision': revision, 'server_time': wire_time(timezone.now())}
            return {'board': board_data(board), 'role': current_member.role, 'user_id': user.pk,
                    'permission_version': current_member.permission_version,
                    'scope': scope_data(board), 'target_count': len(active_targets),
                    'sightings': sightings, 'revision': revision,
                    'server_time': wire_time(timezone.now())}
    raise Conflict('情报板状态正在变化，请重试。')


@transaction.atomic
def command(user, organization_id, board_id, data):
    if not isinstance(data, dict) or data.get('action') not in ('sighting.create', 'sighting.withdraw', 'scope.update'):
        bad('不支持的操作。')
    action = data['action']
    if action == 'sighting.create':
        fields(data, ('action', 'request_id', 'character_name', 'ship_type', 'location_kind',
                      'location_id', 'observed_at', 'notes'), ('activity_start_utc', 'activity_end_utc'))
    elif action == 'sighting.withdraw':
        fields(data, ('action', 'request_id', 'id', 'expected_version'))
    else:
        fields(data, ('action', 'request_id', 'expected_version', 'region_ids', 'border_hops'))
    org = locked_org(organization_id)
    member = membership(user, org)
    board = resolve_board(org, board_id, kind='pirate')
    if action == 'scope.update' and member.role == 'scout':
        raise PermissionDenied('只有指挥或统帅可以调整范围。')
    sighting = None
    if action == 'sighting.withdraw':
        sighting = visible_sightings(board, member).filter(pk=integer(data['id'])).first()
        if sighting is None:
            raise NotFound('目击不存在。')
    scope = f'pirate:{board.pk}'
    cached = receipt(user, scope, data)
    if cached:
        return cached.result
    rate_limit(user, scope)
    if action == 'sighting.create':
        character_name = text(data['character_name'], 120)
        ship_type = text(data['ship_type'], 120)
        location_id, location_name = location(data['location_kind'], data['location_id'])
        activity_start = activity_time(data.get('activity_start_utc'))
        activity_end = activity_time(data.get('activity_end_utc'))
        if (activity_start is None) != (activity_end is None):
            bad('活跃时段必须同时提供 UTC 开始和结束时间。')
        if PirateSighting.objects.filter(board=board).count() >= 5000:
            bad('此情报板目击数量已达上限。')
        sighting = PirateSighting.objects.create(
            board=board, author=user, character_name=character_name, ship_type=ship_type,
            normalized_name=normalized(character_name), normalized_ship=normalized(ship_type),
            location_kind=data['location_kind'], location_id=location_id, location_name=location_name,
            observed_at=observation_time(data['observed_at']),
            activity_start_utc=activity_start,
            activity_end_utc=activity_end,
            notes=text(data['notes'], 1000, blank=True),
        )
        result = sighting_data(sighting)
    elif action == 'sighting.withdraw':
        if sighting.version != integer(data['expected_version']):
            raise Conflict('目击已被其他成员修改。')
        if sighting.status == 'withdrawn':
            raise Conflict('目击已撤下。')
        sighting.status = 'withdrawn'
        sighting.version += 1
        sighting.save(update_fields=['status', 'version', 'updated_at'])
        result = sighting_data(sighting)
    else:
        if board.scope_version != integer(data['expected_version']):
            raise Conflict('范围已被修改，请刷新后重试。')
        regions = data['region_ids']
        if not isinstance(regions, list) or len(regions) > 20:
            bad('最多选择 20 个星域。')
        regions = sorted({integer(value) for value in regions})
        if BoardRegions.objects.filter(pk__in=regions).count() != len(regions):
            bad('星域不存在。')
        board.region_ids = regions
        board.border_hops = integer(data['border_hops'], 0, 2)
        board.scope_version += 1
        board.save(update_fields=['region_ids', 'border_hops', 'scope_version'])
        result = scope_data(board)
    # Pirate commands deliberately do not advance the organization-wide war
    # state cursor or broadcast author activity to other scouts.
    return remember(user, scope, data, result, org)
