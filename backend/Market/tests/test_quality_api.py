from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from Market.models import CollectionRun, LatestPrice, MarketConfig, MarketItem, PriceSnapshot
from Market.quality import CACHE_TTL_SECONDS, SOURCE_CACHE_KEY
from Market.serializers import STALE_AFTER_MS, utc_iso


URL = '/api/market/quality/'
NOW_MS = 1_780_000_000_000


class QualityFixtures(TestCase):
    def setUp(self):
        cache.clear()
        self.config = MarketConfig.objects.create(session_status='ready')
        self.client = APIClient()

    def tearDown(self):
        cache.clear()

    def make_run(self, status='succeeded', *, at=NOW_MS - 1000, success=1, failure=0, **extra):
        return CollectionRun.objects.create(
            trigger='scheduled', status=status, created_at_ms=at - 1000,
            started_at_ms=at - 500, finished_at_ms=at,
            success_count=success, failure_count=failure, **extra,
        )

    def item(self, item_id, *, age=0, sell=None, buy=None, enabled=True, run=None):
        item = MarketItem.objects.create(id=item_id, name=f'Item {item_id}', enabled=enabled)
        if age is not None:
            snapshot = PriceSnapshot.objects.create(
                item=item, run=run or self.make_run(), observed_at_ms=NOW_MS - age,
                best_sell=Decimal(sell) if sell is not None else None,
                best_buy=Decimal(buy) if buy is not None else None,
            )
            LatestPrice.objects.create(item=item, snapshot=snapshot)
        return item

    def get(self, now_ms=NOW_MS, **params):
        with patch('Market.quality.epoch_ms', return_value=now_ms):
            return self.client.get(URL, params)


class MarketQualityCountsTests(QualityFixtures):
    def test_enabled_denominator_classifies_missing_stale_empty_and_uncollected(self):
        self.item(1, sell='10.00')
        self.item(2, age=STALE_AFTER_MS, sell='11.00')
        self.item(3, age=STALE_AFTER_MS + 1, sell='12.00')
        self.item(4, buy='9.00')
        self.item(5)
        self.item(6, age=STALE_AFTER_MS + 500)
        self.item(7, age=None)
        self.item(8, sell='99.00', enabled=False)

        response = self.get(q='no match', category_id='minerals', page_size=1)

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(body['counts'], {
            'enabled': 7, 'observed': 6, 'uncollected': 1,
            'fresh_sell': 2, 'stale_sell': 1, 'missing_sell': 3,
            'empty_book': 2, 'stale_observed': 2,
        })
        self.assertEqual(body['sell_coverage'], {
            'available': 3, 'fresh': 2, 'total': 7,
            'available_ratio': 3 / 7, 'fresh_ratio': 2 / 7,
        })
        self.assertEqual(body['last_observed_at'], utc_iso(NOW_MS))
        self.assertEqual(body['oldest_observed_at'], utc_iso(NOW_MS - STALE_AFTER_MS - 500))
        self.assertEqual(len(body['observations']), 7)
        self.assertIn({'observed_at': None, 'has_sell': False, 'has_buy': False}, body['observations'])
        self.assertTrue(all(set(row) == {'observed_at', 'has_sell', 'has_buy'} for row in body['observations']))
        self.assertEqual(body['market_scope']['key'], 'jita_h4')
        self.assertEqual(body['stale_after_seconds'], 7200)

    def test_empty_denominator_has_unknown_ratios_and_no_observation_time(self):
        self.item(1, sell='10.00', enabled=False)

        body = self.get().json()

        self.assertEqual(body['counts']['enabled'], 0)
        self.assertEqual(body['sell_coverage'], {
            'available': 0, 'fresh': 0, 'total': 0,
            'available_ratio': None, 'fresh_ratio': None,
        })
        self.assertEqual(body['observations'], [])
        self.assertIsNone(body['last_observed_at'])
        self.assertIsNone(body['oldest_observed_at'])

    def test_failed_collection_preserves_stored_sell_and_does_not_turn_it_into_zero(self):
        old = self.make_run(at=NOW_MS - 3 * 60 * 60 * 1000)
        item = self.item(1, age=3 * 60 * 60 * 1000, sell='10.00', run=old)
        item.last_failure_at_ms = NOW_MS - 500
        item.last_error_code = 'internal secret detail'
        item.save(update_fields=['last_failure_at_ms', 'last_error_code'])
        failed = self.make_run('failed', at=NOW_MS - 500, success=0, failure=1)

        body = self.get().json()

        self.assertEqual(body['counts']['stale_sell'], 1)
        self.assertEqual(body['counts']['missing_sell'], 0)
        self.assertEqual(body['sell_coverage']['available'], 1)
        self.assertEqual(body['collector']['status'], 'failed')
        self.assertEqual(body['collector']['last_success_at'], utc_iso(old.finished_at_ms))
        self.assertEqual(body['collector']['last_failure_at'], utc_iso(failed.finished_at_ms))
        self.assertEqual(LatestPrice.objects.get(item=item).snapshot.best_sell, Decimal('10.00'))

    def test_observation_extrema_include_successful_empty_books(self):
        self.item(1, age=1000, sell='10.00')
        self.item(2, age=0)
        self.item(3, age=STALE_AFTER_MS + 1)

        body = self.get().json()

        self.assertEqual(body['last_observed_at'], utc_iso(NOW_MS))
        self.assertEqual(body['oldest_observed_at'], utc_iso(NOW_MS - STALE_AFTER_MS - 1))


