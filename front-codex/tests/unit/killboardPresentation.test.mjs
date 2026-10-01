import test from 'node:test'
import assert from 'node:assert/strict'
import { participantIdentity, groupEquipmentItems, participantVisibilityNote, visibleParticipantRows, killboardSecurityMeta } from '../../src/utils/killboardPresentation.js'
import * as presentation from '../../src/utils/killboardPresentation.js'

test('rate-limit health states are hidden while access and configuration failures remain visible', () => {
  assert.equal(typeof presentation.shouldShowKillboardLiveStatus, 'function')
  assert.equal(presentation.shouldShowKillboardLiveStatus({ state: 'cooldown', stop_reason: 'rate_limited' }), false)
  assert.equal(presentation.shouldShowKillboardLiveStatus({ state: 'stopped', stop_reason: 'rate_limited' }), false)
  assert.equal(presentation.shouldShowKillboardLiveStatus({ state: 'unauthorized' }), true)
  assert.equal(presentation.shouldShowKillboardLiveStatus({ state: 'configuration_error' }), true)
  assert.equal(presentation.shouldShowKillboardLiveStatus({ state: 'running' }), true)
})

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

test('explicit NPC participants use an honest fallback without inventing a character name', () => {
  const identity = participantIdentity({ identity_kind: 'npc', damage: 1234 })
  assert.deepEqual(identity, { name: 'NPC', nameDetail: '', corporation: '非玩家角色', corporationDetail: '', named: false, isNpc: true })
  assert.deepEqual(visibleParticipantRows([{ identity_kind: 'npc', damage: 1234 }]), [{ identity_kind: 'npc', damage: 1234 }])
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
  assert.equal(killboardSecurityMeta({ solarsystem_security: -0.1 }).zoneLabel, '00地区')
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

test('killboard only uses confirmed 00, low and high security boundaries', () => {
  for (const [value, label] of [[-1, '00地区'], [0, '00地区'], [0.01, '低安'], [0.4999, '低安'], [0.5, '高安'], [1, '高安']]) {
    assert.equal(killboardSecurityMeta({ security_status: value }).zoneLabel, label)
  }
})

test('legacy equipment names unwrap only recognized tokens while retaining tier text', () => {
  assert.equal(typeof presentation.formatKillboardName, 'function')
  assert.equal(presentation.formatKillboardName('{module_affix:皮特丙型} {module:自适应全能力场}'), '皮特丙型 自适应全能力场')
  assert.equal(presentation.formatKillboardName('{module:旗舰级半导体记忆电池}'), '旗舰级半导体记忆电池')
  assert.equal(presentation.formatKillboardName('{unknown:保持原文}'), '{unknown:保持原文}')
  assert.equal(presentation.formatKillboardName('常规 甲型 模块'), '常规 甲型 模块')
})

test('all confirmed client localization wrappers are removed while unknown wrappers remain', () => {
  const value = '{attr:属性} {item:装备} {blueprint:蓝图} {drone:钢铁守卫} {drone_affix:突击型} {item_name:名称} {module:模块} {module_affix:前缀} {nanocore:纳米核心} {ship:舰船} {ship_postfix:后缀} {skill_level:等级} {skill_name:技能} {skin:涂装} {skin_duration:时限} {future:保留}'
  assert.equal(presentation.formatKillboardName(value), '属性 装备 蓝图 钢铁守卫 突击型 名称 模块 前缀 纳米核心 舰船 后缀 等级 技能 涂装 时限 {future:保留}')
})

test('killboard touch tag is deterministic and rejects an empty kill id', () => {
  assert.equal(typeof presentation.killboardTouchTag, 'function')
  assert.equal(presentation.killboardTouchTag('19748418'), '<touch func="show_km_detail" kill_id="19748418">击毁报告</touch>')
  assert.equal(presentation.killboardTouchTag(19748418), '<touch func="show_km_detail" kill_id="19748418">击毁报告</touch>')
  assert.equal(presentation.killboardTouchTag(''), '')
})

test('copy helper uses clipboard API and falls back to document execCommand', async () => {
  const writes = []
  assert.equal(await presentation.copyKillboardTag('19748418', { writeText: value => { writes.push(value); return Promise.resolve() } }), true)
  assert.deepEqual(writes, ['<touch func="show_km_detail" kill_id="19748418">击毁报告</touch>'])

  let copied = ''
  const body = { appendChild(node) { node.parentNode = body }, removeChild() {} }
  const doc = {
    body,
    createElement() { return { style: {}, select() {}, setAttribute() {}, value: '' } },
    execCommand(command) { copied = command; return true },
  }
  assert.equal(await presentation.copyKillboardTag('19748418', null, doc), true)
  assert.equal(copied, 'copy')
})

test('verified expanded client slots include mechanical and defence rigs but not adjacent unknown slots', () => {
  for (const [slot, expected] of [[100, 'rig'], [107, 'rig'], [111, 'rig'], [108, 'other'], [109, 'other'], [110, 'rig'], [2001, 'low'], [2004, 'low'], [3001, 'mid'], [4004, 'high']]) {
    assert.equal(presentation.slotGroup(slot), expected, String(slot))
  }
  assert.equal(typeof presentation.equipmentSlotLabel, 'function')
  assert.equal(presentation.equipmentSlotLabel('原始槽位 100'), '改装件')
  assert.equal(presentation.equipmentSlotLabel('原始槽位 108'), '槽位待确认')
})

test('source-only named highlights remain visible separately from the first seven character rows', () => {
  const rows = [
    { display_name: '混乱风暴发射器', identity_kind: 'source', is_final_blow: true, is_top_damage: true },
    ...Array.from({ length: 8 }, (_, index) => ({ character_id: String(index + 1), character_name: `玩家${index + 1}` })),
    { display_name: '不展示普通来源行', identity_kind: 'source' },
    { is_final_blow: true },
  ]
  const visible = visibleParticipantRows(rows)
  assert.deepEqual(visible.map(row => row.display_name || row.character_name), ['混乱风暴发射器', '玩家1', '玩家2', '玩家3', '玩家4', '玩家5', '玩家6', '玩家7'])
  const identity = participantIdentity(rows[0])
  assert.equal(identity.name, '混乱风暴发射器')
  assert.equal(identity.corporation, '来源记录 · 无角色身份')
  assert.equal(presentation.participantIdentity({ ship_name: '元帅级', identity_kind: 'source', is_final_blow: true }).name, '元帅级')
})
