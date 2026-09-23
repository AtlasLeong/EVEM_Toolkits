"""Current local-only HTTP/WebSocket tactical workflow smoke test."""
import argparse
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from load_board import validate_target
from local_seed import LOCAL_SETTINGS, require_local


def credentials():
    backend = Path(__file__).resolve().parents[2] / 'backend'
    sys.path.insert(0, str(backend))
    if os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS) != LOCAL_SETTINGS:
        raise ValueError('Refusing non-demo Django settings')
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    import django
    django.setup()
    from django.conf import settings
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    from django.contrib.auth import get_user_model
    from rest_framework_simplejwt.tokens import AccessToken
    User = get_user_model()
    owner = User.objects.create_user(username=f'tactical_recovery_{uuid4().hex}')
    return {role: str(AccessToken.for_user(user)) for role, user in {
        'founder': owner,
        'commander': User.objects.get(username='tactical_demo_commander'),
        'scout': User.objects.get(username='tactical_demo_scout'),
    }.items()}


async def run(base, tokens):
    import requests
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed
    org = None
    sockets = []
    cids = {role: str(uuid4()) for role in tokens}

    def http(role, method, path, payload=None, expected=200):
        response = requests.request(method, base + '/api/tactical/' + path,
                                    headers={'Authorization': 'Bearer ' + tokens[role]},
                                    json=payload, timeout=15)
        if response.status_code != expected:
            raise AssertionError(f'{method} {path}: {response.status_code} != {expected}')
        return response.json()

    async def call(*args, **kwargs):
        return await asyncio.to_thread(http, *args, **kwargs)

    async def command(actor_role, action, expected=200, **payload):
        return (await call(actor_role, 'POST', f'organizations/{org}/commands/', {
            'action': action, 'request_id': str(uuid4()),
            **({'connection_id': cids[actor_role]} if action.startswith(('scope.', 'force.', 'report.')) else {}),
            **payload,
        }, expected=expected))

    async def read_until(socket, predicate):
        async def wait():
            while True:
                frame = json.loads(await socket.recv())
                if frame.get('type') == 'snapshot' and predicate(frame['data']):
                    return frame['data']
        return await asyncio.wait_for(wait(), 8)

    try:
        created = await call('founder', 'POST', 'organizations/', {
            'name': '恢复演习 ' + uuid4().hex[:8], 'request_id': str(uuid4()),
        })
        org = created['result']['id']
        invite = (await command('founder', 'invite.create'))['result']['invite_code']
        for role in ('commander', 'scout'):
            joined = await call(role, 'POST', 'join/', {
                'invite_code': invite, 'request_id': str(uuid4()),
            })
            await command('founder', 'join.review', application_id=joined['result']['id'], decision='approve')
        members = (await call('founder', 'GET', f'organizations/{org}/members/'))['members']
        commander_id = next(row['id'] for row in members if row['display_name'] == '舰队指挥')
        scout_id = next(row['id'] for row in members if row['display_name'] == '前线斥候')
        await command('founder', 'member.role', member_id=commander_id, role='commander')
        for role in tokens:
            await call(role, 'POST', f'organizations/{org}/presence/', {'connection_id': cids[role]})
        await command('founder', 'scope.update', expected_version=1, region_ids=[99000001], border_hops=0)

        for role in ('scout', 'commander'):
            socket = await connect(base.replace('http://', 'ws://') + f'/ws/tactical/{org}/',
                                   origin='http://127.0.0.1:4194', proxy=None)
            sockets.append(socket)
            await socket.send(json.dumps({'type': 'authenticate', 'token': tokens[role],
                                          'connection_id': cids[role]}))
            await read_until(socket, lambda data: data['role'] == role)
        scout_ws, commander_ws = sockets
        observed_at = datetime.now(timezone.utc).isoformat()
        content = {'system_id': 99001001, 'people': 32, 'ships': {},
                   'notes': '本地恢复演习', 'observed_at': observed_at}
        report = (await command('scout', 'report.create', report_kind='system_count', **content))['result']
        shared = await read_until(commander_ws, lambda data: any(row['id'] == report['id'] for row in data['reports']))
        if not any(row['author_name'] and row['people'] == 32 for row in shared['reports']):
            raise AssertionError('count and reporter were not shared')
        await command('scout', 'report.create', report_kind='fleet_intel', fleet_name='forbidden', **content, expected=403)

        force = (await command('commander', 'force.create', name='己方演习', side='friendly', **content))['result']
        await read_until(commander_ws, lambda data: any(row['id'] == force['id'] for row in data['forces']))
        scout_state = await call('scout', 'GET', f'organizations/{org}/snapshot/?connection_id={cids["scout"]}')
        if scout_state['forces'] or 'online' in scout_state:
            raise AssertionError('private friendly state leaked to scout')

        moved = (await command('scout', 'report.move', report_id=report['id'],
                               expected_version=1, destination_system_id=99001002))['result']
        if moved['system_id'] != 99001002 or moved['observed_at'] != report['observed_at']:
            raise AssertionError('count move changed observation time or missed target')
        await read_until(commander_ws, lambda data: any(row['id'] == report['id'] and row['system_id'] == 99001002
                                                        for row in data['reports']))
        await command('scout', 'report.withdraw', report_id=report['id'], expected_version=1, expected=409)
        withdrawn = (await command('scout', 'report.withdraw', report_id=report['id'], expected_version=2))['result']
        if withdrawn['status'] != 'withdrawn':
            raise AssertionError('withdraw did not preserve report history')

        await command('founder', 'member.role', member_id=commander_id, role='scout')
        downgraded = await read_until(commander_ws, lambda data: data['role'] == 'scout')
        if downgraded['forces'] or 'online' in downgraded:
            raise AssertionError('downgrade retained private state')
        await command('founder', 'member.remove', member_id=scout_id)
        async def closed():
            try:
                while True:
                    await scout_ws.recv()
            except ConnectionClosed as error:
                if not error.rcvd or error.rcvd.code != 4403:
                    raise AssertionError('removed scout closed with wrong code')
        await asyncio.wait_for(closed(), 8)
        print(json.dumps({'result': 'PASS', 'checks': [
            'approval', 'scope', 'offset-aware report', 'HTTP/WS delivery', 'reporter attribution',
            'scout restrictions', 'friendly isolation', 'count move/withdraw',
            'stale version conflict', 'live role downgrade', 'live removal',
        ]}, ensure_ascii=False))
    finally:
        for socket in sockets:
            await socket.close()
        if org is not None:
            for role in tokens:
                try:
                    await call(role, 'DELETE', f'organizations/{org}/presence/', {'connection_id': cids[role]})
                except Exception:
                    pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    asyncio.run(run(validate_target(args.base_url), credentials()))
