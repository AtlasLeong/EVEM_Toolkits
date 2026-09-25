// Light UI foregrounds; the star-map canvas keeps its separate bright palette.
export function getSecurityMapColor(value) {
  if (value == null || value === '') return '#94a3b8'
  const level = Number(value)
  if (!Number.isFinite(level)) return '#94a3b8'
  if (level <= 0) return '#ef4444'
  if (level < 0.2) return '#f97316'
  if (level < 0.5) return '#f59e0b'
  if (level < 0.8) return '#10b981'
  return '#60a5fa'
}

export function getSecurityTextColor(value) {
  const level = Number(value)
  if (Number.isNaN(level)) return '#6c6a63'
  if (level <= 0) return '#a13737'
  if (level < 0.2) return '#9a451a'
  if (level < 0.5) return '#80551c'
  if (level < 0.8) return '#356348'
  return '#315d7b'
}