class MarketQualityCacheTests(QualityFixtures):
    def test_cached_source_reages_at_exact_boundary_without_database_reads(self):
        self.item(1, age=STALE_AFTER_MS, sell='10.00')
        first = self.get().json()

        with CaptureQueriesContext(connection) as queries:
            second = self.get(NOW_MS + 1).json()

        self.assertEqual(len(queries), 0)
        self.assertEqual(first['counts']['fresh_sell'], 1)
        self.assertEqual(second['counts']['fresh_sell'], 0)
        self.assertEqual(second['counts']['stale_sell'], 1)
        self.assertEqual(second['counts']['stale_observed'], 1)
        self.assertEqual(first['snapshot_at'], second['snapshot_at'])
        self.assertNotEqual(first['generated_at'], second['generated_at'])
        self.assertEqual(second['cache_ttl_seconds'], 300)

    def test_inventory_config_and_runs_refresh_together_at_five_minutes(self):
        self.item(1, sell='10.00')
        first = self.get().json()
        self.item(2, age=None)
        self.config.enabled = False
        self.config.save(update_fields=['enabled'])
        self.make_run('failed', at=NOW_MS + 1000, success=0, failure=1)

        cached = self.get(NOW_MS + CACHE_TTL_SECONDS * 1000 - 1).json()
        refreshed = self.get(NOW_MS + CACHE_TTL_SECONDS * 1000).json()

        self.assertEqual(cached['counts'], first['counts'])
        self.assertEqual(cached['collector'], first['collector'])
        self.assertEqual(cached['snapshot_at'], first['snapshot_at'])
        self.assertEqual(refreshed['counts']['enabled'], 2)
        self.assertEqual(refreshed['counts']['uncollected'], 1)
        self.assertEqual(refreshed['collector']['status'], 'paused')
        self.assertEqual(refreshed['collector']['last_failure_at'], utc_iso(NOW_MS + 1000))
        self.assertEqual(refreshed['snapshot_at'], utc_iso(NOW_MS + CACHE_TTL_SECONDS * 1000))

    def test_large_inventory_has_ten_bounded_read_queries_and_no_worker_or_network(self):
        MarketItem.objects.bulk_create([
            MarketItem(id=index, name=f'Item {index}') for index in range(1, 150)
        ])
        with patch('Market.worker.collect_due', side_effect=AssertionError('worker invoked')), \
                patch('socket.create_connection', side_effect=AssertionError('network invoked')), \
                CaptureQueriesContext(connection) as queries:
            body = self.get().json()

        self.assertEqual(body['counts']['enabled'], 149)
        self.assertEqual(len(queries), 10)
        self.assertTrue(all(query['sql'].lstrip().upper().startswith('SELECT') for query in queries))
        self.assertFalse(CollectionRun.objects.exists())
        self.assertFalse(PriceSnapshot.objects.exists())

    def test_read_without_config_does_not_create_one(self):
        self.config.delete()

        with CaptureQueriesContext(connection) as queries:
            body = self.get().json()

        self.assertEqual(body['collector']['status'], 'attention')
        self.assertFalse(MarketConfig.objects.exists())
        self.assertTrue(all(query['sql'].lstrip().upper().startswith('SELECT') for query in queries))


