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

const KILLBOARD_SECURITY_COLORS = Object.freeze({
  high: '#77e6e0',
  low: '#f5b95d',
  nullsec: '#ff7d72',
  unknown: '#9fb4b9',
})

function reportSecurityValue(report = {}) {
  const target = report && typeof report === 'object' ? report : {}
  const candidates = [
    target.security_status,
    target.system_security,
    target.system_security_status,
    target.solarsystem_security,
    target.solar_system_security,
    target.security,
    target.system?.security_status,
    target.solarsystem?.security_status,
  ]
  for (const candidate of candidates) {
    const normalized = normalizedSecurityValue(candidate)
    if (normalized !== null) return normalized
  }
  return null
}

/**
 * A semantic, dark-theme-safe security presentation for the killboard.
 * The label is always rendered alongside the color band so security never
 * relies on color alone. Keep this mapping separate from the light map colors.
 */
export function killboardSecurityMeta(report = {}) {
  const value = reportSecurityValue(report)
  if (value === null) {
    return { value: null, valueLabel: '未知', zoneLabel: '安等未知', band: 'unknown', className: 'is-unknown', color: KILLBOARD_SECURITY_COLORS.unknown }
  }
  const valueLabel = value.toFixed(2)
  if (value <= 0) {
    return { value, valueLabel, zoneLabel: '00地区', band: 'nullsec', className: 'is-nullsec', color: KILLBOARD_SECURITY_COLORS.nullsec }
  }
  if (value < 0.5) {
    return { value, valueLabel, zoneLabel: '低安', band: 'low', className: 'is-low', color: KILLBOARD_SECURITY_COLORS.low }
  }
  return { value, valueLabel, zoneLabel: '高安', band: 'high', className: 'is-high', color: KILLBOARD_SECURITY_COLORS.high }
}
