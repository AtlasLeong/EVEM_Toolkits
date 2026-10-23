"""Stored-only tier planning and private health regressions; no game traffic."""
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.db import connection
from django.db.migrations.loader import MigrationLoader
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot
from Market.collector_protocol import RateLimitedError, ServiceRejectedError
from Market.session_bundle import AuthenticationRejected
from Market.serializers import item_payload, STALE_AFTER_MS
from Market.tests.test_capacity import SyntheticLease, TimedSession, VirtualClock


HOUR = 3_600_000


class MarketTierSelectionTests(TestCase):
    def setUp(self):
        self.config = MarketConfig.objects.create(next_due_at_ms=1000)

    def items(self, priority, ordinary):
        MarketItem.objects.bulk_create([
            MarketItem(id=index + 1, name=f'Priority {index}', collection_priority=True)
            for index in range(priority)
        ] + [
            MarketItem(id=1000 + index, name=f'Ordinary {index}', collection_priority=None if index % 2 else False)
            for index in range(ordinary)
        ])

    def collect(self, clock, *, shared=True):
        from Market.worker import collect_due
        session = TimedSession(clock)
        lease = SyntheticLease(clock) if shared else None
        with patch('socket.create_connection', side_effect=AssertionError('No game traffic')):
            run = collect_due(clock_ms=clock.clock_ms, monotonic=clock.monotonic,
                bundle_loader=lambda: [{'synthetic': 1}, {'synthetic': 2}],
                session_factory=lambda bundle: session, randint=clock.randint,
                sleep=clock.sleep, lease_factory=lambda *args: lease)
        return run, [item for item, scope in session.queries], lease

    def test_shared_actual_forty_cap_reserves_twenty_ordinary_instead_of_truncating_eighty(self):
        self.items(80, 80)
        run, ids, lease = self.collect(VirtualClock())
        self.assertEqual((run.item_limit, run.expected_count, run.success_count), (40, 40, 40))
        self.assertEqual(ids, list(range(1, 21)) + list(range(1000, 1020)))
        self.assertEqual(lease.rpc_count, 44)
        self.assertEqual(self.config.min_interval_seconds, 2100)

    def test_multiple_shared_passes_move_both_tiers_oldest_first_without_duplicates(self):
        self.items(45, 45)
        batches = []
        for _ in range(3):
            self.config.refresh_from_db()
            run, ids, _ = self.collect(VirtualClock(self.config.next_due_at_ms))
            self.assertEqual(len(ids), len(set(ids)))
            batches.append(ids)
        self.assertEqual(batches[1], list(range(21, 41)) + list(range(1020, 1040)))
        self.assertEqual(batches[2][:5], list(range(41, 46)))
        self.assertEqual(batches[2][20:25], list(range(1040, 1045)))
        self.assertEqual(len(set(sum(batches, []))), 90)

    def test_donates_unused_slots_in_either_direction_and_ordinary_only_order_unchanged(self):
        for priority, ordinary, expected_priority, expected_total in [(3, 80, 3, 40), (80, 3, 37, 40), (0, 45, 0, 40), (45, 0, 40, 40), (2, 3, 2, 5)]:
            with self.subTest(priority=priority, ordinary=ordinary):
                LatestPrice.objects.all().delete()
                # Each subcase uses disjoint ids so immutable snapshots need not be removed.
                MarketItem.objects.all().update(enabled=False)
                offset = (MarketItem.objects.count() + 1) * 10000
                rows = [MarketItem(id=offset+i, name=str(i), collection_priority=True) for i in range(priority)]
                rows += [MarketItem(id=offset+1000+i, name=str(i), collection_priority=None) for i in range(ordinary)]
                MarketItem.objects.bulk_create(rows)
                self.config.refresh_from_db()
                run, ids, _ = self.collect(VirtualClock(self.config.next_due_at_ms))
                self.assertEqual(len(ids), expected_total)
                self.assertEqual(sum(i < offset+1000 for i in ids), expected_priority)
                self.assertEqual(ids[:expected_priority], [r.pk for r in rows[:expected_priority]])
                self.assertEqual(ids[expected_priority:], [r.pk for r in rows[priority:priority+expected_total-expected_priority]])

    def test_nonshared_eighty_plan_keeps_half_of_each_tier(self):
        self.items(60, 60)
        run, ids, _ = self.collect(VirtualClock(), shared=False)
        self.assertEqual((run.item_limit, len(ids)), (80, 80))
        self.assertEqual(ids, list(range(1, 41)) + list(range(1000, 1040)))

    def test_both_tiers_order_null_attempts_then_oldest_attempt_then_id(self):
        from Market.worker import _select_items
        self.items(4, 4)
        MarketItem.objects.filter(pk__in=[1, 1000]).update(last_attempt_at_ms=20)
        MarketItem.objects.filter(pk__in=[2, 1001]).update(last_attempt_at_ms=10)
        self.assertEqual([row.pk for row in _select_items(6)], [3, 4, 2, 1002, 1003, 1001])

    def test_priority_changed_between_bounded_reads_cannot_duplicate_an_item(self):
        from Market.worker import _select_items
        self.items(3, 3)
        changed = False
        def concurrent_edit(execute, sql, params, many, context):
            nonlocal changed
            if not changed and sql.startswith('SELECT') and 'IS NULL' in sql:
                changed = True
                MarketItem.objects.filter(pk=1).update(collection_priority=False)
            return execute(sql, params, many, context)
        with connection.execute_wrapper(concurrent_edit):
            selected = _select_items(6)
        self.assertTrue(changed)
        self.assertEqual(len({row.pk for row in selected}), len(selected))
        self.assertEqual(len(selected), 6)

    def test_priority_does_not_rotate_immediately_after_auth_refusal_or_rate_stop(self):
        from Market.worker import collect_due
        self.items(25, 25)
        for error, status in [(AuthenticationRejected(), 'needs_auth'), (ServiceRejectedError(), 'failed'), (RateLimitedError(), 'rate_limited')]:
            with self.subTest(error=type(error).__name__):
                self.config.session_status = 'ready'
                self.config.cooldown_until_ms = None
                self.config.next_due_at_ms = 1000
                self.config.save(update_fields=['session_status', 'cooldown_until_ms', 'next_due_at_ms'])
                clock = VirtualClock()
                sessions = []
                def factory(bundle):
                    session = TimedSession(clock, quotes={1: error})
                    sessions.append(session)
                    return session
                run = collect_due(clock_ms=clock.clock_ms, monotonic=clock.monotonic,
                    bundle_loader=lambda: [{'synthetic': 1}, {'synthetic': 2}], session_factory=factory,
                    randint=clock.randint, sleep=clock.sleep, lease_factory=lambda *args: None)
                self.assertEqual(run.status, status)
                self.assertEqual(len(sessions), 1)
                self.assertEqual(sessions[0].queries, [(1, 8)])


