"""Private, read-only usage reporting over existing tactical records."""
from datetime import datetime, timedelta, timezone as datetime_timezone
from unittest.mock import patch
from uuid import uuid4
from zoneinfo import ZoneInfo

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from TacticalCollaboration.models import AuditLog, Board, JoinApplication, Membership, Organization


OWNER_EMAIL = '2235102484@qq.com'
ACCESS_URL = '/api/tactical/usage/access/'
OVERVIEW_URL = '/api/tactical/usage/overview/'
SHANGHAI = ZoneInfo('Asia/Shanghai')
NOW = datetime(2026, 9, 28, 0, 30, tzinfo=SHANGHAI)
ALLOWED_ACTIONS = (
    'report.create', 'report.update', 'report.move', 'report.withdraw', 'report.confirm',
    'force.create', 'force.update', 'force.move', 'force.archive',
    'sighting.create', 'sighting.withdraw',
)


class UsageCase(TestCase):
    def setUp(self):
        self.owner = get_user_model().objects.create_user(username='usage-owner', email=OWNER_EMAIL)
        self.other = get_user_model().objects.create_user(username='unrelated', email='other@example.com')
        self.client = APIClient()
        self.client.force_authenticate(self.owner)

    def assert_private(self, response):
        self.assertEqual(response['Cache-Control'], 'no-store, private')

    def capability(self, params=None):
        response = self.client.get(ACCESS_URL, params or {})
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_private(response)
        return response.data

    def overview(self, now=NOW):
        with patch('django.utils.timezone.now', return_value=now):
            response = self.client.get(OVERVIEW_URL)
        self.assertEqual(response.status_code, 200, response.content)
        self.assert_private(response)
        return response.data

    def organization(self, name='PRIVATE_ORGANIZATION', founder=None):
        return Organization.objects.create(name=name, founder=founder or self.owner)

    def audit(self, organization, action='report.create', actor=None, at=NOW):
        row = AuditLog.objects.create(organization=organization, actor=actor or self.owner,
                                      action=action, request_id=uuid4(),
                                      metadata={'secret': 'PRIVATE_AUDIT_NOTES'})
        AuditLog.objects.filter(pk=row.pk).update(created_at=at)
        return row


