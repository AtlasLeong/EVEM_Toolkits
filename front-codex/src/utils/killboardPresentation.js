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

export function participantShipLabel(row = {}) {
  const name = typeof row.ship_name === 'string' ? row.ship_name.trim() : ''
  return name || (idLabel(row.ship_type_id) ? '舰船名称待补' : '舰船资料未返回')
}

export function participantIdentity(row = {}) {
  const characterId = idLabel(row.character_id)
  const corporationId = idLabel(row.corporation_id)
  const characterName = String(row.character_name || '').trim()
  const corporationName = String(row.corporation_name || '').trim()
  return {
    name: characterName || (characterId ? `角色 ID ${characterId}` : '未知角色'),
    nameDetail: characterName && characterId ? `ID ${characterId}` : characterId,
    corporation: corporationName || (corporationId ? `军团 ID ${corporationId}` : '军团资料未返回'),
    corporationDetail: corporationName && corporationId ? `ID ${corporationId}` : corporationId,
    named: Boolean(characterName),
  }
}

export function visibleParticipantRows(rows = []) {
  return rows.filter(row => {
    if (!row || typeof row !== 'object') return false
    return String(row.character_name || '').trim().length > 0
  }).slice(0, 7)
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
  if (flag >= 92 && flag <= 99) return 'rig'
  return 'other'
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