class MarketQualityConsistencyTests(QualityFixtures):
    def running_with_old_sell(self):
        old = self.make_run(at=NOW_MS - 3 * 60 * 60 * 1000)
        item = self.item(1, age=3 * 60 * 60 * 1000, sell='10.00', run=old)
        running = CollectionRun.objects.create(
            trigger='scheduled', status='running', created_at_ms=NOW_MS - 200,
            started_at_ms=NOW_MS - 100, lease_expires_at_ms=NOW_MS + 1000,
        )
        return item, running

    def finish(self, item, running):
        snapshot = PriceSnapshot.objects.create(
            item=item, run=running, best_sell=Decimal('11.00'), observed_at_ms=NOW_MS,
        )
        LatestPrice.objects.filter(item=item).update(snapshot=snapshot, updated_at_ms=NOW_MS)
        CollectionRun.objects.filter(pk=running.pk).update(
            status='succeeded', finished_at_ms=NOW_MS, success_count=1,
            expected_count=1, lease_expires_at_ms=None,
        )
        MarketConfig.objects.filter(pk=1).update(session_status='ready', updated_at_ms=NOW_MS)

    def assert_completed_source(self, body):
        self.assertEqual(body['counts']['fresh_sell'], 1)
        self.assertEqual(body['counts']['stale_sell'], 0)
        self.assertEqual(body['last_observed_at'], utc_iso(NOW_MS))
        self.assertEqual(body['collector']['status'], 'healthy')
        self.assertEqual(body['collector']['success_count'], 1)
        self.assertEqual(body['collector']['last_attempt_at'], utc_iso(NOW_MS))
        source = cache.get(SOURCE_CACHE_KEY)
        self.assertTrue(source['consistent'])
        self.assertEqual(source['latest_run']['status'], 'succeeded')
        self.assertEqual(source['latest_run']['id'], source['completed'][0]['id'])

    def test_completion_after_inventory_read_retries_before_caching(self):
        item, running = self.running_with_old_sell()
        injected = False

        def complete_between_queries(execute, sql, params, many, context):
            nonlocal injected
            if not injected and sql.lstrip().upper().startswith('SELECT') and 'Market_marketconfig' in sql:
                injected = True
                self.finish(item, running)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(complete_between_queries):
            body = self.get().json()

        self.assertTrue(injected)
        self.assert_completed_source(body)

    def test_completion_between_latest_and_terminal_reads_does_not_cache_same_run_torn_state(self):
        item, running = self.running_with_old_sell()
        injected = False

        def complete_between_queries(execute, sql, params, many, context):
            nonlocal injected
            if not injected and 'Market_collectionrun' in sql and 'LIMIT 2' in sql:
                injected = True
                self.finish(item, running)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(complete_between_queries):
            body = self.get().json()

        self.assertTrue(injected)
        self.assert_completed_source(body)

    def test_continuously_changing_source_stops_after_three_passes_and_is_not_cached(self):
        self.item(1, sell='10.00')
        changes = 0

        def persist_after_inventory_read(execute, sql, params, many, context):
            nonlocal changes
            if sql.lstrip().upper().startswith('SELECT') and 'Market_marketconfig' in sql:
                changes += 1
                run = self.make_run(at=NOW_MS + changes)
                # Same quote/time still has a distinct immutable snapshot marker.
                snapshot = PriceSnapshot.objects.create(
                    item_id=1, run=run, best_sell=Decimal('10.00'), observed_at_ms=NOW_MS,
                )
                LatestPrice.objects.filter(item_id=1).update(snapshot=snapshot, updated_at_ms=NOW_MS)
            return execute(sql, params, many, context)

        with connection.execute_wrapper(persist_after_inventory_read):
            body = self.get().json()

        self.assertEqual(changes, 3)
        self.assertIsNone(cache.get(SOURCE_CACHE_KEY))
        self.assertEqual(body['collector']['status'], 'attention')
        self.assertIsNone(body['collector']['success_count'])
        self.assertIsNone(body['collector']['failure_count'])
        self.assertEqual(body['counts']['fresh_sell'], 1)
        self.assertTrue(all(set(row) == {'observed_at', 'has_sell', 'has_buy'} for row in body['observations']))