class UsageAccessTests(UsageCase):
    def test_anonymous_is_unauthorized_and_not_cacheable(self):
        self.client = APIClient()
        for url in (ACCESS_URL, OVERVIEW_URL):
            with self.subTest(url=url):
                response = self.client.get(url)
                self.assertEqual(response.status_code, 401)
                self.assert_private(response)

    def test_owner_capability_is_boolean_only(self):
        response = self.client.get(ACCESS_URL)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, {'can_view_usage': True})
        self.assert_private(response)

    def test_unrelated_users_and_administrators_have_no_bypass(self):
        for staff, superuser in ((False, False), (True, False), (True, True)):
            with self.subTest(staff=staff, superuser=superuser):
                get_user_model().objects.filter(pk=self.other.pk).update(is_staff=staff, is_superuser=superuser)
                self.other.refresh_from_db()
                self.client.force_authenticate(self.other)
                access = self.client.get(ACCESS_URL)
                self.assertEqual(access.status_code, 200)
                self.assertEqual(access.data, {'can_view_usage': False})
                denied = self.client.get(OVERVIEW_URL)
                self.assertEqual(denied.status_code, 403)
                self.assert_private(access)
                self.assert_private(denied)

    def test_inactive_owner_is_rechecked_against_database(self):
        get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
        self.assertTrue(self.owner.is_active)  # Simulate a stale authenticated principal.
        access = self.client.get(ACCESS_URL)
        self.assertEqual(access.status_code, 200)
        self.assertEqual(access.data, {'can_view_usage': False})
        response = self.client.get(OVERVIEW_URL)
        self.assertEqual(response.status_code, 403)
        self.assert_private(response)

    def test_changed_owner_email_revokes_stale_principal(self):
        get_user_model().objects.filter(pk=self.owner.pk).update(email='changed@example.com')
        self.assertEqual(self.capability(), {'can_view_usage': False})
        self.assertEqual(self.client.get(OVERVIEW_URL).status_code, 403)

    def test_deleted_owner_revokes_stale_principal(self):
        get_user_model().objects.filter(pk=self.owner.pk).delete()
        self.assertEqual(self.capability(), {'can_view_usage': False})
        self.assertEqual(self.client.get(OVERVIEW_URL).status_code, 403)

    def test_unique_owner_email_is_case_insensitive(self):
        get_user_model().objects.filter(pk=self.owner.pk).update(email=OWNER_EMAIL.upper())
        self.assertEqual(self.capability(), {'can_view_usage': True})
        self.overview()

    def test_ambiguous_owner_email_fails_closed_even_if_duplicate_inactive(self):
        duplicate = get_user_model().objects.create_user(username='duplicate', email=OWNER_EMAIL.upper())
        for active in (True, False):
            with self.subTest(active=active):
                get_user_model().objects.filter(pk=duplicate.pk).update(is_active=active)
                self.assertEqual(self.capability(), {'can_view_usage': False})
                response = self.client.get(OVERVIEW_URL)
                self.assertEqual(response.status_code, 403)
                self.assert_private(response)

    def test_client_email_or_owner_id_cannot_grant_access(self):
        self.other.email = OWNER_EMAIL
        self.client.force_authenticate(self.other)
        params = {'email': OWNER_EMAIL, 'user_id': self.owner.pk, 'can_view_usage': 'true'}
        self.assertEqual(self.capability(params), {'can_view_usage': False})
        self.assertEqual(self.client.get(OVERVIEW_URL, params).status_code, 403)

    def test_real_jwt_identity_not_email_claim_controls_authorization(self):
        self.client = APIClient()
        token = AccessToken.for_user(self.other)
        token['email'] = OWNER_EMAIL
        token['is_superuser'] = True
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token}')
        self.assertEqual(self.capability(), {'can_view_usage': False})
        self.assertEqual(self.client.get(OVERVIEW_URL).status_code, 403)
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {AccessToken.for_user(self.owner)}')
        self.assertEqual(self.capability(), {'can_view_usage': True})
        self.assertEqual(self.client.get(OVERVIEW_URL).status_code, 200)
        get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
        response = self.client.get(OVERVIEW_URL)
        self.assertEqual(response.status_code, 401)
        self.assert_private(response)

    def test_invalid_jwt_is_unauthorized_and_private(self):
        self.client = APIClient()
        token = str(AccessToken.for_user(self.other))
        self.client.credentials(HTTP_AUTHORIZATION=f'Bearer {token[:-5]}xxxxx')
        for url in (ACCESS_URL, OVERVIEW_URL):
            response = self.client.get(url)
            self.assertEqual(response.status_code, 401)
            self.assert_private(response)

    def test_only_safe_methods_are_supported(self):
        for url in (ACCESS_URL, OVERVIEW_URL):
            for method in ('post', 'put', 'patch', 'delete', 'trace'):
                with self.subTest(url=url, method=method):
                    response = getattr(self.client, method)(url)
                    self.assertEqual(response.status_code, 405)
                    self.assertEqual(set(response['Allow'].split(', ')), {'GET', 'HEAD', 'OPTIONS'})
                    self.assert_private(response)
            for method in ('head', 'options'):
                response = getattr(self.client, method)(url)
                self.assertEqual(response.status_code, 200)
                self.assert_private(response)
        self.client.force_authenticate(self.other)
        for method in ('head', 'options'):
            response = getattr(self.client, method)(OVERVIEW_URL)
            self.assertEqual(response.status_code, 403)
            self.assert_private(response)