class MarketTierAdminTests(TestCase):
    def setUp(self):
        self.user = get_user_model().objects.create_user(username='tier-admin', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.item = MarketItem.objects.create(pk=91, name='Existing')

    def allow(self):
        self.user.user_permissions.add(Permission.objects.get(content_type__app_label='Market', codename='change_marketitem'))
        self.user = get_user_model().objects.get(pk=self.user.pk)
        self.client.force_authenticate(self.user)

    def test_priority_patch_requires_existing_permission_and_strict_json_boolean(self):
        url = '/api/market/admin/items/91/'
        self.assertEqual(self.client.patch(url, {'collection_priority': True}, format='json').status_code, 403)
        self.allow()
        for value in (None, 1, 0, 'true', 'false', [], {}):
            self.assertEqual(self.client.patch(url, {'collection_priority': value}, format='json').status_code, 400)
        response = self.client.patch(url, {'collection_priority': True}, format='json')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()['collection_priority'])
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        self.item.refresh_from_db()
        self.assertTrue(self.item.collection_priority)
        self.user.is_staff = False
        self.user.save(update_fields=['is_staff'])
        self.assertEqual(self.client.patch(url, {'collection_priority': False}, format='json').status_code, 403)

    def test_create_defaults_ordinary_and_can_explicitly_prioritize(self):
        self.allow()
        for item_id, extra, expected in [('92', {}, False), ('93', {'collection_priority': True}, True)]:
            response = self.client.post('/api/market/admin/items/', {'item_id': item_id, 'name': item_id, **extra}, format='json')
            self.assertEqual(response.status_code, 201)
            self.assertIs(response.json()['collection_priority'], expected)

    def test_public_age_tier_targets_are_additive_not_a_six_hour_freshness_redefinition(self):
        now = 10 * HOUR
        self.assertIsNone(item_payload(self.item, now)['age_ms'])
        self.assertEqual(item_payload(self.item, now)['collection_tier'], 'ordinary')
        run = CollectionRun.objects.create(trigger='scheduled')
        snapshot = PriceSnapshot.objects.create(item=self.item, run=run, best_sell=Decimal('7.50'), observed_at_ms=now-3*HOUR)
        LatestPrice.objects.create(item=self.item, snapshot=snapshot)
        row = item_payload(self.item, now)
        self.assertEqual((row['age_ms'], row['collection_target_ms'], row['status'], row['best_sell']), (3*HOUR, 6*HOUR, 'stale', '7.50'))
        self.item.collection_priority = True
        row = item_payload(self.item, now)
        self.assertEqual((row['collection_tier'], row['collection_target_ms']), ('priority', STALE_AFTER_MS))

    def test_old_release_orm_and_raw_old_columns_insert_null_and_still_update(self):
        previous = MigrationLoader(connection).project_state([('Market', '0012_enable_manufacturing_leaves')]).apps.get_model('Market', 'MarketItem')
        previous.objects.create(pk=90001, name='Old ORM')
        old = previous.objects.get(pk=90001)
        old.name = 'Old updated'
        old.save(update_fields=['name'])
        self.assertIsNone(MarketItem.objects.get(pk=90001).collection_priority)
        with connection.cursor() as cursor:
            table = connection.ops.quote_name(MarketItem._meta.db_table)
            cursor.execute(f'INSERT INTO {table} (id,name,category,scope,enabled,last_error_code,market_bucket) VALUES (%s,%s,%s,%s,%s,%s,%s)', [90002, 'Raw old', '', 'global', True, '', 'other'])
        self.assertIsNone(MarketItem.objects.get(pk=90002).collection_priority)
        self.assertFalse(self.item.collection_priority)


