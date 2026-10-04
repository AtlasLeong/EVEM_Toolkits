const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

const missingMaterialLabels = {
  quote_absent: '尚未采集',
  quote_uncollected: '尚未采集',
  quote_stale: '报价已过期',
  quote_empty: '暂无有效报价',
  quote_invalid: '报价无效',
  price_invalid: '单价无效',
}

export function formatMissingMaterialReason(reason) {
  return Object.hasOwn(missingMaterialLabels, reason) ? missingMaterialLabels[reason] : '待补价格'
}

export function formatManufacturingObservationTime(value) {
  const time = value ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) return '采集时间未知'
  return `${new Date(time).toLocaleString('zh-CN', { hour12: false, timeZone: 'UTC' })} UTC`
}

export function formatCompactIsk(value) {
  if (value === null || value === undefined || value === '') return '待补价格'
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} ISK`
  if (Math.abs(number) >= 100_000_000) return `约 ${numberFormatter.format(number / 100_000_000)} 亿 ISK`
  if (Math.abs(number) >= 10_000) return `约 ${numberFormatter.format(number / 10_000)} 万 ISK`
  return `${numberFormatter.format(number)} ISK`
}