class UsageAggregationTests(UsageCase):
    def test_empty_database_returns_complete_zero_schema(self):
        data = self.overview()
        self.assertEqual(set(data), {'generated_at', 'timezone', 'totals', 'periods', 'first_operation_at'})
        self.assertEqual(data['generated_at'], NOW.isoformat())
        self.assertEqual(data['timezone'], 'Asia/Shanghai')
        self.assertIsNone(data['first_operation_at'])
        self.assertEqual(data['totals'], {
            'creator_users': 0, 'organizations': 0, 'war_boards': 0, 'pirate_boards': 0,
            'joined_users': 0, 'pending_applicants': 0, 'operation_users': 0,
        })
        self.assertEqual([row['key'] for row in data['periods']], ['today', '7d', '30d'])
        for row in data['periods']:
            self.assertEqual(set(row), {'key', 'start_at', 'end_at', 'operation_users',
                                       'operations', 'active_organizations'})
            self.assertEqual((row['operation_users'], row['operations'], row['active_organizations']), (0, 0, 0))
            self.assertEqual(row['end_at'], NOW.isoformat())

    def test_totals_are_distinct_current_records_not_membership_or_board_events(self):
        first = self.organization()
        second = self.organization('PRIVATE_SECOND')
        third = self.organization('PRIVATE_THIRD', founder=self.other)
        removed = get_user_model().objects.create_user(username='removed')
        pending = get_user_model().objects.create_user(username='pending')
        for org in (first, second):
            Membership.objects.create(organization=org, user=self.owner, role='founder')
            Membership.objects.create(organization=org, user=self.other)
            Membership.objects.create(organization=org, user=removed, status='removed')
            JoinApplication.objects.create(organization=org, user=pending)
            JoinApplication.objects.create(organization=org, user=self.other)
            JoinApplication.objects.create(organization=org, user=removed, status='rejected')
            JoinApplication.objects.create(organization=org, user=self.owner, status='approved')
        Board.objects.create(organization=first, name='PRIVATE_WAR', kind='war')
        Board.objects.create(organization=second, name='PRIVATE_WAR', kind='war')
        Board.objects.create(organization=third, name='PRIVATE_PIRATE', kind='pirate')
        self.audit(first)
        self.audit(second)
        self.audit(third, actor=self.other)
        data = self.overview()
        self.assertEqual(data['totals'], {
            'creator_users': 2, 'organizations': 3, 'war_boards': 2, 'pirate_boards': 1,
            'joined_users': 2, 'pending_applicants': 2, 'operation_users': 2,
        })
        self.assertEqual(data['periods'][0]['active_organizations'], 3)
        self.assertEqual(data['periods'][0]['operations'], 3)
        self.assertEqual(data['periods'][0]['operation_users'], 2)

    def test_only_explicit_successful_operation_actions_count(self):
        org = self.organization()
        for action in ALLOWED_ACTIONS:
            self.audit(org, action=action)
        for action in ('scope.update', 'organization.create', 'board.create', 'invite.create',
                       'join.review', 'member.role', 'member.remove', 'member.restore',
                       'report.read', 'report.create.failed', 'force.delete', 'sighting.update'):
            self.audit(org, action=action, actor=self.other, at=NOW - timedelta(days=40))
        data = self.overview()
        self.assertEqual(data['totals']['operation_users'], 1)
        self.assertEqual(data['first_operation_at'], NOW.isoformat())
        for row in data['periods']:
            self.assertEqual(row['operations'], len(ALLOWED_ACTIONS))
            self.assertEqual(row['operation_users'], 1)

    def test_payload_contains_only_aggregates_and_timestamps(self):
        org = self.organization()
        self.audit(org)
        data = self.overview()
        self.assertNotIn('PRIVATE', str(data))
        self.assertNotIn(OWNER_EMAIL, str(data))
        self.assertEqual(set(data), {'generated_at', 'timezone', 'totals', 'periods', 'first_operation_at'})
        self.assertTrue(all(type(value) is int for value in data['totals'].values()))
        for row in data['periods']:
            self.assertEqual(set(row), {'key', 'start_at', 'end_at', 'operation_users',
                                       'operations', 'active_organizations'})

    def test_reads_never_write_or_backfill_and_query_count_does_not_grow(self):
        self.organization('PRIVATE_LEGACY_WITHOUT_BOARD')
        with CaptureQueriesContext(connection) as small:
            self.overview()
        for index in range(25):
            org = self.organization(f'PRIVATE_LEGACY_{index}')
            self.audit(org)
        with CaptureQueriesContext(connection) as large:
            self.overview()
        self.assertEqual(len(large), len(small))
        self.assertLessEqual(len(large), 8)
        self.assertEqual(Board.objects.count(), 0)
        with CaptureQueriesContext(connection) as access:
            response = self.client.get(ACCESS_URL)
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(len(access), 2)
        for row in [*small, *large, *access]:
            self.assertTrue(row['sql'].lstrip().upper().startswith('SELECT'), row['sql'])
            self.assertNotIn('FOR UPDATE', row['sql'].upper())


