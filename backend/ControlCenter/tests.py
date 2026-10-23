"""Real disposable accounts, JWTs and history files; never production data."""
import tempfile
import time
from datetime import datetime, timezone as datetime_timezone
from pathlib import Path
from unittest.mock import patch

from django.apps import apps
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import DatabaseError, IntegrityError
from django.test import TestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from AnomalyHotspots.history import record_success, record_attempt
from AnomalyHotspots.snapshot import write_success
from AnomalyHotspots.tests.test_metric_contract import legacy_sample


class ControlCenterTests(TestCase):
    def setUp(self):
        cache.clear()
        users = get_user_model().objects
        self.owner = users.create_user('owner', email='2235102484@qq.com', password='test')
        self.viewer = users.create_user('viewer', email='viewer@example.com', password='test')
        self.ordinary = users.create_user('ordinary', email='ordinary@example.com', password='test')
        self.staff = users.create_user('staff', email='staff@example.com', password='test', is_staff=True)
        self.superuser = users.create_user('superuser', email='super@example.com', password='test', is_staff=True, is_superuser=True)
        self.inactive = users.create_user('inactive', email='inactive@example.com', password='test', is_active=False)
        self.config = override_settings(CONTROL_CENTER_OWNER_ID=self.owner.pk)
        self.config.enable()
        self.addCleanup(self.config.disable)
        self.client = APIClient()

    def auth(self, user):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + str(AccessToken.for_user(user)))

    def private_headers(self, response):
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertIn('Authorization', response['Vary'])

    def grant(self, user=None, enabled=True, version=0, **extra):
        return self.client.put('/api/control-center/grants/%s/' % (user or self.viewer).pk,
                               {'enabled': enabled, 'version': version, **extra}, format='json')

    def models(self):
        return apps.get_model('ControlCenter', 'FeatureGrant'), apps.get_model('ControlCenter', 'GrantAudit')

    def test_access_owner_and_default_denial(self):
        for user, manage in [(self.owner, True), (self.staff, False), (self.superuser, False), (self.ordinary, False)]:
            self.auth(user)
            response = self.client.get('/api/control-center/access/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json(), {'can_manage': manage, 'can_view_hotspot_changes': manage})
            self.private_headers(response)

    def test_anonymous_and_invalid_jwt_have_private_headers(self):
        for credentials in [None, 'Bearer invalid']:
            self.client.credentials(**({'HTTP_AUTHORIZATION': credentials} if credentials else {}))
            for path in ['/api/control-center/access/', '/api/control-center/overview/', '/api/anomaly-hotspots/changes/']:
                response = self.client.get(path)
                self.assertEqual(response.status_code, 401)
                self.private_headers(response)

    def test_owner_config_missing_or_invalid_fails_closed(self):
        self.auth(self.owner)
        for value in ['', None, '0', 0, True, 'x', self.staff.pk]:
            with self.subTest(value=value), override_settings(CONTROL_CENTER_OWNER_ID=value):
                self.assertEqual(self.client.get('/api/control-center/access/').json(),
                                 {'can_manage': False, 'can_view_hotspot_changes': False})

    def test_email_reassignment_and_inactive_duplicate_fail_closed(self):
        self.auth(self.owner)
        self.owner.email = 'former@example.com'
        self.owner.save(update_fields=['email'])
        self.staff.email = '2235102484@qq.com'
        self.staff.save(update_fields=['email'])
        self.assertFalse(self.client.get('/api/control-center/access/').json()['can_manage'])
        self.staff.email = 'staff@example.com'
        self.staff.save(update_fields=['email'])
        self.owner.email = '2235102484@qq.com'
        self.owner.save(update_fields=['email'])
        # SQLite email matching is case-insensitive for iexact, while uniqueness
        # itself permits a distinct uppercase value, modeling ambiguous data.
        self.inactive.email = '2235102484@QQ.COM'
        self.inactive.save(update_fields=['email'])
        self.assertFalse(self.client.get('/api/control-center/access/').json()['can_manage'])

    def test_stale_principal_is_not_owner_authority(self):
        from ControlCenter.access import is_owner
        self.owner.is_active = False
        get_user_model().objects.filter(pk=self.owner.pk).update(is_active=False)
        self.owner.is_active = True
        self.assertFalse(is_owner(self.owner))

    def test_grant_revoke_is_immediate_for_same_old_jwt(self):
        self.auth(self.owner)
        response = self.grant(reason='允许查看')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['grant'], {'enabled': True, 'version': 1})
        self.viewer.refresh_from_db()
        self.assertFalse(self.viewer.is_staff)
        self.assertFalse(self.viewer.is_superuser)
        viewer_token = str(AccessToken.for_user(self.viewer))
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + viewer_token)
        self.assertEqual(self.client.get('/api/control-center/access/').json(),
                         {'can_manage': False, 'can_view_hotspot_changes': True})
        self.assertEqual(self.client.get('/api/anomaly-hotspots/changes/').status_code, 200)
        self.auth(self.owner)
        self.assertEqual(self.grant(enabled=False, version=1).status_code, 200)
        self.client.credentials(HTTP_AUTHORIZATION='Bearer ' + viewer_token)
        response = self.client.get('/api/anomaly-hotspots/changes/')
        self.assertEqual(response.status_code, 403)
        self.private_headers(response)

    def test_denial_happens_before_history_or_metadata_access(self):
        self.auth(self.ordinary)
        with patch('AnomalyHotspots.history.read_changes', side_effect=AssertionError('must not read')), \
             patch('AnomalyHotspots.private_views.system_metadata', side_effect=AssertionError('must not enrich')):
            response = self.client.get('/api/anomaly-hotspots/changes/')
        self.assertEqual(response.status_code, 403)

    def test_owner_only_management_routes(self):
        for user in [self.staff, self.superuser, self.ordinary, self.viewer]:
            self.auth(user)
            for path in ['users/?q=viewer@example.com', 'grants/', 'audit/', 'overview/']:
                response = self.client.get('/api/control-center/' + path)
                self.assertEqual(response.status_code, 403)
                self.private_headers(response)
            self.assertEqual(self.grant().status_code, 403)

    def test_noop_keeps_version_and_audit_count(self):
        self.auth(self.owner)
        self.assertEqual(self.grant(enabled=False).json()['grant'], {'enabled': False, 'version': 0})
        Grant, Audit = self.models()
        self.assertEqual(Grant.objects.count(), 0)
        self.assertEqual(Audit.objects.count(), 0)
        self.assertEqual(self.grant().status_code, 200)
        self.assertEqual(self.grant(version=1).json()['grant']['version'], 1)
        self.assertEqual(Audit.objects.count(), 1)

    def test_stale_version_conflicts_and_does_not_write(self):
        self.auth(self.owner)
        self.assertEqual(self.grant().status_code, 200)
        response = self.grant(enabled=False)
        self.assertEqual(response.status_code, 409)
        self.private_headers(response)
        Grant, Audit = self.models()
        self.assertTrue(Grant.objects.get(user=self.viewer).enabled)
        self.assertEqual(Audit.objects.count(), 1)

    def test_invalid_payload_and_targets_are_rejected(self):
        self.auth(self.owner)
        for payload in [{'enabled': 1, 'version': 0}, {'enabled': True, 'version': True},
                        {'enabled': True, 'version': -1}, {'enabled': True, 'version': 0, 'capability': 'staff'},
                        {'enabled': True, 'version': 0, 'reason': 'x' * 501}, {'enabled': True}]:
            response = self.client.put('/api/control-center/grants/%s/' % self.viewer.pk, payload, format='json')
            self.assertEqual(response.status_code, 400)
            self.private_headers(response)
        self.assertEqual(self.grant(user=self.owner).status_code, 400)
        self.assertEqual(self.grant(user=self.inactive).status_code, 404)
        self.assertEqual(self.client.put('/api/control-center/grants/99999/', {'enabled': True, 'version': 0}, format='json').status_code, 404)

    def test_audit_is_safe_append_only_and_transactional(self):
        self.auth(self.owner)
        self.assertEqual(self.grant(reason='test reason').status_code, 200)
        Grant, Audit = self.models()
        audit = Audit.objects.get()
        self.assertEqual((audit.before_enabled, audit.after_enabled, audit.before_version, audit.after_version),
                         (False, True, 0, 1))
        self.assertEqual(audit.actor_id, self.owner.pk)
        self.assertEqual(audit.target_id, self.viewer.pk)
        self.assertEqual(audit.reason, 'test reason')
        with self.assertRaises(ValueError):
            audit.save()
        with self.assertRaises(ValueError):
            audit.delete()
        with patch.object(Audit.objects, 'create', side_effect=IntegrityError('audit unavailable')):
            response = self.grant(enabled=False, version=1)
        self.assertEqual(response.status_code, 503)
        self.assertTrue(Grant.objects.get(user=self.viewer).enabled)
        self.assertEqual(Grant.objects.get(user=self.viewer).version, 1)
        self.assertEqual(Audit.objects.count(), 1)

    def test_owner_rechecked_inside_transaction(self):
        self.auth(self.owner)
        from ControlCenter import views
        original = views.is_owner
        calls = []
        def owner_once(user, **kwargs):
            calls.append(True)
            return original(user, **kwargs) if len(calls) == 1 else False
        with patch('ControlCenter.views.is_owner', side_effect=owner_once):
            self.assertEqual(self.grant().status_code, 403)
        self.assertGreaterEqual(len(calls), 2)
        self.assertEqual(self.models()[0].objects.count(), 0)

    def test_user_lookup_requires_exact_email_or_id(self):
        self.auth(self.owner)
        for query in ['viewer@example.com', str(self.viewer.pk), 'VIEWER@example.com']:
            response = self.client.get('/api/control-center/users/', {'q': query})
            self.assertEqual(response.status_code, 200)
            self.assertEqual([row['id'] for row in response.json()['results']], [self.viewer.pk])
        for query in ['', 'view', 'x' * 255]:
            self.assertEqual(self.client.get('/api/control-center/users/', {'q': query}).status_code, 400)
        self.assertEqual(self.client.get('/api/control-center/users/?q=1&q=2').status_code, 400)
        self.assertEqual(self.client.get('/api/control-center/users/?q=1&extra=x').status_code, 400)

    def test_grants_and_audit_list_cursor_and_safe_shape(self):
        self.auth(self.owner)
        self.grant()
        response = self.client.get('/api/control-center/grants/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'][0], {'id': self.viewer.pk, 'username': 'viewer',
                         'email': 'viewer@example.com', 'grant': {'enabled': True, 'version': 1}})
        response = self.client.get('/api/control-center/audit/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.json()['results']), 1)
        self.assertNotIn('password', response.content.decode())
        for path in ['grants/', 'audit/']:
            self.assertEqual(self.client.get('/api/control-center/' + path + '?before_id=-1').status_code, 400)

    def test_private_changes_preserve_signed_grade_movement_and_metadata(self):
        self.auth(self.owner)
        with tempfile.TemporaryDirectory() as directory:
            Path(directory).chmod(0o750)
            now = int(time.time() * 1000)
            record_success(directory, [{'solar_system_id': 1, 'destroy_num': 0}, {'solar_system_id': 2, 'destroy_num': 5}], now_ms=now - 600000)
            record_success(directory, [{'solar_system_id': 1, 'destroy_num': 5}, {'solar_system_id': 2, 'destroy_num': 0}], now_ms=now)
            with override_settings(ANOMALY_HISTORY_DIR=directory):
                response = self.client.get('/api/anomaly-hotspots/changes/')
            self.assertEqual(response.status_code, 200)
            body = response.json()
            self.assertEqual(body['interval']['elapsed_ms'], 600000)
            self.assertEqual([row['delta'] for row in body['systems']], [5, -5])
            self.assertEqual(body['version'], 2)
            self.assertEqual(body['metric'], {'kind': 'activity_level', 'range_version': 1})
            self.assertEqual(body['systems'][0]['system_name'], None)
            self.assertEqual(body['coverage']['negative'], 1)
            self.assertIsNone(body['statistics_window'])
            self.private_headers(response)

    def test_changes_query_validation_and_safe_unavailable(self):
        self.auth(self.owner)
        for query in ['limit=101', 'limit=0', 'limit=01', 'interval=-1', 'before=1e3', 'interval=1&interval=2',
                      'unknown=1', 'limit=１', 'limit=1.0']:
            response = self.client.get('/api/anomaly-hotspots/changes/?' + query)
            self.assertEqual(response.status_code, 400, query)
            self.private_headers(response)
        self.assertEqual(self.client.get('/api/anomaly-hotspots/changes/').json()['status'], 'unavailable')
        with tempfile.TemporaryDirectory() as directory, override_settings(ANOMALY_HISTORY_DIR=directory):
            Path(directory).chmod(0o750)
            Path(directory, 'manifest.json').write_text('private invalid data')
            response = self.client.get('/api/anomaly-hotspots/changes/')
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(directory, response.content.decode())
            self.private_headers(response)

    def test_overview_safe_stored_read_and_original_module_guards(self):
        self.auth(self.owner)
        response = self.client.get('/api/control-center/overview/')
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['collection']['history_status'], 'unavailable')
        modules = {row['key']: row for row in body['modules']}
        self.assertNotIn('killboard', modules)
        self.assertFalse(modules['license']['allowed'])
        self.assertFalse(modules['fraud']['allowed'])
        self.owner.is_staff = True
        self.owner.save(update_fields=['is_staff'])
        # Installed-app checks still deny links to unavailable modules.
        self.assertFalse({row['key']: row for row in self.client.get('/api/control-center/overview/').json()['modules']}['license']['allowed'])

    def test_public_snapshot_contract_has_explicit_unknown_metric_without_private_data(self):
        self.client.credentials()
        response = self.client.get('/api/anomaly-hotspots/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(set(response.json()), {'version', 'collected_at_ms', 'last_attempt_at_ms', 'status', 'systems', 'statistics_window', 'metric'})
        self.assertEqual(response.json()['metric'], {'kind': 'legacy_unclassified', 'range_version': None})
        self.assertEqual(response['Cache-Control'], 'no-store')

    @patch('rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES', {'control_center_access': '1/hour'})
    def test_throttled_response_has_private_headers(self):
        self.auth(self.owner)
        self.assertEqual(self.client.get('/api/control-center/access/').status_code, 200)
        response = self.client.get('/api/control-center/access/')
        self.assertEqual(response.status_code, 429)
        self.private_headers(response)

    def test_first_grant_locks_user_before_querying_or_creating_grant(self):
        self.auth(self.owner)
        from django.db.models.query import QuerySet
        original = QuerySet.select_for_update
        events = []
        def tracked(queryset, *args, **kwargs):
            events.append(queryset.model._meta.label)
            return original(queryset, *args, **kwargs)
        with patch.object(QuerySet, 'select_for_update', tracked):
            self.assertEqual(self.grant().status_code, 200)
        self.assertEqual(events, ['Authentication.EVEMUser', 'Authentication.EVEMUser', 'ControlCenter.FeatureGrant'])

    def test_audit_bulk_update_and_delete_are_denied(self):
        self.auth(self.owner)
        self.grant()
        Audit = self.models()[1]
        with self.assertRaises(ValueError):
            Audit.objects.all().update(reason='rewritten')
        with self.assertRaises(ValueError):
            Audit.objects.all().delete()

    def test_inactive_grantee_and_stale_principal_are_denied(self):
        from ControlCenter.access import can_view_changes
        self.auth(self.owner)
        self.grant()
        get_user_model().objects.filter(pk=self.viewer.pk).update(is_active=False)
        self.assertFalse(can_view_changes(self.viewer))
        self.auth(self.viewer)
        response = self.client.get('/api/anomaly-hotspots/changes/')
        self.assertEqual(response.status_code, 401)
        self.private_headers(response)

    def test_one_sample_baseline_and_missing_interval_do_not_fabricate_delta(self):
        self.auth(self.owner)
        with tempfile.TemporaryDirectory() as directory, override_settings(ANOMALY_HISTORY_DIR=directory):
            Path(directory).chmod(0o750)
            record_success(directory, [{'solar_system_id': 1, 'destroy_num': 5}])
            response = self.client.get('/api/anomaly-hotspots/changes/')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['status'], 'baseline')
            self.assertEqual(response.json()['systems'], [])
            response = self.client.get('/api/anomaly-hotspots/changes/?interval=123')
            self.assertEqual(response.status_code, 404)
            self.private_headers(response)

    def test_overview_keeps_success_and_source_failure_separate(self):
        self.auth(self.owner)
        with tempfile.TemporaryDirectory() as directory:
            Path(directory).chmod(0o750)
            snapshot = str(Path(directory, 'snapshot.json'))
            history = Path(directory, 'history')
            history.mkdir(mode=0o750)
            now = int(time.time() * 1000)
            rows = [{'solar_system_id': 1, 'destroy_num': 5}]
            write_success(snapshot, rows, now_ms=now)
            record_success(history, rows, now_ms=now - 600000)
            record_success(history, rows, now_ms=now)
            record_attempt(history, 'rate_limited', now_ms=now + 1, audit={'rpc_count': 1, 'reason': 'rate_limited'},
                           session_slot='B', pool_size=7, history_status='ok')
            with override_settings(ANOMALY_HISTORY_DIR=str(history), ANOMALY_SNAPSHOT_FILE=snapshot):
                response = self.client.get('/api/control-center/overview/')
            body = response.json()['collection']
            self.assertEqual(body['status'], 'ok')
            self.assertEqual(body['history_status'], 'ok')
            self.assertEqual(body['system_count'], 1)
            self.assertEqual(body['attempts'][0]['status'], 'rate_limited')
            self.assertEqual(body['latest_interval']['elapsed_ms'], 600000)
            self.assertNotIn(directory, response.content.decode())

    def test_private_legacy_and_mixed_intervals_are_explicitly_incomparable(self):
        self.auth(self.owner)
        with tempfile.TemporaryDirectory() as directory, override_settings(ANOMALY_HISTORY_DIR=directory):
            parent = Path(directory)
            parent.chmod(0o750)
            now = int(time.time() * 1000)
            entries = []
            legacy_sample(parent, now - 1200000, 155, entries)
            legacy_sample(parent, now - 600000, 1, entries)
            record_success(parent, [{'solar_system_id': 30001211, 'destroy_num': 5}], now_ms=now)
            for selected in (now - 600000, now):
                response = self.client.get('/api/anomaly-hotspots/changes/', {'interval': selected, 'limit': 1})
                self.assertEqual(response.status_code, 200)
                body = response.json()
                self.assertEqual(body['version'], 2)
                self.assertEqual(body['metric'], {'kind': 'legacy_unclassified', 'range_version': None})
                self.assertEqual(body['status'], 'incomparable')
                self.assertEqual(body['systems'], [])
                self.assertEqual(body['interval']['id'], selected)
                self.assertEqual(body['interval']['elapsed_ms'], 600000)
                self.assertTrue(body['intervals'])
                self.assertNotIn(directory, response.content.decode())
                self.private_headers(response)
            self.auth(self.ordinary)
            denied = self.client.get('/api/anomaly-hotspots/changes/')
            self.assertEqual(denied.status_code, 403)
            self.private_headers(denied)

    def test_no_management_read_changes_killboard_flags_or_account_roles(self):
        self.auth(self.owner)
        self.client.get('/api/control-center/access/')
        self.client.get('/api/control-center/overview/')
        self.grant()
        from django.conf import settings
        self.assertEqual(settings.KILLBOARD_OWNER_EMAIL, '')
        self.assertFalse(settings.KILLBOARD_COLLECTION_ENABLED)
        self.viewer.refresh_from_db()
        self.assertFalse(self.viewer.is_staff)
        self.assertEqual(self.viewer.user_permissions.count(), 0)

    def test_exhausted_version_does_not_increment_past_safe_integer(self):
        self.auth(self.owner)
        Grant, Audit = self.models()
        Grant.objects.create(user=self.viewer, capability='hotspot_changes.view', enabled=True,
                             version=9007199254740991, updated_by=self.owner)
        response = self.grant(enabled=False, version=9007199254740991)
        self.assertEqual(response.status_code, 409)
        self.assertTrue(Grant.objects.get(user=self.viewer).enabled)
        self.assertEqual(Audit.objects.count(), 0)

    def test_huge_or_zero_target_id_is_rejected_before_target_database_query(self):
        self.auth(self.owner)
        for identifier in ['0', '9007199254740992', '9' * 100]:
            response = self.client.put('/api/control-center/grants/' + identifier + '/',
                                       {'enabled': True, 'version': 0}, format='json')
            self.assertEqual(response.status_code, 400)
            self.private_headers(response)

    def test_management_database_failures_return_private_safe_unavailable(self):
        self.auth(self.owner)
        for path, module in [('grants/', 'FeatureGrant'), ('audit/', 'GrantAudit')]:
            with patch('ControlCenter.models.' + module + '.objects.using', side_effect=DatabaseError('private database details')):
                response = self.client.get('/api/control-center/' + path)
            self.assertEqual(response.status_code, 503)
            self.assertNotIn('private database details', response.content.decode())
            self.private_headers(response)

    @patch('rest_framework.throttling.ScopedRateThrottle.THROTTLE_RATES',
           {'control_center_access': '1/hour', 'anomaly_changes': '1/hour', 'control_center': '1/hour'})
    def test_capability_polling_changes_and_owner_reads_have_independent_budgets(self):
        self.auth(self.owner)
        paths = ['/api/control-center/access/', '/api/anomaly-hotspots/changes/', '/api/control-center/overview/']
        for path in paths:
            self.assertEqual(self.client.get(path).status_code, 200)
        for path in paths:
            response = self.client.get(path)
            self.assertEqual(response.status_code, 429)
            self.private_headers(response)

    def test_selected_interval_unavailable_with_history_disabled_is_not_success(self):
        self.auth(self.owner)
        response = self.client.get('/api/anomaly-hotspots/changes/?interval=123')
        self.assertEqual(response.status_code, 404)
        self.private_headers(response)

    def test_audit_new_instance_cannot_overwrite_existing_primary_key(self):
        self.auth(self.owner)
        self.grant()
        Audit = self.models()[1]
        old = Audit.objects.get()
        replacement = Audit(pk=old.pk, actor=self.owner, target=self.viewer, before_enabled=False,
                            after_enabled=False, before_version=0, after_version=1, reason='replacement',
                            created_at=old.created_at)
        from django.db import transaction
        with self.assertRaises(IntegrityError), transaction.atomic():
            replacement.save()
        old.refresh_from_db()
        self.assertTrue(old.after_enabled)

    def test_owner_check_fails_closed_without_control_center_app(self):
        from ControlCenter.access import is_owner
        with patch('ControlCenter.access.apps.is_installed', return_value=False):
            self.assertFalse(is_owner(self.owner))

    def test_list_pages_are_bounded_and_do_not_repeat_rows(self):
        self.auth(self.owner)
        User = get_user_model()
        User.objects.bulk_create([User(username='page-%s' % index, email='page-%s@example.com' % index)
                                  for index in range(101)])
        users = list(User.objects.filter(username__startswith='page-'))
        Grant, Audit = self.models()
        Grant.objects.bulk_create([Grant(user=user, capability='hotspot_changes.view', enabled=True, version=1)
                                   for user in users])
        Audit.objects.bulk_create([Audit(actor=self.owner, target=user, before_enabled=False, after_enabled=True,
                                        before_version=0, after_version=1) for user in users])
        for path, identifier in [('grants/', 'id'), ('audit/', 'id')]:
            first = self.client.get('/api/control-center/' + path).json()
            self.assertEqual(len(first['results']), 100)
            self.assertIsNotNone(first['next_before'])
            second = self.client.get('/api/control-center/' + path, {'before_id': first['next_before']}).json()
            self.assertEqual(len(second['results']), 1)
            self.assertIsNone(second['next_before'])
            self.assertTrue({row[identifier] for row in first['results']}.isdisjoint(
                            {row[identifier] for row in second['results']}))

    def test_failed_first_audit_rolls_back_new_grant_row(self):
        self.auth(self.owner)
        Grant, Audit = self.models()
        with patch.object(Audit.objects, 'create', side_effect=IntegrityError('audit unavailable')):
            response = self.grant()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(Grant.objects.count(), 0)
        self.assertEqual(Audit.objects.count(), 0)

    def test_malformed_json_is_private_and_does_not_mutate(self):
        self.auth(self.owner)
        response = self.client.put('/api/control-center/grants/%s/' % self.viewer.pk,
                                   '{"enabled":', content_type='application/json')
        self.assertEqual(response.status_code, 400)
        self.private_headers(response)
        self.assertEqual(self.models()[0].objects.count(), 0)

    def test_grantee_cannot_manage_or_delegate_permissions(self):
        self.auth(self.owner)
        self.grant()
        self.auth(self.viewer)
        self.assertEqual(self.grant(user=self.ordinary).status_code, 403)
        self.assertEqual(self.client.get('/api/control-center/users/', {'q': self.ordinary.pk}).status_code, 403)

    def test_audit_upsert_cannot_rewrite_existing_request(self):
        self.auth(self.owner)
        self.grant(reason='original')
        Audit = self.models()[1]
        original = Audit.objects.get()
        replacement = Audit(actor=self.owner, target=self.viewer, before_enabled=False,
                            after_enabled=True, before_version=0, after_version=1,
                            request_id=original.request_id, reason='rewritten')
        with self.assertRaises(ValueError):
            Audit.objects.bulk_create([replacement], update_conflicts=True,
                                      update_fields=['reason'], unique_fields=['request_id'])
        original.refresh_from_db()
        self.assertEqual(original.reason, 'original')

    def test_audit_plain_bulk_insert_and_ignore_conflicts_preserve_records(self):
        self.auth(self.owner)
        self.grant(reason='original')
        Audit = self.models()[1]
        original = Audit.objects.get()
        duplicate = Audit(actor=self.owner, target=self.viewer, before_enabled=False,
                          after_enabled=True, before_version=0, after_version=1,
                          request_id=original.request_id, reason='rewritten')
        Audit.objects.bulk_create([duplicate], ignore_conflicts=True)
        self.assertEqual(Audit.objects.count(), 1)
        original.refresh_from_db()
        self.assertEqual(original.reason, 'original')

    @override_settings(USE_TZ=False)
    def test_naive_production_audit_time_is_explicit_shanghai_not_client_local(self):
        self.auth(self.owner)
        stamp = datetime(2026, 10, 15, 15, 25, 30)
        with patch('django.utils.timezone.now', return_value=stamp):
            self.grant()
        with timezone.override('America/New_York'):
            response = self.client.get('/api/control-center/audit/')
        self.assertEqual(response.json()['results'][0]['created_at'], '2026-10-15T15:25:30+08:00')

    def test_aware_utc_audit_time_is_explicit_shanghai(self):
        self.auth(self.owner)
        stamp = datetime(2026, 10, 15, 7, 25, 30, tzinfo=datetime_timezone.utc)
        with patch('django.utils.timezone.now', return_value=stamp):
            self.grant()
        response = self.client.get('/api/control-center/audit/')
        self.assertEqual(response.json()['results'][0]['created_at'], '2026-10-15T15:25:30+08:00')
