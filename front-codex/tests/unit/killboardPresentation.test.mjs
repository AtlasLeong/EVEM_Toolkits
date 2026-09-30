import test from 'node:test'
import assert from 'node:assert/strict'
import { participantIdentity, groupEquipmentItems, participantVisibilityNote, visibleParticipantRows, killboardSecurityMeta } from '../../src/utils/killboardPresentation.js'
import * as presentation from '../../src/utils/killboardPresentation.js'

test('collection health labels distinguish readiness from running and show safe failure reasons', () => {
  assert.equal(typeof presentation.killboardCollectionLabel, 'function')
  for (const [status, expected] of [
    [null, '采集状态未知'],
    [{ configured: false, collection_enabled: false, state: 'not_configured' }, '只读归档'],
    [{ configured: true, collection_enabled: true, state: 'ready' }, '采集已就绪'],
    [{ configured: true, collection_enabled: true, state: 'stopped', stop_reason: 'empty_threshold' }, '采集已就绪'],
    [{ configured: true, collection_enabled: true, state: 'running' }, '采集运行中'],
    [{ configured: true, collection_enabled: false, state: 'cooldown', stop_reason: 'cooldown' }, '限流冷却中'],
    [{ configured: true, collection_enabled: false, state: 'unauthorized' }, '认证失效 · 采集暂停'],
    [{ configured: true, collection_enabled: false, state: 'configuration_error' }, '配置错误 · 采集暂停'],
    [{ configured: true, collection_enabled: true, state: 'stopped', stop_reason: 'network_error' }, '上次采集网络异常'],
    [{ configured: true, collection_enabled: true, state: 'stopped', stop_reason: 'malformed' }, '上次采集格式异常'],
    [{ configured: true, collection_enabled: true, state: 'failed', stop_reason: 'lease_expired' }, '上次采集中断'],
    [{ configured: true, collection_enabled: true, state: 'failed', stop_reason: 'SECRET REMOTE TEXT' }, '上次采集失败'],
  ]) assert.equal(presentation.killboardCollectionLabel(status), expected, JSON.stringify(status))
})

test('historical rejection reasons cannot claim collection remains paused after readiness returns', () => {
  for (const [stopReason, expected] of [
    ['rate_limited', '上次采集触发限流'], ['cooldown', '上次采集触发限流'],
    ['unauthorized', '上次采集认证失效'], ['configuration_error', '上次采集配置错误'],
  ]) assert.equal(presentation.killboardCollectionLabel({
    configured: true, collection_enabled: true, state: 'stopped', stop_reason: stopReason,
  }), expected)
})

test('participant ships show exact API hull names and explicit missing-name fallback', () => {
  assert.equal(typeof presentation.participantShipLabel, 'function')
  assert.equal(presentation.participantShipLabel({ ship_type_id: '10500000601', ship_name: '元帅级' }), '元帅级')
  assert.equal(presentation.participantShipLabel({ ship_type_id: '10500000408', ship_name: ' 万王宝座级海军型 ' }), '万王宝座级海军型')
  assert.equal(presentation.participantShipLabel({ ship_type_id: '999', ship_name: '' }), '舰船名称待补')
  assert.equal(presentation.participantShipLabel({ ship_type_id: null }), '舰船资料未返回')
  assert.equal(presentation.participantShipLabel(), '舰船资料未返回')
})

test('participant identity prefers names and keeps IDs as secondary context', () => {
  assert.deepEqual(participantIdentity({
    character_id: '10004587459',
    character_name: '',
    corporation_id: '1000001680',
    corporation_name: '',
  }), {
    name: '角色 ID 10004587459',
    nameDetail: '10004587459',
    corporation: '军团 ID 1000001680',
    corporationDetail: '1000001680',
    named: false,
  })
  assert.deepEqual(participantIdentity({
    character_id: '10002085243',
    character_name: '刀功料理',
    corporation_id: '1000000263',
    corporation_name: '示例军团',
  }), {
    name: '刀功料理',
    nameDetail: 'ID 10002085243',
    corporation: '示例军团',
    corporationDetail: 'ID 1000000263',
    named: true,
  })
  assert.equal(participantIdentity({ character_name: '萨沙少尉' }).corporation, '军团资料未返回')
})

test('participant identity labels missing corporation data explicitly', () => {
  assert.equal(participantIdentity({ character_name: '玩家' }).corporation, '军团资料未返回')
})

