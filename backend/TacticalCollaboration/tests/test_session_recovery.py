"""Recovery must retry transport state, never relax business authorization."""
import asyncio
import json
import time
from collections import deque
from datetime import timedelta
from unittest.mock import AsyncMock
from uuid import uuid4

from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied

from TacticalCollaboration import services
from TacticalCollaboration.models import Board, CommandReceipt, ConnectionLease, Membership, Report
from TacticalCollaboration.realtime import TacticalConsumer
from .test_board import BoardCase


class CommandRecoveryTests(BoardCase):
    def report_body(self):
        return {'action': 'report.create', 'request_id': str(uuid4()),
                'connection_id': self.connection_id, 'report_kind': 'system_count',
                **self.content(ships={})}

    def test_saved_report_replays_after_reload_with_a_new_lease(self):
        self.admit(self.scout)
        body = self.report_body()
        first = self.post('commands', body)
        self.assertEqual(first.status_code, 200, first.content)
        self.admit(self.scout)
        retried = self.post('commands', {**body, 'connection_id': self.connection_id})
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(retried.data, first.data)
        self.assertEqual(Report.objects.count(), 1)

    def test_new_lease_does_not_allow_changed_business_content(self):
        self.admit(self.scout)
        body = self.report_body()
        self.assertEqual(self.post('commands', body).status_code, 200)
        self.admit(self.scout)
        changed = {**body, 'connection_id': self.connection_id, 'people': 99}
        self.assertEqual(self.post('commands', changed).status_code, 409)
        self.assertEqual(Report.objects.count(), 1)

    def test_receipt_replay_still_requires_active_membership_and_valid_lease(self):
        self.admit(self.scout)
        body = self.report_body()
        self.assertEqual(self.post('commands', body).status_code, 200)
        self.assertEqual(self.post('commands', {**body, 'connection_id': str(uuid4())}).status_code, 403)
        Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
        self.assertEqual(self.post('commands', body).status_code, 403)

    def test_nondefault_boards_replay_independently_and_reject_foreign_board(self):
        self.admit(self.scout)
        board = Board.objects.create(organization=self.org, name='第二战区', kind='war')
        body = {**self.report_body(), 'board_id': board.pk}
        first = self.post('commands', body)
        self.assertEqual(first.status_code, 200, first.content)
        self.admit(self.scout)
        retried = self.post('commands', {**body, 'connection_id': self.connection_id})
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(retried.data, first.data)
        self.assertEqual(self.post('commands', {**body, 'connection_id': self.connection_id,
                                               'board_id': board.pk + 999}).status_code, 404)

    def test_exact_legacy_receipt_replay_upgrades_hash_then_accepts_new_lease(self):
        self.admit(self.scout)
        body = self.report_body()
        first = self.post('commands', body)
        self.assertEqual(first.status_code, 200)
        row = CommandReceipt.objects.get(request_id=body['request_id'])
        # Existing deployments stored the full payload including connection_id.
        row.payload_hash = services.digest(body)
        row.save(update_fields=['payload_hash'])
        self.assertEqual(self.post('commands', body).data, first.data)
        self.admit(self.scout)
        retried = self.post('commands', {**body, 'connection_id': self.connection_id})
        self.assertEqual(retried.status_code, 200, retried.content)
        self.assertEqual(retried.data, first.data)

    def test_unverifiable_legacy_hash_remains_a_conflict_not_a_duplicate_write(self):
        self.admit(self.scout)
        body = self.report_body()
        self.assertEqual(self.post('commands', body).status_code, 200)
        CommandReceipt.objects.filter(request_id=body['request_id']).update(payload_hash=services.digest(body))
        self.admit(self.scout)
        self.assertEqual(self.post('commands', {**body, 'connection_id': self.connection_id}).status_code, 409)
        self.assertEqual(Report.objects.count(), 1)


class LeaseRecoveryTests(BoardCase):
    def expired_socket(self):
        self.admit(self.scout)
        generation = str(uuid4())
        services.claim_socket(self.scout, self.org.pk, self.connection_id, generation)
        ConnectionLease.objects.filter(connection_id=self.connection_id).update(
            expires_at=timezone.now() - timedelta(seconds=1))
        return generation

    def test_expired_socket_is_recoverable_for_cursor_snapshot_and_heartbeat(self):
        generation = self.expired_socket()
        for operation in (services.socket_state_version, services.socket_snapshot, services.socket_heartbeat):
            with self.subTest(operation=operation.__name__), self.assertRaises(PermissionDenied) as failure:
                operation(self.scout, self.org.pk, self.connection_id, generation)
            self.assertEqual(failure.exception.get_codes(), 'lease_expired')

    def test_removed_member_is_not_misclassified_as_an_expired_lease(self):
        generation = self.expired_socket()
        Membership.objects.filter(organization=self.org, user=self.scout).update(status='removed')
        for operation in (services.socket_state_version, services.socket_snapshot, services.socket_heartbeat):
            with self.subTest(operation=operation.__name__), self.assertRaises(PermissionDenied) as failure:
                operation(self.scout, self.org.pk, self.connection_id, generation)
            self.assertNotEqual(failure.exception.get_codes(), 'lease_expired')

    def test_superseded_generation_is_not_recoverable_even_when_lease_expired(self):
        generation = self.expired_socket()
        replacement = str(uuid4())
        ConnectionLease.objects.filter(connection_id=self.connection_id).update(socket_generation=replacement)
        for operation in (services.socket_state_version, services.socket_snapshot, services.socket_heartbeat):
            with self.subTest(operation=operation.__name__), self.assertRaises(PermissionDenied) as failure:
                operation(self.scout, self.org.pk, self.connection_id, generation)
            self.assertEqual(failure.exception.get_codes(), 'socket_superseded')

    def test_http_expiry_code_allows_readmission_without_revoking_member(self):
        self.expired_socket()
        response = self.snapshot()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data.get('code'), 'lease_expired')
        services.admit(self.scout, self.org.pk, self.connection_id)
        self.assertEqual(self.snapshot().status_code, 200)


class LeaseTransportTests(SimpleTestCase):
    def consumer(self):
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.admitted = True
        consumer.state_version = 1
        consumer.expires_at = time.time() + 60
        consumer.io_lock = asyncio.Lock()
        consumer.received_at = deque()
        consumer.channel_group = None
        consumer.close = AsyncMock()
        return consumer

    @override_settings(TACTICAL_POLL_SECONDS=0)
    async def test_expired_lease_uses_recoverable_close_code_in_every_delivery_path(self):
        for path in ('poll', 'ping', 'event'):
            with self.subTest(path=path):
                consumer = self.consumer()
                failure = PermissionDenied('连接已过期', code='lease_expired')
                consumer.get_state_version = AsyncMock(side_effect=failure)
                consumer.get_snapshot = AsyncMock(side_effect=failure)
                consumer.admit = AsyncMock(side_effect=failure)
                if path == 'poll':
                    await consumer.poll()
                elif path == 'ping':
                    await consumer.receive(text_data=json.dumps({'type': 'ping'}))
                else:
                    await consumer.tactical_state_event({'state_version': 2})
                consumer.close.assert_awaited_once_with(code=4408)

    async def test_real_revocation_and_supersession_keep_terminal_close_code(self):
        for code in ('permission_denied', 'socket_superseded'):
            consumer = self.consumer()
            consumer.get_snapshot = AsyncMock(side_effect=PermissionDenied(code=code))
            await consumer.tactical_state_event({'state_version': 2})
            consumer.close.assert_awaited_once_with(code=4403)
