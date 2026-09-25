const MAX_RESULTS = 8

function value(node, ...keys) {
  for (const key of keys) {
    if (node?.[key] !== undefined && node?.[key] !== null) return node[key]
  }
  return ''
}

function securityMeta(raw) {
  if (raw === null || raw === undefined || String(raw).trim() === '') return { securityLabel: '安等未知', securityRange: '未知范围', currentRange: '当前范围未知' }
  const numeric = Number(raw)
  if (!Number.isFinite(numeric)) return { securityLabel: '安等未知', securityRange: '未知范围', currentRange: '当前范围未知' }
  const securityLabel = numeric.toFixed(2)
  const securityRange = numeric <= 0 ? '零安' : numeric < 0.5 ? '低安' : numeric < 0.8 ? '中安' : '高安'
  return { securityLabel, securityRange, currentRange: `当前${securityRange}` }
}

export function formatTacticalSystemResult(node = {}) {
  const systemId = value(node, 'system_id', 'id')
  const chineseName = String(value(node, 'zh_name', 'chinese_name')).trim()
  const englishName = String(value(node, 'name', 'english_name')).trim()
  const name = chineseName || englishName || (systemId === '' ? '未命名星系' : `星系 ${systemId}`)
  return { ...node, systemId, name, chineseName, englishName, ...securityMeta(value(node, 'security_status', 'securityStatus')) }
}

export function searchTacticalSystems(systems, query, limit = MAX_RESULTS) {
  const list = Array.isArray(systems) ? systems : []
  const needle = String(query ?? '').trim().toLocaleLowerCase()
  const cap = Math.min(MAX_RESULTS, Math.max(0, Number(limit) || 0))
  return list.filter(node => {
    if (!needle) return true
    return [value(node, 'zh_name', 'chinese_name'), value(node, 'name', 'english_name'), value(node, 'system_id', 'id')]
      .some(field => String(field).toLocaleLowerCase().includes(needle))
  }).slice(0, cap).map(formatTacticalSystemResult)
}