class MarketQualityCollectorTests(QualityFixtures):
    def test_ready_without_completed_attempt_is_waiting_not_healthy_or_recovered(self):
        self.assertEqual(self.get().json()['collector']['status'], 'waiting')

    def test_healthy_run_requires_success_not_just_ready_configuration(self):
        for success, failure, expected in [(0, 0, None), (1, 1, None), (1, 0, 2)]:
            with self.subTest(success=success, failure=failure, expected=expected):
                self.make_run(success=success, failure=failure, expected_count=expected)
                cache.delete(SOURCE_CACHE_KEY)
                self.assertEqual(self.get().json()['collector']['status'], 'attention')
        self.make_run(success=2, expected_count=2)
        cache.delete(SOURCE_CACHE_KEY)
        self.assertEqual(self.get().json()['collector']['status'], 'healthy')

    def test_failure_and_partial_have_distinct_public_states(self):
        for status in ('failed', 'partial'):
            with self.subTest(status=status):
                attempt = self.make_run(status, success=1 if status == 'partial' else 0, failure=1)
                cache.delete(SOURCE_CACHE_KEY)
                body = self.get().json()['collector']
                self.assertEqual(body['status'], status)
                self.assertEqual(body['last_attempt_at'], utc_iso(attempt.finished_at_ms))
                self.assertEqual(body['last_failure_at'], utc_iso(attempt.finished_at_ms))
                self.assertEqual(body['failure_count'], 1)

    def test_recovery_requires_new_healthy_success_after_bad_completed_attempt(self):
        self.make_run('failed', at=NOW_MS - 3000, success=0, failure=1)
        self.make_run(at=NOW_MS - 2000)
        self.assertEqual(self.get().json()['collector']['status'], 'recovered')
        self.make_run(at=NOW_MS - 1000)
        cache.delete(SOURCE_CACHE_KEY)
        self.assertEqual(self.get().json()['collector']['status'], 'healthy')

    def test_partial_attempt_can_have_success_time_without_claiming_recovery(self):
        attempt = self.make_run('partial', success=2, failure=1)

        collector = self.get().json()['collector']

        self.assertEqual(collector['status'], 'partial')
        self.assertEqual(collector['last_success_at'], utc_iso(attempt.finished_at_ms))
        self.assertEqual(collector['last_failure_at'], utc_iso(attempt.finished_at_ms))

    def assert_failed_terminal_preserves_acquisition_time(self, terminal_status, public_status):
        attempt = self.make_run(terminal_status, success=1, failure=1)
        self.item(1, sell='10.00', run=attempt)

        body = self.get().json()

        self.assertEqual(body['counts']['fresh_sell'], 1)
        self.assertEqual(body['collector']['status'], public_status)
        self.assertEqual(body['collector']['last_success_at'], utc_iso(attempt.finished_at_ms))
        self.assertEqual(body['collector']['last_failure_at'], utc_iso(attempt.finished_at_ms))

    def test_failed_attempt_with_retained_records_has_acquisition_time_without_healthy_state(self):
        self.assert_failed_terminal_preserves_acquisition_time('failed', 'failed')

    def test_auth_failure_with_retained_records_has_acquisition_time_without_recovery(self):
        self.assert_failed_terminal_preserves_acquisition_time('needs_auth', 'attention')

    def test_rate_rejection_with_retained_records_has_acquisition_time_without_healthy_state(self):
        self.assert_failed_terminal_preserves_acquisition_time('rate_limited', 'failed')

    def test_running_attempt_keeps_last_completed_counts_and_lease_expiry_reages(self):
        terminal = self.make_run(success=4)
        running = CollectionRun.objects.create(
            trigger='scheduled', status='running', created_at_ms=NOW_MS - 200,
            started_at_ms=NOW_MS - 100, lease_expires_at_ms=NOW_MS + 1000,
        )

        collector = self.get().json()['collector']
        expired = self.get(NOW_MS + 1000).json()['collector']

        self.assertEqual(collector['status'], 'collecting')
        self.assertEqual(collector['last_attempt_at'], utc_iso(running.started_at_ms))
        self.assertEqual(collector['success_count'], 4)
        self.assertEqual(collector['last_success_at'], utc_iso(terminal.finished_at_ms))
        self.assertEqual(expired['status'], 'attention')
        self.assertEqual(CollectionRun.objects.get(pk=running.pk).status, 'running')

    def test_cooldown_expiry_is_recomputed_without_new_source_reads(self):
        self.make_run('rate_limited', success=0, failure=1)
        self.config.session_status = 'cooldown'
        self.config.cooldown_until_ms = NOW_MS + 1000
        self.config.save(update_fields=['session_status', 'cooldown_until_ms'])

        self.assertEqual(self.get().json()['collector']['status'], 'retrying')
        self.assertEqual(self.get(NOW_MS + 1000).json()['collector']['status'], 'failed')

    def test_configuration_attention_and_pause_override_historical_success(self):
        self.make_run()
        for state in ('unconfigured', 'needs_auth', 'blocked', 'error'):
            with self.subTest(state=state):
                self.config.session_status = state
                self.config.save(update_fields=['session_status'])
                cache.delete(SOURCE_CACHE_KEY)
                self.assertEqual(self.get().json()['collector']['status'], 'attention')
        self.config.enabled = False
        self.config.save(update_fields=['enabled'])
        cache.delete(SOURCE_CACHE_KEY)
        self.assertEqual(self.get().json()['collector']['status'], 'paused')


