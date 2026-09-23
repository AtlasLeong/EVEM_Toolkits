"""Opt-in loopback load exercise. Reads only the synthetic local fixture DB."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import sys
import time
from urllib.parse import urlparse
from uuid import uuid4


def validate_target(base_url):
    parsed = urlparse(base_url)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.username or parsed.password or parsed.path not in ('', '/') or parsed.query or parsed.fragment:
        raise ValueError('Load tool permits only literal loopback HTTP, no credentials/path/query')
    if not parsed.port:
        raise ValueError('An explicit isolated test port is required')
    return base_url.rstrip('/')


async def drain_observations(observations, marker, accounts, timeout=8):
    # The measurement duration may end immediately after a command. Give its
    # final snapshot the same bounded delivery window as earlier commands.
    deadline = time.monotonic() + timeout
    while any((index, marker) not in observations for index in range(accounts)):
        if time.monotonic() >= deadline:
            return False
        await asyncio.sleep(min(.05, max(0, deadline - time.monotonic())))
    return True


def fixture_tokens(accounts):
    backend = Path(__file__).resolve().parents[2] / 'backend'
    sys.path.insert(0, str(backend))
    from local_seed import LOCAL_SETTINGS, require_local
    if os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS) != LOCAL_SETTINGS:
        raise ValueError('Refusing non-demo Django settings')
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    import django
    django.setup()
    from django.conf import settings
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    from django.contrib.auth import get_user_model
    from rest_framework_simplejwt.tokens import AccessToken
    from TacticalCollaboration.models import Organization
    org = Organization.objects.get(name='容量验证 · 隔离演习')
    founder = get_user_model().objects.get(username='tactical_demo_founder')
    users = [founder] + [get_user_model().objects.get(username=f'tactical_load_{index:03d}') for index in range(accounts)]
    from datetime import timedelta
    tokens = []
    for user in users:
        token = AccessToken.for_user(user)
        token.set_exp(lifetime=timedelta(hours=1))
        tokens.append(str(token))
    return org.pk, tokens


async def exercise(base_url, org_id, tokens, accounts, duration):
    import requests
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed
    clients, tasks, snapshots = [], [], {}
    latencies, errors = [], []
    observations = {}
    command_started = {}
    ws_url = base_url.replace('http://', 'ws://') + f'/ws/tactical/{org_id}/'
    start = time.monotonic()

    async def connect_client(index, token):
        cid = str(uuid4())
        ws = await connect(ws_url, origin='http://127.0.0.1:4194', max_size=2**20, proxy=None)
        await ws.send(json.dumps({'type': 'authenticate', 'token': token, 'connection_id': cid}))
        initial = json.loads(await asyncio.wait_for(ws.recv(), 15))
        if initial.get('type') != 'snapshot':
            raise AssertionError('admission did not return an authorized snapshot')
        clients.append((index, ws, cid, token))
        accept(index, initial['data'])
        return ws, cid

    def accept(index, snapshot):
        snapshots[index] = snapshot
        if index != 0:
            if any(force['side'] != 'enemy' for force in snapshot['forces']) or 'online' in snapshot:
                raise AssertionError('private friendly/roster state leaked to scout')
        if snapshot['online_count'] > 100:
            raise AssertionError('capacity exceeded')
        for force in snapshot['forces']:
            key = force.get('notes', '')
            if key in command_started and (index, key) not in observations:
                latency = time.monotonic() - command_started[key]
                observations[index, key] = latency
                latencies.append(latency)

    async def read_client(index, ws):
        try:
            async for raw in ws:
                message = json.loads(raw)
                if message.get('type') == 'snapshot':
                    accept(index, message['data'])
        except asyncio.CancelledError:
            return
        except Exception as error:
            errors.append(f'client {index}: {type(error).__name__}')

    async def heartbeat():
        while True:
            await asyncio.sleep(20)
            for _, ws, _, _ in clients:
                try:
                    await ws.send(json.dumps({'type': 'ping'}))
                    await asyncio.sleep(0.03)
                except ConnectionClosed:
                    pass

    def http(method, tail, token, payload):
        response = requests.request(method, f'{base_url}/api/tactical/organizations/{org_id}/{tail}',
                                    headers={'Authorization': f'Bearer {token}'}, json=payload, timeout=20)
        if not response.ok:
            raise AssertionError(f'{tail} returned {response.status_code}')
        return response.json()

    try:
        # Stagger start to measure sustained live capacity separately from the
        # real-MySQL atomic burst-admission test, not claim both from SQLite.
        # Start renewals during the stagger: 100 SQLite admissions can take
        # longer than a 60-second lease on slower test machines.
        tasks.append(asyncio.create_task(heartbeat()))
        for index in range(accounts):
            ws, _ = await connect_client(index, tokens[index])
            tasks.append(asyncio.create_task(read_client(index, ws)))
            await asyncio.sleep(0.05)
        if accounts == 100:
            extra = await connect(ws_url, origin='http://127.0.0.1:4194', proxy=None)
            try:
                await extra.send(json.dumps({'type': 'authenticate', 'token': tokens[accounts], 'connection_id': str(uuid4())}))
                try:
                    await asyncio.wait_for(extra.recv(), 10)
                    raise AssertionError('101st account was admitted')
                except ConnectionClosed as closed:
                    if closed.rcvd is None or closed.rcvd.code != 4409:
                        raise AssertionError('101st account had an unexpected rejection')
            finally:
                await extra.close()
            duplicate, duplicate_cid = await connect_client(accounts, tokens[1])
            if snapshots[accounts]['online_count'] != 100:
                raise AssertionError('duplicate account was counted twice')
            await duplicate.close()
            await asyncio.to_thread(http, 'DELETE', 'presence/', tokens[1], {'connection_id': duplicate_cid})
            clients.pop()
        founder_cid = clients[0][2]

        async def command(action, **data):
            payload = {'action': action, 'connection_id': founder_cid, 'request_id': str(uuid4()), **data}
            return (await asyncio.to_thread(http, 'POST', 'commands/', tokens[0], payload))['result']

        from datetime import datetime, timezone
        observed_at = datetime.now(timezone.utc).isoformat()
        await command('force.create', name='仅指挥层容量验证', side='friendly', system_id=99001003,
                      people=90, ships={'battleship': 80}, notes='private-friendly-fixture', observed_at=observed_at)
        force = await command('force.create', name='敌方容量验证', side='enemy', system_id=99001001,
                              people=40, ships={'cruiser': 30}, notes='load-initial', observed_at=observed_at)
        active_start = time.monotonic()
        iteration = 0
        while time.monotonic() - active_start < duration:
            marker = f'load-{uuid4()}'
            command_started[marker] = time.monotonic()
            force = await command('force.update', force_id=force['id'], expected_version=force['version'],
                                  name='敌方容量验证', side='enemy', system_id=99001001, people=40 + iteration,
                                  ships={'cruiser': 30}, notes=marker, observed_at=observed_at)
            await asyncio.sleep(min(10, max(0.1, duration - (time.monotonic() - active_start))))
            if not await drain_observations(observations, marker, accounts):
                errors.append(f'update {iteration}: not received by every account')
            iteration += 1
        ordered = sorted(latencies)
        p95 = ordered[min(len(ordered) - 1, int(len(ordered) * .95))] if ordered else None
        result = {'accounts': accounts, 'duration_seconds': round(time.monotonic() - active_start, 2),
                  'elapsed_seconds': round(time.monotonic() - start, 2), 'updates': iteration,
                  'observations': len(latencies), 'p95_seconds': round(p95, 3) if p95 is not None else None,
                  'max_seconds': round(max(latencies), 3) if latencies else None,
                  'errors': errors, 'database': 'isolated SQLite; not MySQL concurrency evidence'}
        print(json.dumps(result, ensure_ascii=False), flush=True)
        if errors or p95 is None or p95 >= 2:
            raise AssertionError('Local live capacity acceptance did not pass')
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for _, ws, cid, token in clients:
            await ws.close()
            try:
                await asyncio.to_thread(http, 'DELETE', 'presence/', token, {'connection_id': cid})
            except Exception:
                pass  # Leases expire; no destructive database cleanup.


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--accounts', type=int, choices=range(2, 101), default=100)
    parser.add_argument('--duration-seconds', type=int, choices=range(10, 1801), default=600)
    args = parser.parse_args()
    target = validate_target(args.base_url)
    organization_id, credentials = fixture_tokens(args.accounts)
    asyncio.run(exercise(target, organization_id, credentials, args.accounts, args.duration_seconds))
