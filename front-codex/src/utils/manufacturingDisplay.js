const numberFormatter = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function formatCompactIsk(value) {
  if (value === null || value === undefined || value === '') return '待补价格'
  const number = Number(value)
  if (!Number.isFinite(number)) return `${value} ISK`
  if (Math.abs(number) >= 100_000_000) return `约 ${numberFormatter.format(number / 100_000_000)} 亿 ISK`
  if (Math.abs(number) >= 10_000) return `约 ${numberFormatter.format(number / 10_000)} 万 ISK`
  return `${numberFormatter.format(number)} ISK`
}
