"""Transport contract tests; domain authorization is tested in the real app suite."""
import asyncio
import importlib.util
import json
import time
from unittest.mock import AsyncMock, patch

from asgiref.testing import ApplicationCommunicator
from django.test import SimpleTestCase, override_settings
from django.conf import settings


class TacticalTransportTests(SimpleTestCase):
    def test_ci_channel_layer_is_configured(self):
        self.assertEqual(
            settings.CHANNEL_LAYERS['default']['BACKEND'],
            'channels.layers.InMemoryChannelLayer',
        )

    def test_transport_exists(self):
        self.assertIsNotNone(importlib.util.find_spec('TacticalCollaboration.realtime'))

    async def connect(self, origin='http://127.0.0.1:4194', query=b''):
        from TacticalCollaboration.realtime import TacticalConsumer
        client = ApplicationCommunicator(TacticalConsumer.as_asgi(), {
            'type': 'websocket', 'path': '/ws/tactical/1/',
            'url_route': {'kwargs': {'organization_id': '1'}},
            'headers': [(b'origin', origin.encode())], 'query_string': query,
            'subprotocols': [],
        })
        await client.send_input({'type': 'websocket.connect'})
        return client

    async def finish(self, client):
        await client.send_input({'type': 'websocket.disconnect', 'code': 1000})
        await client.wait(timeout=2)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_rejects_foreign_origin_and_url_credentials(self):
        for origin, query in [('https://attacker.invalid', b''), ('http://127.0.0.1:4194', b'token=secret')]:
            client = await self.connect(origin, query)
            self.assertEqual((await client.receive_output())['type'], 'websocket.close')
            await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_authentication_precedes_admission_and_state(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        with patch.object(TacticalConsumer, 'authenticate', new=AsyncMock(return_value=(object(), time.time() + 60))), \
             patch.object(TacticalConsumer, 'admit', new=AsyncMock()) as admit, \
             patch.object(TacticalConsumer, 'get_snapshot', new=AsyncMock(return_value={'role': 'scout', 'forces': [], 'server_time': 'now'})), \
             patch.object(TacticalConsumer, 'leave', new=AsyncMock()):
            client = await self.connect()
            self.assertEqual((await client.receive_output())['type'], 'websocket.accept')
            self.assertFalse(admit.called)
            await client.send_input({'type': 'websocket.receive', 'text': json.dumps({
                'type': 'authenticate', 'token': 'test', 'connection_id': 'cc7e503b-b012-4056-b004-665d4157c519',
            })})
            frame = json.loads((await client.receive_output())['text'])
            self.assertEqual(frame['type'], 'snapshot')
            self.assertEqual(frame['data']['role'], 'scout')
            admit.assert_awaited_once()
            await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_invalid_token_never_reads_snapshot(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        with patch.object(TacticalConsumer, 'authenticate', new=AsyncMock(side_effect=ValueError('secret diagnostic'))), \
             patch.object(TacticalConsumer, 'get_snapshot', new=AsyncMock()) as snapshot:
            client = await self.connect()
            await client.receive_output()
            await client.send_input({'type': 'websocket.receive', 'text': json.dumps({
                'type': 'authenticate', 'token': 'forged', 'connection_id': 'cc7e503b-b012-4056-b004-665d4157c519',
            })})
            frame = await client.receive_output()
            self.assertNotIn('secret diagnostic', str(frame))
            self.assertEqual(frame['type'], 'websocket.close')
            snapshot.assert_not_called()
            await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_permission_revocation_closes_live_channel(self):
        from rest_framework.exceptions import PermissionDenied
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.admitted = True
        consumer.state_version = 1
        consumer.expires_at = time.time() + 60
        consumer.io_lock = asyncio.Lock()
        consumer.channel_group = None
        consumer.close = AsyncMock()
        consumer.get_snapshot = AsyncMock(side_effect=PermissionDenied())
        await consumer.tactical_state_event({'state_version': 2})
        consumer.close.assert_awaited_once_with(code=4403)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'], TACTICAL_POLL_SECONDS=0.01)
    async def test_admitted_socket_refreshes_after_external_wsgi_write(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        snapshots = AsyncMock(side_effect=[
            {'state_version': 1, 'forces': []},
            {'state_version': 2, 'forces': [{'id': 1, 'people': 80}]},
            {'state_version': 2, 'forces': [{'id': 1, 'people': 80}]},
        ])
        with patch.object(TacticalConsumer, 'authenticate', new=AsyncMock(return_value=(object(), time.time() + 60))), \
             patch.object(TacticalConsumer, 'admit', new=AsyncMock()), \
             patch.object(TacticalConsumer, 'get_state_version', new=AsyncMock(return_value=2)), \
             patch.object(TacticalConsumer, 'get_snapshot', new=snapshots), \
             patch.object(TacticalConsumer, 'leave', new=AsyncMock()):
            client = await self.connect()
            await client.receive_output()
            await client.send_input({'type': 'websocket.receive', 'text': json.dumps({
                'type': 'authenticate', 'token': 'test', 'connection_id': 'cc7e503b-b012-4056-b004-665d4157c519',
            })})
            first = json.loads((await client.receive_output())['text'])
            self.assertEqual(first['data']['state_version'], 1)
            refreshed = json.loads((await client.receive_output(timeout=1))['text'])
            self.assertEqual(refreshed['data']['forces'][0]['people'], 80)
            await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'], TACTICAL_POLL_SECONDS=0.01)
    async def test_idle_socket_checks_cursor_without_rebuilding_full_snapshot(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        snapshots = AsyncMock(return_value={'state_version': 1, 'forces': []})
        with patch.object(TacticalConsumer, 'authenticate', new=AsyncMock(return_value=(object(), time.time() + 60))), \
             patch.object(TacticalConsumer, 'admit', new=AsyncMock()), \
             patch.object(TacticalConsumer, 'get_state_version', new=AsyncMock(return_value=1)) as cursor, \
             patch.object(TacticalConsumer, 'get_snapshot', new=snapshots):
            client = await self.connect()
            await client.receive_output()
            await client.send_input({'type': 'websocket.receive', 'text': json.dumps({
                'type': 'authenticate', 'token': 'test', 'connection_id': 'cc7e503b-b012-4056-b004-665d4157c519',
            })})
            await client.receive_output()
            await asyncio.sleep(0.06)
            self.assertGreater(cursor.await_count, 0)
            self.assertEqual(snapshots.await_count, 1)
            await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'], TACTICAL_AUTH_SECONDS=0.02)
    async def test_unauthenticated_connection_times_out(self):
        client = await self.connect()
        await client.receive_output()
        self.assertEqual((await client.receive_output(timeout=1))['code'], 4401)
        await self.finish(client)

    def test_fingerprint_ignores_clock_and_transport_cursor_not_permissions_or_forces(self):
        from TacticalCollaboration.realtime import snapshot_fingerprint
        value = {'server_time': 'a', 'state_version': 1, 'role': 'scout', 'forces': [{'id': 1, 'people': 4}]}
        self.assertEqual(snapshot_fingerprint(value), snapshot_fingerprint({**value, 'server_time': 'b'}))
        self.assertEqual(snapshot_fingerprint(value), snapshot_fingerprint({**value, 'state_version': 2}))
        self.assertNotEqual(snapshot_fingerprint(value), snapshot_fingerprint({**value, 'forces': []}))
        self.assertNotEqual(snapshot_fingerprint(value), snapshot_fingerprint({**value, 'role': 'commander'}))

    async def test_unrelated_board_cursor_advance_does_not_resend_unchanged_snapshot(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.last_fingerprint = None
        consumer.state_version = 0
        consumer.expires_at = time.time() + 60
        consumer.get_snapshot = AsyncMock(side_effect=[
            {'state_version': 1, 'forces': [{'id': 1, 'people': 4}]},
            {'state_version': 2, 'forces': [{'id': 1, 'people': 4}]},
        ])
        consumer.send_json = AsyncMock()
        await consumer.publish_state()
        await consumer.publish_state()
        self.assertEqual(consumer.state_version, 2)
        consumer.send_json.assert_awaited_once()

    async def test_initial_snapshot_seeds_state_version_cursor(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.last_fingerprint = None
        consumer.state_version = 0
        consumer.expires_at = time.time() + 60
        consumer.get_snapshot = AsyncMock(return_value={'state_version': 7, 'forces': []})
        consumer.send_json = AsyncMock()
        await consumer.publish_state()
        self.assertEqual(consumer.state_version, 7)

    async def test_jwt_expiry_watch_closes_authenticated_socket(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.expires_at = time.time() - 1
        consumer.channel_group = None
        consumer.close = AsyncMock()
        await consumer.expiry_watch()
        consumer.close.assert_awaited_once_with(code=4401)

    async def test_shutdown_is_idempotent(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.close = AsyncMock()
        await consumer.shutdown(4403)
        await consumer.shutdown(1011)
        consumer.close.assert_awaited_once_with(code=4403)

    async def test_peer_closed_before_disconnect_event_is_safe(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.close = AsyncMock(side_effect=RuntimeError("Unexpected ASGI message 'websocket.close', after sending 'websocket.close' or response already completed."))
        await consumer.shutdown(4403)
        self.assertTrue(consumer.closing)

    async def test_peer_disappearing_during_send_stops_without_second_close(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        consumer = TacticalConsumer()
        consumer.closing = False
        consumer.last_fingerprint = None
        consumer.expires_at = time.time() + 60
        consumer.get_snapshot = AsyncMock(return_value={'forces': []})
        consumer.send_json = AsyncMock(side_effect=OSError('connection disconnected'))
        consumer.close = AsyncMock()
        await consumer.publish_state()
        self.assertTrue(consumer.closing)
        consumer.close.assert_not_awaited()

    async def test_slow_database_read_cannot_publish_after_expiry_or_disconnect(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        for expiry in [True, False]:
            consumer = TacticalConsumer()
            consumer.closing = False
            consumer.last_fingerprint = None
            consumer.expires_at = time.time() + 60
            async def finish_read():
                if expiry: consumer.expires_at = time.time() - 1
                else: consumer.closing = True
                return {'forces': []}
            consumer.get_snapshot = finish_read
            consumer.send_json = AsyncMock()
            consumer.close = AsyncMock()
            await consumer.publish_state()
            consumer.send_json.assert_not_awaited()

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_deeply_nested_json_is_closed_not_unhandled(self):
        client = await self.connect()
        await client.receive_output()
        await client.send_input({'type': 'websocket.receive', 'text': '[' * 1500 + '0' + ']' * 1500})
        self.assertEqual((await client.receive_output())['code'], 4400)
        await self.finish(client)

    @override_settings(TACTICAL_ALLOWED_ORIGINS=['http://127.0.0.1:4194'])
    async def test_old_socket_disconnect_does_not_delete_reconnected_tab_lease(self):
        from TacticalCollaboration.realtime import TacticalConsumer
        with patch.object(TacticalConsumer, 'authenticate', new=AsyncMock(return_value=(object(), time.time() + 60))), \
             patch.object(TacticalConsumer, 'admit', new=AsyncMock()), \
             patch.object(TacticalConsumer, 'get_snapshot', new=AsyncMock(return_value={'forces': []})), \
             patch.object(TacticalConsumer, 'leave', new=AsyncMock()) as leave:
            client = await self.connect()
            await client.receive_output()
            await client.send_input({'type': 'websocket.receive', 'text': json.dumps({
                'type': 'authenticate', 'token': 'test', 'connection_id': 'cc7e503b-b012-4056-b004-665d4157c519',
            })})
            await client.receive_output()
            await self.finish(client)
            leave.assert_not_awaited()
