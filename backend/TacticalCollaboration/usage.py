"""Owner-only aggregates of existing records; never call mutating business reads."""
from datetime import timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Count, Min, Q
from django.utils import timezone
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response

from .models import AuditLog, Board, JoinApplication, Membership, Organization
from .views import PrivateView


OWNER_EMAIL = '2235102484@qq.com'
SHANGHAI = ZoneInfo('Asia/Shanghai')
# AuditLog is written by successful, transactional commands. Do not infer
# operations from action prefixes: new administrative actions must stay excluded.
OPERATION_ACTIONS = (
    'report.create', 'report.update', 'report.move', 'report.withdraw', 'report.confirm',
    'force.create', 'force.update', 'force.move', 'force.archive',
    'sighting.create', 'sighting.withdraw',
)


def can_view_usage(user):
    """Resolve the owner freshly; neither JWT claims nor staff status grant access."""
    if not getattr(user, 'is_authenticated', False):
        return False
    # Include inactive matches when checking ambiguity, and bound materialization.
    owners = list(get_user_model().objects.filter(email__iexact=OWNER_EMAIL)
                  .values_list('pk', 'is_active')[:2])
    return len(owners) == 1 and owners[0][1] and owners[0][0] == user.pk


def _in_shanghai(value):
    # Production stores naive Shanghai local time; aware test/deployment values
    # still use Shanghai calendar days, independent of Django's current timezone.
    if timezone.is_naive(value):
        return timezone.make_aware(value, SHANGHAI)
    return value.astimezone(SHANGHAI)


def _stored_time(value):
    return value if settings.USE_TZ else value.replace(tzinfo=None)


def usage_overview():
    generated_at = _in_shanghai(timezone.now())
    midnight = generated_at.replace(hour=0, minute=0, second=0, microsecond=0)
    periods = [
        {'key': key, 'start_at': midnight - timedelta(days=days - 1)}
        for key, days in (('today', 1), ('7d', 7), ('30d', 30))
    ]
    totals = Organization.objects.aggregate(
        creator_users=Count('founder_id', distinct=True), organizations=Count('pk'))
    totals.update(Board.objects.aggregate(
        war_boards=Count('pk', filter=Q(kind='war')),
        pirate_boards=Count('pk', filter=Q(kind='pirate'))))
    totals.update(Membership.objects.filter(status='active').aggregate(
        joined_users=Count('user_id', distinct=True)))
    totals.update(JoinApplication.objects.filter(status='pending').aggregate(
        pending_applicants=Count('user_id', distinct=True)))

    # One audit aggregate query covers all-time coverage and all three windows.
    aggregates = {'operation_users': Count('actor_id', distinct=True),
                  'first_operation_at': Min('created_at')}
    for period in periods:
        window = Q(created_at__gte=_stored_time(period['start_at']))
        prefix = period['key']
        aggregates[f'{prefix}_operation_users'] = Count('actor_id', distinct=True, filter=window)
        aggregates[f'{prefix}_operations'] = Count('pk', filter=window)
        aggregates[f'{prefix}_active_organizations'] = Count('organization_id', distinct=True, filter=window)
    activity = AuditLog.objects.filter(
        action__in=OPERATION_ACTIONS, created_at__lte=_stored_time(generated_at)).aggregate(**aggregates)
    totals['operation_users'] = activity['operation_users']
    for period in periods:
        period.update({metric: activity[f"{period['key']}_{metric}"]
                       for metric in ('operation_users', 'operations', 'active_organizations')})
        period['start_at'] = period['start_at'].isoformat()
        period['end_at'] = generated_at.isoformat()
    first_operation = activity['first_operation_at']
    return {
        'generated_at': generated_at.isoformat(),
        'timezone': 'Asia/Shanghai',
        'totals': totals,
        'periods': periods,
        'first_operation_at': _in_shanghai(first_operation).isoformat() if first_operation else None,
    }


class UsageOwnerPermission(BasePermission):
    def has_permission(self, request, view):
        return can_view_usage(request.user)


class ReadOnlyUsageView(PrivateView):
    http_method_names = ['get', 'head', 'options']


class UsageAccess(ReadOnlyUsageView):
    def get(self, request):
        return Response({'can_view_usage': can_view_usage(request.user)})


class UsageOverview(ReadOnlyUsageView):
    permission_classes = [IsAuthenticated, UsageOwnerPermission]

    def get(self, request):
        return Response(usage_overview())
