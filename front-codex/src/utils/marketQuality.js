import { marketRefetchInterval } from './marketPolling.js'

// A summary read every five minutes leaves room in the shared public API
// throttle for the existing two-minute catalog and chart polling.
export function qualityRefetchInterval(query, visibility) {
  const interval = marketRefetchInterval(query, visibility)
  return interval === false ? false : Math.max(300000, interval)
}

export function qualityNow(data, monotonicNow, fallbackNow = Date.now()) {
  const generated = Date.parse(data?.generated_at)
  const readAt = data?.client_read_monotonic_ms
  if (!Number.isFinite(generated) || !Number.isFinite(readAt)) return fallbackNow
  return generated + Math.max(0, monotonicNow - readAt)
}

// Re-age the cached observations with the market page's existing 30s clock.
// Missing orders are booleans here: an absent quote never becomes a zero price.
export function marketQualityCounts(data, now = Date.now()) {
  if (!data || !Array.isArray(data.observations)) return null
  const counts = { enabled: data.counts.enabled, observed: 0, uncollected: 0, fresh_sell: 0, stale_sell: 0, stale_observed: 0, missing_sell: 0, empty_book: 0 }
  const staleAfter = data.stale_after_seconds * 1000
  for (const observation of data.observations) {
    const observed = Date.parse(observation.observed_at)
    if (!Number.isFinite(observed)) {
      counts.uncollected++
      continue
    }
    counts.observed++
    const stale = now - observed > staleAfter
    if (stale) counts.stale_observed++
    if (observation.has_sell) counts[stale ? 'stale_sell' : 'fresh_sell']++
    else counts.missing_sell++
    if (!observation.has_sell && !observation.has_buy) counts.empty_book++
  }
  return counts
}

export function qualityCoverage(count, total) {
  return total > 0 ? `${(count / total * 100).toFixed(1)}%` : '暂无采集商品'
}

export function qualityAge(value, now = Date.now()) {
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return '尚无成功采集'
  const minutes = Math.max(0, Math.floor((now - time) / 60000))
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  if (minutes < 1440) return `${Math.floor(minutes / 60)} 小时 ${minutes % 60} 分钟前`
  return `${Math.floor(minutes / 1440)} 天前`
}

const COLLECTION_LABELS = {
  collecting: '正在采集', paused: '采集已暂停', waiting: '等待首次采集',
  healthy: '最近采集正常', recovered: '采集已恢复', partial: '部分采集失败',
  failed: '最近采集失败', retrying: '等待后续采集', attention: '采集暂不可用',
}

export function collectionLabel(status) {
  return COLLECTION_LABELS[status] || '采集状态未知'
}
