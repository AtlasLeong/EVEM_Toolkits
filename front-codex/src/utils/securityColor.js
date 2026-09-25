// Light UI foregrounds; the star-map canvas keeps its separate bright palette.
function normalizedSecurityValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || value.trim() === '') return null
  const level = Number(value)
  return Number.isFinite(level) ? level : null
}

export function getSecurityMapColor(value) {
  const level = normalizedSecurityValue(value)
  if (level === null) return '#94a3b8'
  if (level <= 0) return '#ef4444'
  if (level < 0.2) return '#f97316'
  if (level < 0.5) return '#f59e0b'
  if (level < 0.8) return '#10b981'
  return '#60a5fa'
}

export function formatSecurityLabel(value, digits = 2) {
  const level = normalizedSecurityValue(value)
  return level === null ? '安等未知' : level.toFixed(digits)
}

export function getSecurityTextColor(value) {
  const level = normalizedSecurityValue(value)
  if (level === null) return '#6c6a63'
  if (level <= 0) return '#a13737'
  if (level < 0.2) return '#9a451a'
  if (level < 0.5) return '#80551c'
  if (level < 0.8) return '#356348'
  return '#315d7b'
}
