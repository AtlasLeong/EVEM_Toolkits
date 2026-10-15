import { formatAnomalyUpdatedAt } from './anomalyHotspots.js'

export function formatControlTime(value) {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return formatAnomalyUpdatedAt(value)
  if (typeof value !== 'string' || !value) return '暂无记录'
  // Legacy Django USE_TZ=False serializes Shanghai wall time without an offset.
  // Never interpret it in the viewer's browser timezone.
  const normalized = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(value)
    ? `${value.replace(' ', 'T')}+08:00` : value
  const parsed = Date.parse(normalized)
  return Number.isFinite(parsed) ? formatAnomalyUpdatedAt(parsed) : '暂无记录'
}
