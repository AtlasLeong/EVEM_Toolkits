from datetime import timedelta
from time import perf_counter
from uuid import uuid4
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.exceptions import ValidationError

from TacticalBoard.models import BoardSystems
from TacticalCollaboration import services
from TacticalCollaboration.models import ConnectionLease, Force, Membership, Report
from .test_board import BoardCase


class TacticalBackendAuditTests(BoardCase):
    def test_presence_join_and_leave_advance_version_for_live_roster(self):
        before = self.org.state_version
        with patch('TacticalCollaboration.services._publish_state_event') as publish:
            with self.captureOnCommitCallbacks(execute=True):
                services.admit(self.scout, self.org.pk, self.connection_id)
        self.org.refresh_from_db()
        self.assertEqual(self.org.state_version, before + 1)
        publish.assert_called_once_with(self.org.pk, before + 1)

        publish.reset_mock()
        with patch('TacticalCollaboration.services._publish_state_event') as publish:
            with self.captureOnCommitCallbacks(execute=True):
                services.leave(self.scout, self.org.pk, self.connection_id)
        self.org.refresh_from_db()
        self.assertEqual(self.org.state_version, before + 2)
        publish.assert_called_once_with(self.org.pk, before + 2)

    def test_system_catalog_nonfinite_security_is_json_safe(self):
        BoardSystems.objects.filter(pk=1).update(security_status=float('inf'))
        self.client.raise_request_exception = False
        response = self.client.get(self.url('catalog'), {'kind': 'systems', 'q': '星系'})
        self.assertEqual(response.status_code, 200)
        rows = {row['id']: row for row in response.data['results']}
        self.assertIsNone(rows[1]['security_status'])
        self.assertEqual(rows[2]['security_status'], 0.5)

    def test_socket_snapshot_does_not_repeat_http_authorization_queries(self):
        self.admit(self.scout)
        generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, self.connection_id, generation)
        with CaptureQueriesContext(connection) as http_queries:
            expected = services.snapshot(self.scout, self.org.pk, self.connection_id)
        with CaptureQueriesContext(connection) as socket_queries:
            actual = services.socket_snapshot(self.scout, self.org.pk, self.connection_id, generation)
        self.assertEqual({key: value for key, value in actual.items() if key != 'server_time'},
                         {key: value for key, value in expected.items() if key != 'server_time'})
        http_reads = [row['sql'] for row in http_queries if row['sql'].startswith('SELECT')]
        socket_reads = [row['sql'] for row in socket_queries if row['sql'].startswith('SELECT')]
        self.assertEqual(len(socket_reads), len(http_reads), socket_reads)

    def test_socket_snapshot_missing_generation_cannot_fall_back_to_http_lease(self):
        self.admit(self.scout)
        for invalid in (None, '', 'invalid'):
            with self.subTest(generation=invalid), self.assertRaises(ValidationError):
                services.socket_snapshot(self.scout, self.org.pk, self.connection_id, invalid)

    def test_snapshot_exposes_monotonic_state_version_without_locking_org(self):
        self.admit(self.scout)
        generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, self.connection_id, generation)
        self.org.state_version = 7
        self.org.save(update_fields=['state_version'])
        with CaptureQueriesContext(connection) as queries:
            state = services.socket_snapshot(self.scout, self.org.pk, self.connection_id, generation)
        self.assertEqual(state['state_version'], 7)
        self.assertFalse(any('FOR UPDATE' in row['sql'].upper() for row in queries))

    def test_command_advances_state_version_once(self):
        self.admit(self.owner)
        self.org.refresh_from_db()
        before = self.org.state_version
        result = services.command(self.owner, self.org.pk, {
            'action': 'report.create', 'request_id': str(uuid4()),
            'connection_id': str(self.connection_id), **self.content(),
        })
        self.assertEqual(result['state_version'], before + 1)
        self.org.refresh_from_db()
        self.assertEqual(self.org.state_version, before + 1)

    def test_hundred_account_round_keeps_queries_bounded_and_scouts_private(self):
        self.admit(self.scout)
        first_generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, self.connection_id, first_generation)
        with CaptureQueriesContext(connection) as small:
            services.socket_snapshot(self.scout, self.org.pk, self.connection_id, first_generation)
        small_reads = sum(row['sql'].startswith('SELECT') for row in small)

        users = get_user_model().objects.bulk_create([
            get_user_model()(username=f'audit-load-{index}') for index in range(99)
        ])
        Membership.objects.bulk_create([Membership(organization=self.org, user=user) for user in users])
        sockets = [(self.scout, self.connection_id, first_generation)]
        leases = []
        for user in users:
            connection_id, generation = uuid4(), uuid4()
            sockets.append((user, connection_id, generation))
            leases.append(ConnectionLease(organization=self.org, user=user, connection_id=connection_id,
                                          socket_generation=generation,
                                          expires_at=timezone.now() + timedelta(minutes=5)))
        ConnectionLease.objects.bulk_create(leases)
        observations = Report.objects.bulk_create([
            Report(organization=self.org, author=user, report_kind='fleet_intel', fleet_name=f'Fleet {index}',
                   system_name='星系1', **self.content())
            for index, (user, _, _) in enumerate(sockets)
        ])
        forces = Force.objects.bulk_create([
            Force(organization=self.org, name=report.fleet_name, side='enemy', source_report=report,
                  system_name='星系1', **self.content()) for report in observations
        ])
        for report, force in zip(observations, forces):
            report.linked_force = force
        Report.objects.bulk_update(observations, ['linked_force'])
        Force.objects.create(organization=self.org, name='PRIVATE_FRIENDLY', side='friendly',
                             system_name='星系1', **self.content(notes='PRIVATE_NOTES'))
        started = perf_counter()
        with CaptureQueriesContext(connection) as hundred:
            for user, connection_id, generation in sockets:
                state = services.socket_snapshot(user, self.org.pk, connection_id, generation)
                self.assertEqual(state['online_count'], 100)
                self.assertEqual(len(state['forces']), 100)
                self.assertEqual(len(state['reports']), 100)
                self.assertNotIn('online', state)
                self.assertNotIn('member_count', state)
                self.assertNotIn('PRIVATE_', str(state))
        read_count = sum(row['sql'].startswith('SELECT') for row in hundred)
        self.assertEqual(read_count, small_reads * 100)
        print(f'AUDIT: 100-account sequential snapshot round; forces=100 reports=100; '
              f'SELECTs={read_count}; elapsed={perf_counter() - started:.3f}s')