class MarketQualityAccessTests(QualityFixtures):
    @override_settings(PUBLIC_READ_ACCESS_ENABLED=True)
    def test_public_switch_allows_only_read_method_with_private_no_store_response(self):
        response = self.get()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'no-store, private')
        self.assertEqual(self.client.head(URL).status_code, 200)
        for method in ('post', 'put', 'patch', 'delete'):
            with self.subTest(method=method, authenticated=False):
                self.assertEqual(getattr(self.client, method)(URL, {}, format='json').status_code, 401)
        for private_url in ('/api/market/admin/config/', '/api/market/admin/items/', '/api/market/admin/runs/'):
            with self.subTest(private_url=private_url):
                self.assertEqual(self.client.get(private_url).status_code, 401)
        self.client.force_authenticate(user=get_user_model().objects.create_user(username='viewer'))
        for method in ('post', 'put', 'patch', 'delete'):
            with self.subTest(method=method, authenticated=True):
                self.assertEqual(getattr(self.client, method)(URL, {}, format='json').status_code, 405)

    def test_permission_is_checked_even_when_shared_source_is_cached(self):
        self.get()
        self.assertIsNotNone(cache.get(SOURCE_CACHE_KEY))

        with override_settings(PUBLIC_READ_ACCESS_ENABLED=False), \
                patch('Market.quality.quality_source', side_effect=AssertionError('permission bypass')):
            response = self.get()

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response['Cache-Control'], 'no-store, private')

    @override_settings(PUBLIC_READ_ACCESS_ENABLED=False)
    def test_authenticated_active_viewer_can_read_when_public_access_is_off(self):
        user = get_user_model().objects.create_user(username='viewer')
        self.client.force_authenticate(user=user)
        self.assertEqual(self.get().status_code, 200)
        user.is_active = False
        user.save(update_fields=['is_active'])
        self.assertEqual(self.get().status_code, 403)

    def test_invalid_jwt_is_rejected_even_with_public_access_on(self):
        self.client.credentials(HTTP_AUTHORIZATION='Bearer invalid-token')
        self.assertEqual(self.get().status_code, 401)

    def test_public_payload_whitelists_collector_and_never_exposes_diagnostics(self):
        self.make_run('failed', success=0, failure=1, error_code='secret session dump', lease_owner='private worker')
        self.config.session_cursor = 19
        self.config.batch_fallback_reason = 'private operational detail'
        self.config.save(update_fields=['session_cursor', 'batch_fallback_reason'])

        body = self.get().json()

        self.assertEqual(set(body['collector']), {
            'status', 'last_attempt_at', 'last_success_at', 'last_failure_at',
            'success_count', 'failure_count',
        })
        self.assertNotIn('secret', str(body))
        self.assertNotIn('private', str(body))
        self.assertNotIn('session', str(body))
        self.assertNotIn('lease', str(body))
        self.assertNotIn('error_code', str(body))

    def test_endpoint_matches_existing_market_auth_and_throttle_configuration(self):
        from Market.quality_views import PublicQualityView
        from Market.views import PublicItemsView

        self.assertEqual(PublicQualityView.authentication_classes, PublicItemsView.authentication_classes)
        self.assertEqual(PublicQualityView.permission_classes, PublicItemsView.permission_classes)
        self.assertEqual(PublicQualityView.throttle_classes, PublicItemsView.throttle_classes)
        self.assertEqual(PublicQualityView.throttle_scope, PublicItemsView.throttle_scope)