class UsageTimeBoundaryTests(UsageCase):
    def assert_calendar_boundaries(self, use_tz):
        org = self.organization()
        midnight = NOW.replace(hour=0, minute=0)
        seventh = midnight - timedelta(days=6)
        thirtieth = midnight - timedelta(days=29)

        def stored(moment):
            return moment.astimezone(datetime_timezone.utc) if use_tz else moment.replace(tzinfo=None)

        for moment in (midnight - timedelta(microseconds=1), midnight,
                       seventh - timedelta(microseconds=1), seventh,
                       thirtieth - timedelta(microseconds=1), thirtieth, NOW):
            self.audit(org, at=stored(moment))
        future_org = self.organization('PRIVATE_FUTURE')
        self.audit(future_org, actor=self.other, at=stored(NOW + timedelta(microseconds=1)))
        data = self.overview(now=stored(NOW))
        self.assertEqual(data['generated_at'], NOW.isoformat())
        self.assertEqual(data['first_operation_at'], (thirtieth - timedelta(microseconds=1)).isoformat())
        self.assertEqual(data['totals']['operation_users'], 1)
        for row, start, operations in zip(data['periods'], (midnight, seventh, thirtieth), (2, 4, 6)):
            self.assertEqual(row['start_at'], start.isoformat())
            self.assertEqual(row['end_at'], NOW.isoformat())
            self.assertEqual(row['operations'], operations)
            self.assertEqual(row['operation_users'], 1)
            self.assertEqual(row['active_organizations'], 1)

    @override_settings(USE_TZ=True, TIME_ZONE='UTC')
    def test_aware_utc_records_use_shanghai_calendar_boundaries(self):
        self.assert_calendar_boundaries(use_tz=True)

    @override_settings(USE_TZ=False, TIME_ZONE='Asia/Shanghai')
    def test_naive_production_records_use_same_shanghai_calendar_boundaries(self):
        self.assert_calendar_boundaries(use_tz=False)

    def test_future_only_events_are_not_coverage_or_usage(self):
        self.audit(self.organization(), at=NOW + timedelta(seconds=1))
        data = self.overview()
        self.assertIsNone(data['first_operation_at'])
        self.assertEqual(data['totals']['operation_users'], 0)
        self.assertTrue(all(row['operations'] == 0 for row in data['periods']))

    def test_historical_operation_user_is_counted_without_recent_activity(self):
        first = NOW - timedelta(days=500)
        self.audit(self.organization(), at=first)
        data = self.overview()
        self.assertEqual(data['totals']['operation_users'], 1)
        self.assertEqual(data['first_operation_at'], first.isoformat())
        self.assertTrue(all(row['operation_users'] == 0 for row in data['periods']))