class MarketCollectionHealthTests(TestCase):
    def setUp(self):
        self.now = 100 * HOUR
        self.config = MarketConfig.objects.create(session_status='ready')

    def health(self):
        from Market.collection_health import collection_health
        return collection_health(self.config, now_ms=self.now)

    def observed(self, item_id, age, *, priority=False, usable=True):
        item = MarketItem.objects.create(pk=item_id, name=str(item_id), collection_priority=priority)
        run = CollectionRun.objects.create(trigger='scheduled')
        snapshot = PriceSnapshot.objects.create(item=item, run=run, observed_at_ms=self.now-age, best_sell=Decimal('1.50') if usable else None)
        LatestPrice.objects.create(item=item, snapshot=snapshot)
        return item

    def test_stored_tier_coverage_age_statistics_and_missing_unknowns(self):
        self.observed(1, HOUR, priority=True)
        self.observed(2, 3*HOUR, priority=True, usable=False)
        self.observed(3, 5*HOUR)
        MarketItem.objects.create(pk=4, name='Unobserved')
        health = self.health()
        p, o = health['tiers']['priority'], health['tiers']['ordinary']
        self.assertEqual((p['enabled'], p['observed'], p['usable'], p['within_two_hours'], p['usable_within_two_hours'], p['within_target']), (2, 2, 1, 1, 1, 1))
        self.assertEqual((p['age_median_ms'], p['age_p95_ms'], p['max_age_ms']), (2*HOUR, 3*HOUR, 3*HOUR))
        self.assertEqual((o['enabled'], o['observed'], o['within_target'], o['within_two_hours']), (2, 1, 1, 0))
        self.assertEqual((p['target_ms'], o['target_ms']), (2*HOUR, 6*HOUR))
        self.assertIsNone(health['actual_plan'])
        self.assertIsNone(health['throughput']['per_hour'])
        self.assertIsNone(health['capacity']['estimated_items_per_hour'])
        self.assertEqual(health['pool_state'], 'unknown')

    def test_no_observation_ages_are_null_and_queries_bounded_independent_of_inventory(self):
        MarketItem.objects.bulk_create([MarketItem(id=i, name=str(i)) for i in range(1, 401)])
        with CaptureQueriesContext(connection) as queries:
            health = self.health()
        self.assertLessEqual(len(queries), 16)
        self.assertIsNone(health['tiers']['ordinary']['age_median_ms'])
        self.assertIsNone(health['tiers']['priority']['max_age_ms'])

    def test_actual_shared_plan_not_web_eighty_setting_drives_capacity_and_stale_label(self):
        MarketItem.objects.bulk_create([MarketItem(id=i, name=str(i), collection_priority=i <= 50) for i in range(1, 251)])
        old = CollectionRun.objects.create(trigger='scheduled', status='succeeded', created_at_ms=self.now-3*HOUR,
            started_at_ms=self.now-3*HOUR, finished_at_ms=self.now-3*HOUR+120_000, item_limit=40, expected_count=40, success_count=40)
        recent = CollectionRun.objects.create(trigger='scheduled', status='succeeded', created_at_ms=self.now-HOUR,
            started_at_ms=self.now-HOUR, finished_at_ms=self.now-HOUR+120_000, item_limit=40, expected_count=40, success_count=40)
        health = self.health()
        self.assertEqual(health['actual_plan'], {'item_limit': 40, 'expected_count': 40, 'planned_at_ms': recent.started_at_ms, 'stale': False})
        self.assertEqual((health['capacity']['priority_slots'], health['capacity']['ordinary_slots']), (20, 20))
        self.assertLess(health['capacity']['estimated_items_per_hour'], 60)
        self.assertFalse(health['capacity']['ordinary_target_feasible'])
        self.assertGreater(health['throughput']['per_hour'], 0)
        self.assertEqual(health['throughput']['run_count'], 2)
        self.now += 25*HOUR
        health = self.health()
        self.assertTrue(health['actual_plan']['stale'])
        self.assertIsNone(health['capacity']['estimated_items_per_hour'])
        self.assertIsNone(health['throughput']['per_hour'])

    def test_private_pause_codes_keep_invalid_material_distinct_from_confirmed_auth_and_hide_text(self):
        mappings = {'invalid_session':'invalid_material', 'auth_rejected':'authentication_rejected',
            'service_rejected':'service_refused', 'account_busy':'account_busy', 'budget_exhausted':'budget_exhausted',
            'configuration_error':'configuration_error', 'timeout':'timeout', 'network_error':'network_error',
            'unauthorized':'authentication_rejected', 'private session /secret/path':'unknown'}
        for index, (error, expected) in enumerate(mappings.items()):
            with self.subTest(error=error):
                run = CollectionRun.objects.create(trigger='scheduled', status='failed', error_code=error,
                    created_at_ms=self.now+index, started_at_ms=self.now+index, finished_at_ms=self.now+index)
                health = self.health()
                self.assertEqual(health['pause']['code'], expected)
                self.assertNotIn('/secret/path', str(health))
        self.config.cooldown_until_ms = self.now+HOUR
        self.assertEqual(self.health()['pause'], {'code':'rate_cooldown', 'retry_at_ms':self.now+HOUR, 'last_attempt_at_ms':run.finished_at_ms})

    def test_private_config_exposes_health_but_public_quality_collector_keeps_exact_whitelist(self):
        user = get_user_model().objects.create_user(username='health-staff', is_staff=True)
        client = APIClient()
        client.force_authenticate(user)
        response = client.get('/api/market/admin/config/')
        self.assertIn('collection_health', response.json())
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        self.assertEqual(set(client.get('/api/market/quality/').json()['collector']), {'status', 'last_attempt_at', 'last_success_at', 'last_failure_at', 'success_count', 'failure_count'})
