"""Real HTTP + WebSocket smoke test, restricted to isolated loopback fixtures."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import sys
from uuid import uuid4

from load_board import validate_target
from local_seed import LOCAL_SETTINGS, require_local


def tokens(fresh_owner=False):
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
    users = {role: get_user_model().objects.get(username=f'tactical_demo_{role}')
             for role in ['founder', 'commander', 'scout', 'newcomer']}
    if fresh_owner:
        # Preserve all existing demo organizations when repeated smoke runs reach
        # the per-owner limit. This test-only owner has no usable password.
        users['founder'] = get_user_model().objects.create_user(username=f'tactical_smoke_{uuid4().hex}')
    return {role: str(AccessToken.for_user(user)) for role, user in users.items()}


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
        # The existing newcomer fixture joins this fresh organization as a
        # second scout; no account or existing membership is reset.
        for role in ['commander', 'scout', 'newcomer']:
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
        private = (await command('commander', 'force.create', name='保密己方', side='friendly',
                                 **{**content, 'notes': 'PRIVATE_FRIENDLY_ONLY'}))['result']
        report = (await command('scout', 'report.create', **content))['result']
        other_report = (await command('newcomer', 'report.create', **{**content, 'notes': '第二斥候共享敌情'}))['result']
        command_report = (await command('commander', 'report.create', **{**content, 'notes': '指挥共享敌情'}))['result']
        report_ids = {report['id'], other_report['id'], command_report['id']}
        for role in ['founder', 'commander', 'scout', 'newcomer']:
            state = await call(role, 'GET', prefix + f'snapshot/?connection_id={cids[role]}')
            assert {row['id'] for row in state['reports']} == report_ids
            assert all(row['status'] == 'pending' and row['author_name'] for row in state['reports'])
            if role in ['scout', 'newcomer']:
                assert not state['forces'] and 'online' not in state
                assert 'PRIVATE_FRIENDLY_ONLY' not in json.dumps(state)
                assert any(row['author_id'] != state['user_id'] for row in state['reports'])
        shared = await read_until(scout_ws, lambda data: {row['id'] for row in data['reports']} == report_ids)
        assert not shared['forces'] and 'online' not in shared
        assert 'PRIVATE_FRIENDLY_ONLY' not in json.dumps(shared)
        await command('scout', 'report.update', report_id=other_report['id'], expected_version=1, **content, expected=403)
        await command('newcomer', 'report.update', report_id=report['id'], expected_version=1, **content, expected=403)
        await command('commander', 'report.update', report_id=report['id'], expected_version=1, **content, expected=403)
        other_updated = (await command('newcomer', 'report.update', report_id=other_report['id'], expected_version=1,
                                       **{**content, 'people': 41}))['result']
        assert other_updated['version'] == 2 and other_updated['people'] == 41
        await command('newcomer', 'report.update', report_id=other_report['id'], expected_version=1, **content, expected=409)
        await read_until(scout_ws, lambda data: any(row['id'] == other_report['id'] and row['version'] == 2
                                                   and row['people'] == 41 for row in data['reports']))
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
        total = (await command('newcomer', 'report.create', report_kind='system_count',
                               **{**content, 'people': 68}))['result']
        shared_total = await read_until(scout_ws, lambda data: any(row['id'] == total['id'] for row in data['reports']))
        visible_total = next(row for row in shared_total['reports'] if row['id'] == total['id'])
        assert visible_total['report_kind'] == 'system_count' and visible_total['people'] == 68
        assert visible_total['author_id'] == total['author_id'] and not shared_total['forces']
        await command('commander', 'report.confirm', report_id=total['id'], expected_version=1, name='must not duplicate', expected=400)
        independent = (await command('commander', 'force.create', name='independent fleet', side='enemy', **content))['result']
        corrected = (await command('commander', 'force.move', force_id=independent['id'], expected_version=1,
                                   destination_system_id=99001004, kind='correction', reason='指挥通过星图拖拽调整部署位置'))['result']
        assert corrected['observed_at'] == independent['observed_at'] and corrected['people'] == independent['people']
        corrected_state = await call('commander', 'GET', prefix + f'snapshot/?connection_id={cids["commander"]}')
        assert next(row for row in corrected_state['reports'] if row['id'] == total['id'])['system_id'] == content['system_id']
        # Wait for the distinct moved state before archiving. If all writes fit
        # in one poll interval, an empty→empty projection emits no new frame.
        await read_until(scout_ws, lambda data: any(row['id'] == independent['id'] and row['version'] == corrected['version'] for row in data['forces']))
        await command('commander', 'force.archive', force_id=independent['id'], expected_version=corrected['version'])
        await read_until(scout_ws, lambda data: not data['forces'])
        # Named observations immediately project to distinct, stable fleets.
        # Keep this block in the fresh smoke organization; no demo records or
        # another browser's leases are touched by creation, edits or cleanup.
        observed = datetime.now(timezone.utc) - timedelta(minutes=2)
        named_content = {**content, 'people': 100, 'observed_at': observed.isoformat()}
        carrier = (await command('scout', 'report.create', report_kind='fleet_intel',
                                 fleet_name='大航队', **named_content))['result']
        artillery = (await command('newcomer', 'report.create', report_kind='fleet_intel',
                                   fleet_name='远炮战列队', **{**named_content, 'people': 50}))['result']
        named_ids = {carrier['force_id'], artillery['force_id']}
        assert len(named_ids) == 2 and carrier['is_current'] and artillery['is_current']
        named_state = await read_until(scout_ws, lambda data: {row['id'] for row in data['forces']} == named_ids)
        assert {row['system_id'] for row in named_state['forces']} == {content['system_id']}
        assert {(row['name'], row['people']) for row in named_state['forces']} == {('大航队', 100), ('远炮战列队', 50)}
        assert all(row['source_author_name'] for row in named_state['forces'])
        for role in ['founder', 'commander', 'scout', 'newcomer']:
            state = await call(role, 'GET', prefix + f'snapshot/?connection_id={cids[role]}')
            enemies = [row for row in state['forces'] if row['side'] == 'enemy']
            assert {row['id'] for row in enemies} == named_ids
            for observation in (carrier, artillery):
                projection = next(row for row in enemies if row['id'] == observation['force_id'])
                assert projection['source_report_id'] == observation['id']
                assert projection['source_author_id'] == observation['author_id']
            if role in ['scout', 'newcomer']:
                assert 'PRIVATE_FRIENDLY_ONLY' not in json.dumps(state) and 'online' not in state
        current_carrier = next(row for row in named_state['forces'] if row['id'] == carrier['force_id'])
        replacement = (await command('newcomer', 'report.create', report_kind='fleet_intel',
                                     force_id=current_carrier['id'], force_expected_version=current_carrier['version'],
                                     **{**named_content, 'people': 90,
                                        'observed_at': (observed + timedelta(minutes=1)).isoformat()}))['result']
        replaced_state = await read_until(scout_ws, lambda data: any(
            row['id'] == carrier['force_id'] and row['source_report_id'] == replacement['id'] for row in data['forces']))
        current_carrier = next(row for row in replaced_state['forces'] if row['id'] == carrier['force_id'])
        assert {row['id'] for row in replaced_state['forces']} == named_ids
        assert current_carrier['people'] == 90 and current_carrier['source_author_id'] == replacement['author_id']
        assert not next(row for row in replaced_state['reports'] if row['id'] == carrier['id'])['is_current']
        older = (await command('scout', 'report.create', report_kind='fleet_intel',
                               force_id=current_carrier['id'], force_expected_version=current_carrier['version'],
                               **{**named_content, 'people': 4,
                                  'observed_at': (observed - timedelta(minutes=1)).isoformat()}))['result']
        historical_state = await read_until(scout_ws, lambda data: any(row['id'] == older['id'] for row in data['reports']))
        assert not older['is_current']
        assert next(row for row in historical_state['forces'] if row['id'] == carrier['force_id']) == current_carrier
        moved_carrier = (await command('commander', 'force.move', force_id=current_carrier['id'],
                                       expected_version=current_carrier['version'], destination_system_id=99001004,
                                       kind='correction', reason='具名舰队传输验证'))['result']
        assert moved_carrier['source_report_id'] == replacement['id']
        assert moved_carrier['observed_at'] == current_carrier['observed_at']
        edited = (await command('newcomer', 'report.update', report_id=replacement['id'], expected_version=1,
                                report_kind='fleet_intel', fleet_name='大航队',
                                **{**named_content, 'people': 88, 'observed_at': replacement['observed_at']}))['result']
        edited_state = await read_until(scout_ws, lambda data: any(
            row['id'] == carrier['force_id'] and row['people'] == 88 for row in data['forces']))
        edited_carrier = next(row for row in edited_state['forces'] if row['id'] == carrier['force_id'])
        assert edited_carrier['system_id'] == moved_carrier['system_id'] == 99001004
        assert edited_carrier['observed_at'] == replacement['observed_at']
        assert edited_carrier['source_report_id'] == replacement['id']
        assert edited['system_id'] == content['system_id'] and edited['is_current']
        assert {row['id'] for row in edited_state['forces']} == named_ids
        await command('scout', 'report.update', report_id=replacement['id'], expected_version=edited['version'],
                      report_kind='fleet_intel', **named_content, expected=403)
        for named_force in edited_state['forces']:
            await command('commander', 'force.archive', force_id=named_force['id'], expected_version=named_force['version'])
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
                          'checks': ['approval', 'role isolation', 'shared enemy reports HTTP/WS', 'author-only report edits',
                                     'pending report authors', 'idempotency', 'immutable adoption',
                                     'gate move', 'version conflict', 'archive', 'system counts shared without confirmation',
                                     'system totals cannot create fleets', 'manual correction keeps counts and observation',
                                     'named fleets immediate shared HTTP/WS with source author', 'distinct named fleets in one system',
                                     'explicit stable fleet update without duplicate counts', 'older named observation remains history',
                                     'named source revision preserves commander move',
                                     'live downgrade', 'live removal']}, ensure_ascii=False))
    finally:
        for ws in sockets: await ws.close()
        for role in cids:
            await call(role, 'DELETE', prefix + 'presence/', {'connection_id': cids[role]})


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base-url', required=True)
    parser.add_argument('--fresh-owner', action='store_true', help='Create an isolated local test owner instead of reusing the demo owner')
    args = parser.parse_args()
    asyncio.run(run(validate_target(args.base_url), tokens(fresh_owner=args.fresh_owner)))
