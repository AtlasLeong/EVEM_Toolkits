"""Authenticated, role-filtered state delivery. The database remains authoritative."""
import asyncio
from collections import deque
import hashlib
import json
import logging
import time
from uuid import UUID, uuid4

from channels.db import database_sync_to_async
from channels.generic.websocket import AsyncJsonWebsocketConsumer
from django.conf import settings
from rest_framework.exceptions import APIException

logger = logging.getLogger(__name__)


def transport_closed(error):
    # ASGI 2.4 uses OSError; Uvicorn's pinned legacy websockets adapter can
    # instead report its already-closed state before disconnect is dispatched.
    return isinstance(error, OSError) or (
        isinstance(error, RuntimeError) and str(error).startswith("Unexpected ASGI message 'websocket.")
        and 'response already completed' in str(error)
    )


def snapshot_fingerprint(value):
    stable = {key: item for key, item in value.items() if key != 'server_time'}
    return hashlib.sha256(json.dumps(stable, sort_keys=True, ensure_ascii=True, separators=(',', ':')).encode()).hexdigest()


class TacticalConsumer(AsyncJsonWebsocketConsumer):
    async def connect(self):
        self.actor = None
        self.connection_id = None
        self.socket_generation = str(uuid4())
        self.admitted = False
        self.closing = False
        self.poll_task = None
        self.auth_task = None
        self.expiry_task = None
        self.last_fingerprint = None
        self.received_at = deque()
        self.io_lock = asyncio.Lock()
        origins = [value.decode('ascii', errors='replace') for key, value in self.scope.get('headers', []) if key.lower() == b'origin']
        allowed = getattr(settings, 'TACTICAL_ALLOWED_ORIGINS', [])
        if len(origins) != 1 or origins[0] not in allowed or self.scope.get('query_string'):
            await self.shutdown(4403)
            return
        try:
            self.organization_id = int(self.scope['url_route']['kwargs']['organization_id'])
        except (KeyError, TypeError, ValueError):
            await self.shutdown(4404)
            return
        await self.accept()
        self.auth_task = asyncio.create_task(self.authentication_deadline())

    async def authentication_deadline(self):
        await asyncio.sleep(getattr(settings, 'TACTICAL_AUTH_SECONDS', 5))
        if not self.admitted:
            await self.shutdown(4401)

    async def expiry_watch(self):
        try:
            await asyncio.sleep(max(0, self.expires_at - time.time()))
            if not self.closing:
                await self.shutdown(4401)
        except asyncio.CancelledError:
            return

    async def receive(self, text_data=None, bytes_data=None, **kwargs):
        if self.closing:
            return
        if bytes_data is not None or text_data is None or len(text_data.encode('utf-8')) > 4096:
            await self.shutdown(4400)
            return
        try:
            content = json.loads(text_data)
        except (ValueError, TypeError, RecursionError):
            await self.shutdown(4400)
            return
        if not isinstance(content, dict):
            await self.shutdown(4400)
            return
        now = time.monotonic()
        while self.received_at and self.received_at[0] < now - 60:
            self.received_at.popleft()
        self.received_at.append(now)
        if len(self.received_at) > 30:
            await self.shutdown(4429)
            return
        async with self.io_lock:
            if not self.admitted:
                if content.get('type') != 'authenticate':
                    await self.shutdown(4401)
                    return
                try:
                    token = content.get('token')
                    if not isinstance(token, str) or not token:
                        raise ValueError('missing token')
                    self.connection_id = str(UUID(str(content.get('connection_id', ''))))
                    self.actor, self.expires_at = await self.authenticate(token)
                except Exception:
                    await self.shutdown(4401)
                    return
                try:
                    await self.admit()
                    self.admitted = True
                    if self.closing:
                        return
                    if self.auth_task:
                        self.auth_task.cancel()
                    self.expiry_task = asyncio.create_task(self.expiry_watch())
                    await self.publish_state()
                except APIException as error:
                    await self.shutdown(4409 if error.status_code in (409, 429) else 4403)
                    return
                except Exception:
                    logger.exception('Tactical channel admission failed')
                    await self.shutdown(1011)
                    return
                self.channel_group = f'tactical-org-{self.organization_id}'
                await self.channel_layer.group_add(self.channel_group, self.channel_name)
            elif content.get('type') == 'ping':
                if time.time() >= self.expires_at:
                    await self.shutdown(4401)
                    return
                try:
                    await self.admit()
                except APIException:
                    await self.shutdown(4403)
                except Exception:
                    logger.exception('Tactical heartbeat failed')
                    await self.shutdown(1011)
            else:
                await self.shutdown(4400)

    async def publish_state(self):
        value = await self.get_snapshot()
        if self.closing:
            return
        if time.time() >= self.expires_at:
            await self.shutdown(4401)
            return
        incoming_version = value.get('state_version')
        if isinstance(incoming_version, int) and incoming_version >= 0:
            self.state_version = max(getattr(self, 'state_version', 0), incoming_version)
        fingerprint = snapshot_fingerprint(value)
        if fingerprint != self.last_fingerprint:
            # Backpressure is bounded: no unbounded application-side send queue.
            try:
                await asyncio.wait_for(self.send_json({'type': 'snapshot', 'data': value}), timeout=5)
            except (OSError, RuntimeError) as error:
                if not transport_closed(error):
                    raise
                self.closing = True
                return
            self.last_fingerprint = fingerprint

    async def poll(self):
        try:
            while not self.closing:
                await asyncio.sleep(getattr(settings, 'TACTICAL_POLL_SECONDS', 1.0))
                async with self.io_lock:
                    if time.time() >= self.expires_at:
                        await self.shutdown(4401)
                        return
                    await self.publish_state()
        except asyncio.CancelledError:
            return
        except APIException:
            await self.shutdown(4403)
        except Exception:
            logger.exception('Tactical state delivery failed')
            await self.shutdown(1011)

    async def tactical_state_event(self, event):
        if self.closing or not self.admitted:
            return
        incoming = event.get('state_version')
        current = getattr(self, 'state_version', 0)
        if incoming is not None and not (incoming > current):
            return
        if incoming is not None:
            self.state_version = incoming
        try:
            async with self.io_lock:
                await self.publish_state()
        except APIException:
            await self.shutdown(4403)
        except Exception:
            logger.exception('Tactical state event delivery failed')
            await self.shutdown(1011)

    async def shutdown(self, code):
        if self.closing:
            return
        self.closing = True
        if getattr(self, 'channel_group', None):
            await self.channel_layer.group_discard(self.channel_group, self.channel_name)
        try:
            await self.close(code=code)
        except (OSError, RuntimeError) as error:
            if not transport_closed(error):
                raise

    async def disconnect(self, close_code):
        self.closing = True
        if getattr(self, 'channel_group', None):
            await self.channel_layer.group_discard(self.channel_group, self.channel_name)
        for task in (self.auth_task, self.poll_task, self.expiry_task):
            if task and task is not asyncio.current_task():
                task.cancel()
                try:
                    await task
                except asyncio.CancelledError:
                    pass
        # A socket closing can race its replacement with the same tab ID. Never
        # delete the replacement's lease here. Explicit board exit uses HTTP;
        # transport loss retains the bounded reconnect grace period.

    @database_sync_to_async
    def authenticate(self, raw_token):
        from rest_framework_simplejwt.authentication import JWTAuthentication
        auth = JWTAuthentication()
        token = auth.get_validated_token(raw_token)
        return auth.get_user(token), float(token['exp'])

    @database_sync_to_async
    def admit(self):
        from .services import claim_socket, socket_heartbeat
        operation = socket_heartbeat if self.admitted else claim_socket
        return operation(self.actor, self.organization_id, self.connection_id, self.socket_generation)

    @database_sync_to_async
    def leave(self):
        from .services import leave
        return leave(self.actor, self.organization_id, self.connection_id)

    @database_sync_to_async
    def get_snapshot(self):
        from .services import socket_snapshot
        return socket_snapshot(self.actor, self.organization_id, self.connection_id, self.socket_generation)
