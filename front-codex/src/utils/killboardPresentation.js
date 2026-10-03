import { selectGameItemImage } from './gameItemImage.js'
export { killboardSecurityMeta } from './securityColor.js'

const SLOT_GROUPS = Object.freeze([
  { key: 'high', label: '高槽' },
  { key: 'mid', label: '中槽' },
  { key: 'low', label: '低槽' },
  { key: 'rig', label: '改装件' },
  { key: 'other', label: '其他' },
])

function idLabel(value) {
  return value === null || value === undefined || value === '' ? '' : String(value)
}

export function killboardSystemLabel(report = {}) {
  const name = String(report.system_name || '').trim()
  if (name) return name
  const id = idLabel(report.system_id).trim()
  return /^\d+$/.test(id) && Number(id) > 0 ? `星系 #${id}` : '未知星系'
}

// Legacy records may still carry client localization wrappers. Only remove
// recognized wrappers, never arbitrary braces that may be meaningful source
// text. These tokens are emitted by the client item/localization pipeline.
const CLIENT_NAME_WRAPPER_TOKENS = Object.freeze([
  'attr', 'item', 'blueprint', 'drone', 'drone_affix', 'item_name',
  'module', 'module_affix', 'nanocore', 'ship', 'ship_postfix',
  'skill_level', 'skill_name', 'skin', 'skin_duration',
])

const CLIENT_NAME_WRAPPER_RE = new RegExp(`\\{(?:${CLIENT_NAME_WRAPPER_TOKENS.join('|')}):([^{}]+)\\}`, 'g')

export function formatKillboardName(value) {
  return String(value || '').replace(CLIENT_NAME_WRAPPER_RE, '$1').replace(/\s+/g, ' ').trim()
}

function escapeAttribute(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
}

export function killboardTouchTag(killId) {
  const id = idLabel(killId).trim()
  if (!id) return ''
  return `<touch func="show_km_detail" kill_id="${escapeAttribute(id)}">击毁报告</touch>`
}

// Clipboard access is deliberately isolated here so the page can expose a
// resilient one-click action without coupling the presentation layer to a
// browser-only global during SSR/tests.
export async function copyKillboardTag(killId, clipboard = globalThis?.navigator?.clipboard, documentRef = globalThis?.document) {
  const tag = killboardTouchTag(killId)
  if (!tag) return false
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(tag)
      return true
    } catch {
      // Fall through to the legacy DOM path for older/embedded browsers.
    }
  }
  if (!documentRef || typeof documentRef.createElement !== 'function' || !documentRef.body) return false
  try {
    const textarea = documentRef.createElement('textarea')
    textarea.value = tag
    textarea.setAttribute?.('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    documentRef.body.appendChild(textarea)
    textarea.select?.()
    const copied = typeof documentRef.execCommand === 'function' && documentRef.execCommand('copy')
    documentRef.body.removeChild?.(textarea)
    return copied === true
  } catch {
    return false
  }
}

export function selectedReport(selectedId, detail, summary) {
  if (!idLabel(selectedId)) return null
  if (detail && String(detail.kill_id) === String(selectedId)) return detail
  return summary && String(summary.kill_id) === String(selectedId) ? summary : null
}

export function reportSourceNote(report) {
  return report?.source === 'local-preview' ? '本地布局示例 · 非真实采集报告' : ''
}

export function killboardCollectionLabel(status) {
  if (!status) return '采集状态未知'
  const reason = status.state === 'cooldown' ? 'rate_limited' : status.stop_reason || status.state
  if (status.state === 'unauthorized') return '认证失效 · 采集暂停'
  if (status.state === 'configuration_error') return '配置错误 · 采集暂停'
  if (reason === 'rate_limited' || reason === 'cooldown') {
    return status.state === 'cooldown' || status.collection_enabled !== true ? '限流冷却中' : '上次采集触发限流'
  }
  if (reason === 'unauthorized') return '上次采集认证失效'
  if (reason === 'configuration_error') return '上次采集配置错误'
  if (reason === 'network_error') return '上次采集网络异常'
  if (reason === 'malformed') return '上次采集格式异常'
  if (reason === 'time_reversed') return '报告时间顺序异常'
  if (reason === 'lease_expired' || reason === 'lease_lost') return '上次采集中断'
  if (status.state === 'failed') return '上次采集失败'
  if (status.configured !== true || status.collection_enabled !== true) return '只读归档'
  return status.state === 'running' ? '采集运行中' : '采集已就绪'
}

// Rate-limit/cooldown is an internal collector safety state. Keep the health
// data available for diagnostics, but do not surface a noisy live badge for a
// condition that is expected during normal backoff.
export function shouldShowKillboardLiveStatus(status) {
  if (!status) return true
  const reason = status.state === 'cooldown' ? 'rate_limited' : status.stop_reason || status.state
  return reason !== 'rate_limited' && reason !== 'cooldown'
}

export function participantShipLabel(row = {}) {
  const name = formatKillboardName(row.ship_name)
  return name || (idLabel(row.ship_type_id) ? '舰船名称待补' : '舰船资料未返回')
}

