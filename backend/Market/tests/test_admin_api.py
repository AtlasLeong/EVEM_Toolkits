from datetime import datetime, timezone

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.test import TestCase
from rest_framework.test import APIClient

from Market.models import CollectionRun, MarketConfig, MarketConfigAudit, MarketItem


def iso(epoch_millis):
    return datetime.fromtimestamp(epoch_millis / 1000, timezone.utc).isoformat().replace('+00:00', 'Z')


class MarketAdminAPITests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='market-admin', password='test-only')
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def allow(self, model):
        permission = Permission.objects.get(content_type__app_label='Market', codename=f'change_{model}')
        self.user.user_permissions.add(permission)
        self.user = get_user_model().objects.get(pk=self.user.pk)
        self.client.force_authenticate(user=self.user)

    def test_admin_reads_require_staff_but_no_change_permission(self):
        self.assertEqual(APIClient().get('/api/market/admin/config/').status_code, 401)
        self.user.is_staff = False
        self.user.save(update_fields=['is_staff'])
        self.assertEqual(self.client.get('/api/market/admin/config/').status_code, 403)
        self.user.is_staff = True
        self.user.save(update_fields=['is_staff'])

        response = self.client.get('/api/market/admin/config/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['min_interval_seconds'], 2100)
        self.assertEqual(response.json()['max_interval_seconds'], 3060)
        self.assertEqual(response.json()['session_status'], 'unconfigured')
        self.assertTrue(response.json()['enabled'])
        self.assertIsNone(response.json()['next_run_at'])
        self.assertEqual(response.json()['enabled_item_count'], 0)
        self.assertEqual(response.json()['max_items_per_run'], 80)
        self.assertEqual(response.json()['configured_max_items_per_run'], 80)
        self.assertFalse(response.json()['batch_fallback_reason'])
        self.assertIsNone(response.json()['batch_fallback_until_ms'])
        self.assertEqual(response.json()['query_delay_min_seconds'], 2.0)
        self.assertEqual(response.json()['query_delay_max_seconds'], 3.0)
        self.assertEqual(response.json()['run_time_budget_seconds'], 480)

    def test_config_reports_selected_catalog_size_for_rotation_warning(self):
        MarketItem.objects.bulk_create([
            MarketItem(id=item_id, name=f'Item {item_id}', enabled=item_id <= 81)
            for item_id in range(1, 84)
        ])

        response = self.client.get('/api/market/admin/config/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['enabled_item_count'], 81)
        self.assertEqual(response.json()['max_items_per_run'], 80)

    def test_config_patch_requires_change_permission_and_audits_bounded_changes(self):
        url = '/api/market/admin/config/'
        self.assertEqual(self.client.patch(url, {'min_interval_seconds': 2400}, format='json').status_code, 403)
        self.allow('marketconfig')
        self.assertEqual(self.client.patch(url, {'min_interval_seconds': 2000}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'max_interval_seconds': 3100}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, {'min_interval_seconds': 3000, 'max_interval_seconds': 2900}, format='json').status_code, 400)
        self.assertEqual(self.client.patch(url, [{'enabled': False}], format='json').status_code, 400)

        response = self.client.patch(url, {
            'min_interval_seconds': 2400, 'max_interval_seconds': 3000, 'enabled': False,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        config = MarketConfig.objects.get(pk=1)
        self.assertEqual((config.min_interval_seconds, config.max_interval_seconds, config.enabled), (2400, 3000, False))
        audit = MarketConfigAudit.objects.get()
        self.assertEqual(audit.actor, self.user)
        self.assertEqual(audit.before['min_interval_seconds'], 2100)
        self.assertEqual(audit.after['min_interval_seconds'], 2400)
        self.assertEqual(MarketConfigAudit.objects.count(), 1)
        self.assertEqual(self.client.patch(url, {'session_status': 'ready'}, format='json').status_code, 400)

    def test_capacity_patch_accepts_only_40_or_80_and_audits_the_setting(self):
        url = '/api/market/admin/config/'
        self.assertEqual(self.client.patch(url, {'max_items_per_run': 40}, format='json').status_code, 403)
        self.allow('marketconfig')
        for value in [0, 39, 41, 79, 81, True, 40.5, None, '40.0', []]:
            with self.subTest(value=value):
                response = self.client.patch(url, {'max_items_per_run': value}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn('max_items_per_run', response.json())
        self.assertFalse(MarketConfigAudit.objects.exists())

        for value in [40, 80]:
            with self.subTest(value=value):
                response = self.client.patch(url, {'max_items_per_run': value}, format='json')
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['max_items_per_run'], value)
                self.assertEqual(response.json()['configured_max_items_per_run'], value)
                self.assertEqual(MarketConfig.objects.get(pk=1).max_items_per_run, value)
        audits = list(MarketConfigAudit.objects.order_by('id'))
        self.assertEqual(len(audits), 2)
        self.assertEqual(audits[0].before['max_items_per_run'], 80)
        self.assertEqual(audits[0].after['max_items_per_run'], 40)
        self.assertEqual(audits[1].before['max_items_per_run'], 40)
        self.assertEqual(audits[1].after['max_items_per_run'], 80)

    def test_config_exposes_active_fallback_and_hides_expired_fallback(self):
        future_ms = 4_000_000_000_000
        config = MarketConfig.objects.create(
            max_items_per_run=80, batch_fallback_until_ms=future_ms,
            batch_fallback_reason='runtime_budget', capacity_failure_count=2,
        )

        payload = self.client.get('/api/market/admin/config/').json()

        self.assertEqual(payload['max_items_per_run'], 40)
        self.assertEqual(payload['configured_max_items_per_run'], 80)
        self.assertEqual(payload['batch_fallback_until_ms'], future_ms)
        self.assertEqual(payload['batch_fallback_reason'], 'runtime_budget')
        config.batch_fallback_until_ms = 1
        config.save(update_fields=['batch_fallback_until_ms'])
        payload = self.client.get('/api/market/admin/config/').json()
        self.assertEqual(payload['max_items_per_run'], 80)
        self.assertEqual(payload['configured_max_items_per_run'], 80)
        self.assertIsNone(payload['batch_fallback_until_ms'])
        self.assertFalse(payload['batch_fallback_reason'])

    def test_other_config_changes_preserve_fallback_and_failure_counter(self):
        self.allow('marketconfig')
        future_ms = 4_000_000_000_000
        config = MarketConfig.objects.create(
            max_items_per_run=80, batch_fallback_until_ms=future_ms,
            batch_fallback_reason='incomplete_run', capacity_failure_count=2,
        )

        response = self.client.patch('/api/market/admin/config/', {
            'enabled': False, 'min_interval_seconds': 2400, 'max_interval_seconds': 3000,
        }, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['max_items_per_run'], 40)
        config.refresh_from_db()
        self.assertEqual(config.batch_fallback_until_ms, future_ms)
        self.assertEqual(config.batch_fallback_reason, 'incomplete_run')
        self.assertEqual(config.capacity_failure_count, 2)
        audit = MarketConfigAudit.objects.get()
        for field in ['max_items_per_run', 'batch_fallback_until_ms', 'batch_fallback_reason', 'capacity_failure_count']:
            self.assertEqual(audit.before[field], audit.after[field])

    def test_explicit_same_capacity_clears_fallback_and_counter_with_audit(self):
        self.allow('marketconfig')
        config = MarketConfig.objects.create(
            max_items_per_run=80, batch_fallback_until_ms=4_000_000_000_000,
            batch_fallback_reason='timeout', capacity_failure_count=2,
        )

        response = self.client.patch('/api/market/admin/config/', {'max_items_per_run': 80}, format='json')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['max_items_per_run'], 80)
        self.assertIsNone(response.json()['batch_fallback_until_ms'])
        self.assertFalse(response.json()['batch_fallback_reason'])
        config.refresh_from_db()
        self.assertIsNone(config.batch_fallback_until_ms)
        self.assertEqual(config.batch_fallback_reason, '')
        self.assertEqual(config.capacity_failure_count, 0)
        audit = MarketConfigAudit.objects.get()
        self.assertEqual(audit.actor, self.user)
        self.assertEqual(audit.before['max_items_per_run'], audit.after['max_items_per_run'])
        self.assertEqual(audit.before['capacity_failure_count'], 2)
        self.assertEqual(audit.after['capacity_failure_count'], 0)
        self.assertIsNone(audit.after['batch_fallback_until_ms'])

    def test_capacity_patch_clears_counter_without_active_fallback(self):
        self.allow('marketconfig')
        config = MarketConfig.objects.create(max_items_per_run=80, capacity_failure_count=1)

        response = self.client.patch('/api/market/admin/config/', {'max_items_per_run': 40}, format='json')

        self.assertEqual(response.status_code, 200)
        config.refresh_from_db()
        self.assertEqual(config.max_items_per_run, 40)
        self.assertEqual(config.capacity_failure_count, 0)
        self.assertEqual(MarketConfigAudit.objects.get().after['capacity_failure_count'], 0)

    def test_fallback_state_cannot_be_written_directly(self):
        self.allow('marketconfig')
        for field, value in [
            ('batch_fallback_until_ms', None), ('batch_fallback_reason', ''), ('capacity_failure_count', 0),
        ]:
            with self.subTest(field=field):
                response = self.client.patch('/api/market/admin/config/', {field: value}, format='json')
                self.assertEqual(response.status_code, 400)
                self.assertIn(field, response.json())

    def test_config_and_runs_show_last_success_and_only_safe_error_code(self):
        config = MarketConfig.objects.create(next_due_at_ms=1_700_000_000_000, session_status='needs_auth')
        CollectionRun.objects.create(
            trigger='scheduled', status='succeeded', created_at_ms=1000, finished_at_ms=2000,
            success_count=3,
        )
        CollectionRun.objects.create(
            trigger='scheduled', status='failed', created_at_ms=3000, finished_at_ms=4000,
            failure_count=2, error_code='AUTH_EXPIRED',
        )

        response = self.client.get('/api/market/admin/config/')
        runs = self.client.get('/api/market/admin/runs/')

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['next_run_at'], iso(config.next_due_at_ms))
        self.assertEqual(response.json().get('next_due_at_ms'), config.next_due_at_ms)
        self.assertEqual(response.json()['last_success_at'], iso(2000))
        self.assertEqual(response.json()['last_run_failure_count'], 2)
        self.assertEqual(runs.status_code, 200)
        self.assertEqual(runs.json()['count'], 2)
        self.assertEqual(runs.json()['results'][0]['error_code'], 'AUTH_EXPIRED')
        self.assertEqual(runs.json()['results'][0]['failure_count'], 2)
        self.assertEqual(runs.json()['results'][0].get('finished_at_ms'), 4000)

    def test_runs_report_capacity_plan_and_keep_legacy_unknown_count(self):
        legacy = CollectionRun.objects.create(
            trigger='scheduled', status='succeeded', created_at_ms=1000,
            success_count=3, item_limit=None, expected_count=None, batch_fallback_reason=None,
        )
        current = CollectionRun.objects.create(
            trigger='scheduled', status='partial', created_at_ms=2000,
            success_count=37, item_limit=40, expected_count=40,
            batch_fallback_reason='runtime_budget', error_code='incomplete_run',
        )

        response = self.client.get('/api/market/admin/runs/')

        self.assertEqual(response.status_code, 200)
        rows = {row['id']: row for row in response.json()['results']}
        self.assertIsNone(rows[legacy.pk]['item_limit'])
        self.assertIsNone(rows[legacy.pk]['expected_count'])
        self.assertIsNone(rows[legacy.pk]['batch_fallback_reason'])
        self.assertEqual(rows[current.pk]['item_limit'], 40)
        self.assertEqual(rows[current.pk]['expected_count'], 40)
        self.assertEqual(rows[current.pk]['batch_fallback_reason'], 'runtime_budget')
        self.assertEqual(rows[current.pk]['error_code'], 'incomplete_run')

    def test_runs_expose_only_safe_capacity_error_codes(self):
        codes = ['runtime_budget', 'incomplete_run', 'shared_budget']
        for index, code in enumerate(codes):
            CollectionRun.objects.create(
                trigger='scheduled', status='failed', created_at_ms=index + 1,
                error_code=code, batch_fallback_reason=code,
            )
        private = CollectionRun.objects.create(
            trigger='scheduled', status='failed', created_at_ms=10,
            error_code='connection failed: private path', batch_fallback_reason='private session path',
        )

        rows = self.client.get('/api/market/admin/runs/').json()['results']

        for row in rows:
            if row['id'] == private.pk:
                self.assertEqual(row['error_code'], 'COLLECTION_ERROR')
                self.assertEqual(row['batch_fallback_reason'], 'COLLECTION_ERROR')
            else:
                self.assertIn(row['error_code'], codes)
                self.assertEqual(row['batch_fallback_reason'], row['error_code'])

    def test_item_writes_require_staff_and_item_change_permission(self):
        url = '/api/market/admin/items/'
        payload = {'item_id': '123456789012', 'name': 'Tritanium', 'category': 'Mineral', 'scope': 'global', 'enabled': True}
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 403)
        self.allow('marketitem')
        created = self.client.post(url, payload, format='json')
        self.assertEqual(created.status_code, 201)
        self.assertEqual(created.json(), {**payload, 'last_failure': None})
        self.assertEqual(self.client.post(url, payload, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {**payload, 'item_id': '0'}, format='json').status_code, 400)
        self.assertEqual(self.client.post(url, {**payload, 'item_id': '44', 'scope': 'unknown'}, format='json').status_code, 400)

        changed = self.client.patch('/api/market/admin/items/123456789012/', {'enabled': False}, format='json')
        self.assertEqual(changed.status_code, 200)
        self.assertFalse(MarketItem.objects.get(pk=123456789012).enabled)
        self.assertEqual(self.client.get(url).json()['results'][0]['item_id'], payload['item_id'])

    def test_item_failure_exposes_only_code_not_exception_text(self):
        item = MarketItem.objects.create(id=54, name='Failure', last_error_code='ORDER_TIMEOUT')

        row = self.client.get('/api/market/admin/items/').json()['results'][0]

        self.assertEqual(row['last_failure'], 'ORDER_TIMEOUT')
        item.last_error_code = 'connection failed: private path'
        item.save(update_fields=['last_error_code'])
        row = self.client.get('/api/market/admin/items/').json()['results'][0]
        self.assertEqual(row['last_failure'], 'COLLECTION_ERROR')

    def test_admin_item_search_filters_name_category_and_exact_id(self):
        MarketItem.objects.create(id=11, name='Tritanium', category='Mineral', enabled=False)
        MarketItem.objects.create(id=22, name='Venture', category='Ship')

        for query, expected_id in [('trit', '11'), ('mineral', '11'), ('22', '22')]:
            with self.subTest(query=query):
                response = self.client.get('/api/market/admin/items/', {'q': query})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json()['count'], 1)
                self.assertEqual(response.json()['results'][0]['item_id'], expected_id)
        self.assertEqual(self.client.get('/api/market/admin/items/', {'q': 'x' * 101}).status_code, 400)
        self.assertEqual(self.client.get('/api/market/admin/items/', {'q': '9' * 100}).json()['count'], 0)

    def test_manual_run_only_enqueues_one_request_with_permission(self):
        url = '/api/market/admin/run/'
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 403)
        self.allow('collectionrun')

        response = self.client.post(url, {}, format='json')

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json()['status'], 'queued')
        run = CollectionRun.objects.get()
        self.assertEqual(run.trigger, 'manual')
        self.assertEqual(run.requested_by, self.user)
        self.assertIsNone(run.started_at_ms)
        self.assertEqual(self.client.post(url, {}, format='json').status_code, 409)

    def test_manual_run_rejects_unexpected_request_fields(self):
        self.allow('collectionrun')

        response = self.client.post('/api/market/admin/run/', {'unexpected': 'value'}, format='json')

        self.assertEqual(response.status_code, 400)
        self.assertFalse(CollectionRun.objects.exists())

    def test_expired_running_lease_does_not_block_manual_queue(self):
        self.allow('collectionrun')
        CollectionRun.objects.create(
            trigger='scheduled', status='running', lease_owner='old-worker', lease_expires_at_ms=1,
        )
        CollectionRun.objects.create(trigger='scheduled', status='running', lease_owner='', lease_expires_at_ms=None)

        response = self.client.post('/api/market/admin/run/', {}, format='json')

        self.assertEqual(response.status_code, 202)
        self.assertEqual(CollectionRun.objects.filter(status='queued', trigger='manual').count(), 1)