test('equipment slot flags are grouped without guessing unknown ranges', () => {
  const groups = groupEquipmentItems([
    { name: '低槽', slot: '原始槽位 12' },
    { name: '中槽', slot: '原始槽位 21' },
    { name: '高槽', slot: '原始槽位 30' },
    { name: '改装件', slot: '原始槽位 94' },
    { name: '未知', slot: '原始槽位 808' },
  ])
  assert.deepEqual(groups.map(group => [group.key, group.items.map(item => item.name)]), [
    ['high', ['高槽']],
    ['mid', ['中槽']],
    ['low', ['低槽']],
    ['rig', ['改装件']],
    ['other', ['未知']],
  ])
})

test('participant list hides non-character damage nodes instead of inventing unknown roles', () => {
  const visible = visibleParticipantRows([
    { character_id: null, character_name: '', damage: 314060 },
    { character_id: '10002085243', character_name: '刀功料理', damage: 419320 },
    { character_id: null, character_name: '萨沙少尉', damage: 384191, is_final_blow: true },
  ])

  assert.deepEqual(visible.map(row => row.character_name), ['刀功料理', '萨沙少尉'])
})

test('exact API image URLs take precedence over the legacy market allowlist', () => {
  assert.equal(presentation.itemImage({ type_id: '100', image_url: '/images/killboard-items/exact.png' }), '/images/killboard-items/exact.png')
  assert.equal(presentation.shipImage({ ship_type_id: '100', ship_image_url: '/images/killboard-items/exact-ship.png' }), '/images/killboard-items/exact-ship.png')
  assert.equal(presentation.itemImage({ type_id: '100' }), null)
})

test('participant list shows at most seven named players and skips id-only rows', () => {
  const visible = visibleParticipantRows([
    { character_id: null, character_name: '', damage: 1 },
    ...Array.from({ length: 7 }, (_, index) => ({ character_id: String(index + 1), character_name: `玩家${index + 1}` })),
    { character_id: '999', character_name: '第八名玩家' },
    { character_id: '1000', character_name: '' },
  ])

  assert.deepEqual(visible.map(row => row.character_name), ['玩家1', '玩家2', '玩家3', '玩家4', '玩家5', '玩家6', '玩家7'])
})

test('participant list shows only first seven rows with parsed character names', () => {
  const visible = visibleParticipantRows([
    { character_id: '1', character_name: '', damage: 1 },
    ...Array.from({ length: 8 }, (_, index) => ({ character_name: `玩家${index + 1}`, damage: index + 2 })),
  ])

  assert.deepEqual(visible.map(row => row.character_name), ['玩家1', '玩家2', '玩家3', '玩家4', '玩家5', '玩家6', '玩家7'])
})

test('participant note distinguishes hidden named players from unnamed damage nodes', () => {
  const rows = [
    ...Array.from({ length: 8 }, (_, index) => ({ character_name: `玩家${index + 1}` })),
    { character_name: '', damage: 100 },
  ]
  assert.equal(participantVisibilityNote(rows), '展示前 7 条可识别角色；另有 1 名角色和 1 条未命名火力记录未展开。')
})

test('switching reports never displays another report detail under the new selection', () => {
  const previous = { kill_id: '1', participants: [{ character_name: 'Previous' }] }
  const summary = { kill_id: '2', ship_name: 'Next' }
  assert.equal(presentation.selectedReport('2', previous, summary), summary)
  assert.equal(presentation.selectedReport('2', previous, null), null)
  assert.equal(presentation.selectedReport(1, previous, null), previous)
})

test('local sample data is clearly distinguished from collected reports', () => {
  assert.equal(presentation.reportSourceNote({ source: 'local-preview' }), '本地布局示例 · 非真实采集报告')
  assert.equal(presentation.reportSourceNote({ source: 'collector' }), '')
  assert.equal(presentation.reportSourceNote(null), '')
})

test('killboard security metadata normalizes aliases and keeps text plus semantic color band', () => {
  assert.deepEqual(killboardSecurityMeta({ security_status: '0.72' }), {
    value: 0.72,
    valueLabel: '0.72',
    zoneLabel: '高安',
    band: 'high',
    className: 'is-high',
    color: '#77e6e0',
  })
  assert.equal(killboardSecurityMeta({ system_security: 0.2 }).zoneLabel, '低安')
  assert.equal(killboardSecurityMeta({ solar_system_security: 0.5 }).zoneLabel, '高安')
  assert.equal(killboardSecurityMeta({ solarsystem_security: -0.1 }).zoneLabel, '零安')
  assert.equal(killboardSecurityMeta({ system: { security_status: 0.9 } }).valueLabel, '0.90')
  assert.deepEqual(killboardSecurityMeta({ security_status: 'unknown' }), {
    value: null,
    valueLabel: '未知',
    zoneLabel: '安等未知',
    band: 'unknown',
    className: 'is-unknown',
    color: '#9fb4b9',
  })
  assert.equal(killboardSecurityMeta(null).zoneLabel, '安等未知')
})
