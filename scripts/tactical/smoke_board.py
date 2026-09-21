"""Real HTTP + WebSocket smoke test, restricted to isolated loopback fixtures."""
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from load_board import validate_target
from local_seed import LOCAL_SETTINGS, require_local


def tokens():
    backend = Path(__file__).resolve().parents[2] / 'backend'
    if os.environ.get('DJANGO_SETTINGS_MODULE', LOCAL_SETTINGS) != LOCAL_SETTINGS:
        raise ValueError('Only local demo settings are allowed')
    os.environ['DJANGO_SETTINGS_MODULE'] = LOCAL_SETTINGS
    sys.path.insert(0, str(backend))
    import django
    django.setup()
    from django.conf import settings
    require_local(settings.SETTINGS_MODULE, settings.DATABASES['default'], backend)
    from django.contrib.auth import get_user_model
    from rest_framework_simplejwt.tokens import AccessToken
    return {role: str(AccessToken.for_user(get_user_model().objects.get(username=f'tactical_demo_{role}')))
            for role in ['founder', 'commander', 'scout']}


async def run(base, credentials):
    import requests
    from websockets.asyncio.client import connect
    from websockets.exceptions import ConnectionClosed
    def http(role, method, path, data=None, expected=200):
        response = requests.request(method, f'{base}/api/tactical/{path}', json=data,
                                    headers={'Authorization': f'Bearer {credentials[role]}'}, timeout=20)
        assert response.status_code == expected, f'{method} {path}: {response.status_code} != {expected}'
        return response.json()
    async def call(*args, **kwargs):
        return await asyncio.to_thread(http, *args, **kwargs)
    created = await call('founder', 'POST', 'organizations/', {'name': f'流程验证 {uuid4().hex[:6]}', 'request_id': str(uuid4())})
    org = created['result']['id']
    prefix = f'organizations/{org}/'
    cids = {role: str(uuid4()) for role in credentials}
    sockets = []
    async def command(actor, action, *, admin=False, expected=200, request_id=None, **data):
        return (await call(actor, 'POST', prefix + 'commands/', {
            'request_id': request_id or str(uuid4()), 'action': action,
            **({} if admin else {'connection_id': cids[actor]}), **data}, expected=expected))
    async def read_until(ws, predicate):
        async def read():
            while True:
                data = json.loads(await ws.recv())['data']
                if predicate(data): return data
        return await asyncio.wait_for(read(), 8)
    try:
        invite = (await command('founder', 'invite.create', admin=True))['result']['invite_code']
        for role in ['commander', 'scout']:
            joined = await call(role, 'POST', 'join/', {'invite_code': invite, 'request_id': str(uuid4())})
            await call(role, 'GET', prefix + 'map/', expected=403)
            await command('founder', 'join.review', admin=True, application_id=joined['result']['id'], decision='approve')
        members = (await call('founder', 'GET', prefix + 'members/'))['members']
        member_ids = {role: next(item['id'] for item in members if item['display_name'] in
                               (f'tactical_demo_{role}', {'commander': '舰队指挥', 'scout': '前线斥候'}[role]))
                      for role in ['commander', 'scout']}
        await command('founder', 'member.role', admin=True, member_id=member_ids['commander'], role='commander')
        for role in credentials:
            await call(role, 'POST', prefix + 'presence/', {'connection_id': cids[role]})
        scout_ws = await connect(base.replace('http://', 'ws://') + f'/ws/tactical/{org}/', origin='http://127.0.0.1:4194', proxy=None)
        sockets.append(scout_ws)
        await scout_ws.send(json.dumps({'type': 'authenticate', 'token': credentials['scout'], 'connection_id': cids['scout']}))
        await read_until(scout_ws, lambda data: data['role'] == 'scout')
        content = {'system_id': 99001001, 'people': 32, 'ships': {'cruiser': 12, 'titan': None},
                   'notes': '验证目击', 'observed_at': datetime.now(timezone.utc).isoformat()}
        private = (await command('commander', 'force.create', name='保密己方', side='friendly', **content))['result']
        report = (await command('scout', 'report.create', **content))['result']
        await command('commander', 'report.create', **{**content, 'notes': '他人原始情报不可见'})
        own = await call('scout', 'GET', prefix + f'snapshot/?connection_id={cids["scout"]}')
        assert not own['forces'] and 'online' not in own and len(own['reports']) == 1
        assert all(row['author_id'] == own['user_id'] for row in own['reports'])
        await command('scout', 'force.update', force_id=private['id'], expected_version=1, name='绕过测试', side='enemy', **content, expected=403)
        receipt = str(uuid4())
        force = (await command('commander', 'report.confirm', request_id=receipt, report_id=report['id'], expected_version=1, name='确认敌方'))['result']
        replay = (await command('commander', 'report.confirm', request_id=receipt, report_id=report['id'], expected_version=1, name='确认敌方'))['result']
        assert force == replay
        seen = await read_until(scout_ws, lambda data: any(row['id'] == force['id'] for row in data['forces']))
        assert all(row['side'] == 'enemy' for row in seen['forces']) and 'online' not in seen
        await command('scout', 'report.update', report_id=report['id'], expected_version=1, **{**content, 'people': 45})
        after = await call('commander', 'GET', prefix + f'snapshot/?connection_id={cids["commander"]}')
        assert next(row for row in after['forces'] if row['id'] == force['id'])['people'] == 32
        moved = (await command('commander', 'force.move', force_id=force['id'], expected_version=force['version'], destination_system_id=99001002, kind='gate_move'))['result']
        assert moved['id'] == force['id'] and moved['observed_at'] == force['observed_at']
        await command('commander', 'force.move', force_id=force['id'], expected_version=force['version'], destination_system_id=99001003, kind='gate_move', expected=409)
        await command('commander', 'force.archive', force_id=force['id'], expected_version=moved['version'])
        await read_until(scout_ws, lambda data: not data['forces'])
        commander_ws = await connect(base.replace('http://', 'ws://') + f'/ws/tactical/{org}/', origin='http://127.0.0.1:4194', proxy=None)
        sockets.append(commander_ws)
        await commander_ws.send(json.dumps({'type': 'authenticate', 'token': credentials['commander'], 'connection_id': cids['commander']}))
        await read_until(commander_ws, lambda data: any(row['side'] == 'friendly' for row in data['forces']))
        await command('founder', 'member.role', admin=True, member_id=member_ids['commander'], role='scout')
        downgraded = await read_until(commander_ws, lambda data: data['role'] == 'scout')
        assert not downgraded['forces'] and 'online' not in downgraded
        await command('founder', 'member.remove', admin=True, member_id=member_ids['scout'])
        async def expect_closed():
            try:
                while True: await scout_ws.recv()
            except ConnectionClosed as error:
                assert error.rcvd and error.rcvd.code == 4403
        await asyncio.wait_for(expect_closed(), 8)
        await call('scout', 'GET', prefix + f'snapshot/?connection_id={cids["scout"]}', expected=403)
        print(json.dumps({'result': 'PASS', 'organization_id': org,
                          'checks': ['approval', 'role isolation', 'own reports', 'idempotency', 'immutable adoption',
                                     'gate move', 'version conflict', 'archive', 'live downgrade', 'live removal']}, ensure_ascii=False))
    finally:
        for ws in sockets: await ws.close()
        for role in cids:
            await call(role, 'DELETE', prefix + 'presence/', {'connection_id': cids[role]})


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    args = parser.parse_args()
    asyncio.run(run(validate_target(args.base_url), tokens()))