function isNpcParticipant(row = {}) {
  const kind = String(row.identity_kind || row.actor_kind || row.character_type || '').trim().toLowerCase().replace(/[-\s]+/g, '_')
  return row.is_npc === true || kind === 'npc' || kind === 'non_player' || kind === 'non_player_character'
}

export function participantIdentity(row = {}) {
  const characterId = idLabel(row.character_id)
  const corporationId = idLabel(row.corporation_id)
  const characterName = String(row.character_name || '').trim()
  const corporationName = String(row.corporation_name || '').trim()
  const sourceName = formatKillboardName(row.display_name || ((row.identity_kind === 'source' || row.identity_kind === 'camouflaged' || row.is_source_summary) ? row.ship_name : ''))
  const npc = !characterName && isNpcParticipant(row)
  const sourceOnly = !npc && !characterName && !characterId && Boolean(sourceName)
  const identity = {
    name: characterName || sourceName || (npc ? 'NPC' : characterId ? `角色 ID ${characterId}` : '身份资料未返回'),
    nameDetail: characterName && characterId ? `ID ${characterId}` : characterId,
    corporation: corporationName || (npc ? '非玩家角色' : sourceOnly ? '来源记录 · 无角色身份' : corporationId ? `军团 ID ${corporationId}` : '军团资料未返回'),
    corporationDetail: corporationName && corporationId ? `ID ${corporationId}` : corporationId,
    named: Boolean(characterName),
  }
  if (npc) identity.isNpc = true
  return identity
}

export function visibleParticipantRows(rows = []) {
  let renderableCount = 0
  return rows.filter(row => {
    if (!row || typeof row !== 'object') return false
    const characterName = String(row.character_name || '').trim()
    const hasShipEvidence = Boolean(idLabel(row.ship_type_id) || String(row.ship_name || '').trim())
    const hasWeaponEvidence = Boolean(idLabel(row.weapon_type_id))
    if (characterName || isNpcParticipant(row) || hasShipEvidence || hasWeaponEvidence) return renderableCount++ < 7
    const sourceName = formatKillboardName(row.display_name || ((row.identity_kind === 'source' || row.identity_kind === 'camouflaged' || row.is_source_summary) ? row.ship_name : ''))
    return Boolean(sourceName && (row.is_final_blow || row.is_top_damage))
  })
}

export function participantVisibilityNote(rows = []) {
  const namedCount = rows.filter(row => row && typeof row === 'object' && String(row.character_name || '').trim().length > 0).length
  const visibleCount = Math.min(namedCount, 7)
  const hiddenNamed = Math.max(0, namedCount - visibleCount)
  const unnamed = Math.max(0, rows.length - namedCount)
  if (!hiddenNamed && !unnamed) return ''
  if (hiddenNamed && unnamed) return `展示前 ${visibleCount} 条可识别角色；另有 ${hiddenNamed} 名角色和 ${unnamed} 条未命名火力记录未展开。`
  if (hiddenNamed) return `展示前 ${visibleCount} 条可识别角色；另有 ${hiddenNamed} 名角色记录未展开。`
  return `展示前 ${visibleCount} 条可识别角色；另有 ${unnamed} 条未命名火力或聚合伤害条目。`
}

export function slotFlag(slot) {
  const match = String(slot || '').match(/(\d+)\s*$/)
  return match ? Number(match[1]) : null
}

export function slotGroup(slot) {
  const canonical = String(slot || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (canonical === 'high' || canonical === 'high_slot' || canonical === 'highs') return 'high'
  if (canonical === 'mid' || canonical === 'mid_slot' || canonical === 'mids' || canonical === 'medium') return 'mid'
  if (canonical === 'low' || canonical === 'low_slot' || canonical === 'lows') return 'low'
  if (canonical === 'rig' || canonical === 'rig_slot' || canonical === 'rigs') return 'rig'
  const flag = slotFlag(slot)
  if (flag >= 11 && flag <= 18) return 'low'
  if (flag >= 19 && flag <= 26) return 'mid'
  if (flag >= 27 && flag <= 34) return 'high'
  if ((flag >= 92 && flag <= 107) || flag === 110 || flag === 111) return 'rig'
  if (flag >= 2001 && flag <= 2004) return 'low'
  if (flag >= 3001 && flag <= 3004) return 'mid'
  if (flag >= 4001 && flag <= 4004) return 'high'
  return 'other'
}

export function equipmentSlotLabel(slot) {
  const flag = slotFlag(slot)
  if (flag === 110) return '机库改装件'
  if (flag === 111) return '防御改装件'
  return SLOT_GROUPS.find(group => group.key === slotGroup(slot) && group.key !== 'other')?.label || '槽位待确认'
}

export function groupEquipmentItems(rows = []) {
  const grouped = new Map(SLOT_GROUPS.map(group => [group.key, { ...group, items: [] }]))
  rows.forEach(item => grouped.get(slotGroup(item.slot)).items.push(item))
  return SLOT_GROUPS.map(group => grouped.get(group.key))
}

export function itemImage(item) {
  return selectGameItemImage(item)
}

export function shipImage(report) {
  return selectGameItemImage(report)
}
