const compactUnits = [
  [1n, ''],
  [10000n, '万'],
  [100000000n, '亿'],
  [1000000000000n, '万亿'],
]

export function formatCompactMarketPrice(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '样本不足'

  const decimal = String(value).trim()
  if (!/^\d+(?:\.\d+)?$/.test(decimal)) return '样本不足'

  const [whole, fraction = ''] = decimal.split('.')
  const hundredths = BigInt(whole + fraction) * 100n
  const scale = 10n ** BigInt(fraction.length)

  for (const [unit, suffix] of compactUnits) {
    const divisor = scale * unit
    // Round the original decimal at each unit, never an already-rounded value.
    const rounded = (hundredths + divisor / 2n) / divisor
    if (rounded >= 1000000n && suffix !== '万亿') continue

    const integral = rounded / 100n
    const fractional = String(rounded % 100n).padStart(2, '0').replace(/0+$/, '')
    return `${integral}${fractional ? `.${fractional}` : ''}${suffix}`
  }
}
