"""Real bounded history reads in disposable SQLite; no production tables."""
from datetime import datetime, timezone

from django.contrib.auth import get_user_model
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework_simplejwt.tokens import AccessToken

from .models import FraudAuthUserGroup, FraudBehaviorFlow
from .serializers import FraudBehaviorFlowSerializer
from .views import GetAdminBehaviorFlow


class FraudHistoryTests(TestCase):
    @classmethod
    def setUpClass(cls):
        with connection.schema_editor() as editor:
            editor.create_model(FraudAuthUserGroup)
            editor.create_model(FraudBehaviorFlow)
        super().setUpClass()

    @classmethod
    def tearDownClass(cls):
        super().tearDownClass()
        with connection.schema_editor() as editor:
            editor.delete_model(FraudBehaviorFlow)
            editor.delete_model(FraudAuthUserGroup)

    def setUp(self):
        self.factory = APIRequestFactory()
        self.view = GetAdminBehaviorFlow.as_view()
        self.user = get_user_model().objects.create_user('history-admin', email='history@example.com')
        self.actor = get_user_model().objects.create_user('history-actor', email='actor@example.com')
        FraudAuthUserGroup.objects.create(user_id=self.user.pk, group_id=11)

    def row(self, operation_id, change='B', group=11, actor='default', **fields):
        return FraudBehaviorFlow.objects.create(
            operation_id=operation_id, change=change, source_group_id=group,
            operation_user_id=self.actor.pk if actor == 'default' else actor,
            action_type='update', fraud_account=str(operation_id),
            **fields,
        )

    def read(self, query='', *, user='default', token=None):
        request = self.factory.get('/api/fraudbehaviorflow' + query,
                                   **({'HTTP_AUTHORIZATION': f'Bearer {token}'} if token else {}))
        if not token and user is not None:
            force_authenticate(request, self.user if user == 'default' else user)
        return self.view(request)

    def test_explicit_page_counts_anchors_and_keeps_before_after_together(self):
        first = self.row('first', remark='before first')
        self.row('first', 'F', remark='after first')
        for index in range(19):
            self.row(f'add-{index}', change=None, actor=None)
        newest = self.row('newest', remark='before newest')
        newest_after = self.row('newest', 'F', remark='after newest')
        response = self.read('?page=1&page_size=20')
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.data, dict)
        self.assertEqual(response.data['count'], 21)
        self.assertEqual(response.data['page'], 1)
        self.assertEqual(response.data['page_size'], 20)
        self.assertTrue(response.data['has_next'])
        rows = response.data['results']
        anchors = [row for row in rows if row['change'] != 'F']
        self.assertEqual(anchors[0]['id'], newest.pk)
        self.assertEqual(len(anchors), 20)
        self.assertIn(newest_after.pk, [row['id'] for row in rows])
        second = self.read('?page=2&page_size=20').data
        self.assertEqual([row['id'] for row in second['results'] if row['change'] != 'F'], [first.pk])
        self.assertEqual([row['remark'] for row in second['results']], ['before first', 'after first'])
        self.assertFalse(second['has_next'])

    def test_legacy_array_is_bounded_and_stably_newest_first(self):
        for index in range(24):
            self.row(f'op-{index}', change_time=datetime(2026, 1, 1, tzinfo=timezone.utc) if index % 2 else None)
            self.row(f'op-{index}', 'F')
        response = self.read()
        self.assertIsInstance(response.data, list)
        anchors = [row for row in response.data if row['change'] != 'F']
        self.assertEqual(len(anchors), 20)
        self.assertEqual(len(response.data), 40)
        self.assertEqual([row['id'] for row in anchors], sorted((row['id'] for row in anchors), reverse=True))
        self.assertIn('private', response['Cache-Control'])
        self.assertIn('no-store', response['Cache-Control'])

    def test_duplicate_and_blank_operation_ids_have_bounded_safe_after_rows(self):
        self.row(None)
        self.row(None, 'F', remark='unrelated null')
        self.row('')
        self.row('', 'F', remark='unrelated empty')
        self.row('   ')
        self.row('   ', 'F', remark='unrelated blank')
        self.row('duplicate')
        self.row('duplicate')
        first = self.row('duplicate', 'F', remark='first authorized after')
        for index in range(105):
            self.row('duplicate', 'F', remark=f'duplicate after {index}')
        response = self.read('?page=1&page_size=50')
        self.assertIsInstance(response.data, dict)
        rows = response.data['results']
        self.assertEqual(response.data['count'], 5)
        self.assertEqual([row['id'] for row in rows if row['change'] == 'F'], [first.pk])
        self.assertLessEqual(len(rows), 10)

    def test_cross_group_after_versions_and_foreign_anchors_are_never_added(self):
        visible = self.row('cross', remark='authorized before')
        self.row('cross', 'F', group=99, remark='private after')
        self.row('private', group=99)
        response = self.read('?page=1')
        self.assertIsInstance(response.data, dict)
        self.assertEqual(response.data['count'], 1)
        self.assertEqual([row['id'] for row in response.data['results']], [visible.pk])
        self.assertNotIn('private after', str(response.data))

    def test_deleted_and_null_actors_still_render_as_null(self):
        self.row('missing', actor=2147483647)
        self.row('null', actor=None)
        self.actor.delete()
        response = self.read('?page=1')
        self.assertIsInstance(response.data, dict)
        self.assertEqual([row['username'] for row in response.data['results']], [None, None])

    def test_page_query_count_is_constant_for_twenty_and_fifty_operations(self):
        for index in range(55):
            self.row(f'pair-{index}')
            self.row(f'pair-{index}', 'F')
        counts = []
        for size in (20, 50):
            with CaptureQueriesContext(connection) as captured:
                response = self.read(f'?page=1&page_size={size}')
                self.assertIsInstance(response.data, dict)
                self.assertEqual(len(response.data['results']), size * 2)
            counts.append(len(captured))
            self.assertLessEqual(len(captured), 6, [entry['sql'] for entry in captured])
            users = [entry['sql'] for entry in captured if get_user_model()._meta.db_table.lower() in entry['sql'].lower()]
            self.assertEqual(len(users), 1)
            self.assertTrue(any(f'LIMIT {size}' in entry['sql'] for entry in captured))
        self.assertEqual(counts[0], counts[1])

    def test_invalid_params_fail_without_history_queries(self):
        invalid = ('?page=0', '?page=-1', '?page=1.0', '?page=true', '?page=%EF%BC%91',
                   '?page=10001', '?page=999999999999999999999999999', '?page=',
                   '?page_size=0', '?page_size=51', '?page_size=1.5', '?page=1&page=2',
                   '?page_size=20&page_size=20', '?unknown=1')
        for query in invalid:
            with self.subTest(query=query), CaptureQueriesContext(connection) as captured:
                response = self.read(query)
                self.assertEqual(response.status_code, 400)
                self.assertFalse(any('fraud_behavior_flow' in row['sql'] for row in captured))

    def test_page_size_only_and_empty_out_of_range_page(self):
        self.row('only')
        response = self.read('?page_size=50')
        self.assertIsInstance(response.data, dict)
        self.assertEqual(response.data['page'], 1)
        self.assertEqual(response.data['page_size'], 50)
        response = self.read('?page=10000')
        self.assertEqual(response.data['results'], [])
        self.assertEqual(response.data['count'], 1)
        self.assertFalse(response.data['has_next'])

    def test_anonymous_nonmember_and_current_jwt_revocation_are_denied(self):
        self.assertEqual(self.read(user=None).status_code, 401)
        other = get_user_model().objects.create_user('nonmember', email='nonmember@example.com')
        self.assertEqual(self.read(user=other).status_code, 401)
        token = str(AccessToken.for_user(self.user))
        self.assertEqual(self.read('?page=1', token=token).status_code, 200)
        FraudAuthUserGroup.objects.filter(user_id=self.user.pk).delete()
        response = self.read('?page=1', token=token)
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('results', response.data)
        self.assertEqual(self.read('?page=1', token='invalid').status_code, 401)

    def test_serializer_only_uses_the_supplied_actor_map(self):
        row = self.row('serializer')
        with self.assertNumQueries(0):
            self.assertEqual(FraudBehaviorFlowSerializer(row, context={'actor_names': {self.actor.pk: 'batched'}}).data['username'], 'batched')
            self.assertIsNone(FraudBehaviorFlowSerializer(row).data['username'])
