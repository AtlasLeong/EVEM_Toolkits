const MAX_SYSTEMS = 10_000
const STALE_AFTER_MS = 20 * 60_000
const SNAPSHOT_KEYS = ['version', 'collected_at_ms', 'last_attempt_at_ms', 'status', 'systems', 'statistics_window']
const ROW_KEYS = ['solar_system_id', 'destroy_num', 'system_name', 'region_id', 'region_name']
const STATUSES = new Set(['ok', 'unavailable', 'unauthorized', 'rate_limited', 'network_error',
  'malformed', 'budget_exhausted', 'lease_lost', 'configuration_error', 'service_rejected', 'account_busy'])
const STATUS_LABELS = {
  unavailable: '尚无可用快照', unauthorized: '采集会话需要更新', rate_limited: '采集限流冷却中',
  network_error: '采集网络异常', malformed: '采集数据校验失败', budget_exhausted: '等待下轮采集',
  lease_lost: '采集已安全暂停', configuration_error: '采集配置待处理',
  service_rejected: '采集服务暂不可用', account_busy: '等待账号空闲',
}
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key))
const integer = (value, minimum = 0) => Number.isSafeInteger(value) && value >= minimum
const timestamp = value => value === null || integer(value)
const nullableName = value => value === null || (typeof value === 'string' && value.length <= 255)
const compareCountAndId = (idKey) => (left, right) => right.destroy_num - left.destroy_num || left[idKey] - right[idKey]
const displayName = (name, fallback) => typeof name === 'string' && name.trim() ? name.trim() : fallback
let updatedAtFormatter

export function isAnomalyActivityMetric(metric) {
  return exactKeys(metric, ['kind', 'range_version']) && metric.kind === 'activity_level' && metric.range_version === 1
}

export function validAnomalyMetric(metric) {
  return isAnomalyActivityMetric(metric) || exactKeys(metric, ['kind', 'range_version'])
    && metric.kind === 'legacy_unclassified' && metric.range_version === null
}

export function isAnomalyActivitySnapshot(snapshot) {
  return snapshot?.version === 2 && isAnomalyActivityMetric(snapshot.metric)
}

export function validateAnomalySnapshot(value) {
  const invalid = () => { throw new Error('异常热点数据无效') }
  const keys = value?.version === 2 ? [...SNAPSHOT_KEYS, 'metric'] : SNAPSHOT_KEYS
  if (!exactKeys(value, keys) || ![1, 2].includes(value.version) || value.statistics_window !== null
    || value.version === 2 && !validAnomalyMetric(value.metric)
    || !STATUSES.has(value.status) || !timestamp(value.collected_at_ms) || !timestamp(value.last_attempt_at_ms)
    || !Array.isArray(value.systems) || value.systems.length > MAX_SYSTEMS) invalid()
  const seen = new Set()
  let total = 0
  for (const row of value.systems) {
    if (!exactKeys(row, ROW_KEYS) || !integer(row.solar_system_id, 1) || !integer(row.destroy_num)
      || isAnomalyActivitySnapshot(value) && row.destroy_num > 5
      || seen.has(row.solar_system_id) || !nullableName(row.system_name) || !nullableName(row.region_name)
      || !(row.region_id === null || integer(row.region_id, 1))) invalid()
    seen.add(row.solar_system_id)
    total += row.destroy_num
    if (!Number.isSafeInteger(total)) invalid()
  }
  if ((value.collected_at_ms === null && (value.systems.length || value.status === 'ok'))
    || (value.collected_at_ms !== null && (value.last_attempt_at_ms === null || value.last_attempt_at_ms < value.collected_at_ms))) invalid()
  return value
}

export function retainLastGoodAnomalySnapshot(previous, next) {
  if (next.collected_at_ms !== null || previous?.collected_at_ms == null) return next
  // A missing/unreadable server file produces a logical unavailable sentinel.
  // Do not confuse that with a successful measured empty snapshot.
  return { ...previous, status: next.status,
    last_attempt_at_ms: Math.max(previous.last_attempt_at_ms, next.last_attempt_at_ms || 0) }
}

export function rankAnomalySystems(rows, limit = 10) {
  return [...(rows || [])].sort(compareCountAndId('solar_system_id')).slice(0, limit).map(row => ({
    ...row, displayName: displayName(row.system_name, `星系 ${row.solar_system_id}`),
  }))
}

export function rankAnomalyRegions(rows, limit = 10) {
  const grouped = new Map()
  let unknownRegionSystems = 0
  // ID order makes member lists and name fallback deterministic across refreshes.
  for (const row of [...(rows || [])].sort((a, b) => a.solar_system_id - b.solar_system_id)) {
    if (!integer(row.region_id, 1)) {
      unknownRegionSystems += 1
      continue
    }
    let region = grouped.get(row.region_id)
    if (!region) {
      region = { region_id: row.region_id, region_name: null, peak_value: 0, hotspotSystemCount: 0, memberSystemIds: [] }
      grouped.set(row.region_id, region)
    }
    if (!region.region_name && row.region_name?.trim()) region.region_name = row.region_name.trim()
    region.peak_value = Math.max(region.peak_value, row.destroy_num)
    if (row.destroy_num > 0) {
      region.hotspotSystemCount += 1
      region.memberSystemIds.push(row.solar_system_id)
    }
  }
  return {
    regions: [...grouped.values()].sort((a, b) => b.peak_value - a.peak_value
      || b.hotspotSystemCount - a.hotspotSystemCount || a.region_id - b.region_id).slice(0, limit).map(region => ({
      ...region, displayName: displayName(region.region_name, `星域 ${region.region_id}`),
    })),
    unknownRegionSystems,
  }
}

export function anomalySnapshotState(snapshot, { now = Date.now(), requestFailed = false, loading = false } = {}) {
  const hasSnapshot = snapshot?.collected_at_ms != null
  const stale = hasSnapshot && now - snapshot.collected_at_ms >= STALE_AFTER_MS
  const status = snapshot?.status || 'unavailable'
  const failed = requestFailed || status !== 'ok'
  let label = requestFailed ? '热点更新失败' : STATUS_LABELS[status]
  if (!failed) label = isAnomalyActivitySnapshot(snapshot)
    ? snapshot.systems.length ? '异常热点等级快照' : '当前快照无异常热点记录'
    : snapshot.systems.length ? '历史原始值 · 口径未确认' : '当前快照无异常摧毁记录'
  if (!hasSnapshot && loading && !requestFailed) label = '正在读取热点'
  return {
    hasSnapshot, stale,
    kind: failed || stale ? 'warning' : 'ok',
    label,
    detail: hasSnapshot && failed ? '保留最近成功快照，等待采集恢复。'
      : !hasSnapshot ? '尚未取得成功快照，不代表摧毁数量为零。'
        : stale ? '快照已超过 20 分钟未更新。' : '',
  }
}

export function formatAnomalyUpdatedAt(value) {
  if (value === null || value === undefined) return '暂无成功快照'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '更新时间无效'
  updatedAtFormatter ||= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const parts = updatedAtFormatter.formatToParts(date)
  const part = name => parts.find(item => item.type === name)?.value
  return `${part('year')}/${part('month')}/${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`
}

// The current game payload supplies levels, not exact destruction counts.
// Their range labels do not establish the API's still-unconfirmed time window.
export const ANOMALY_HEAT_BANDS = Object.freeze([
  { level: 1, name: '1–50', color: '#34d399', radius: 14 },
  { level: 2, name: '51–100', color: '#bef264', radius: 18 },
  { level: 3, name: '101–150', color: '#fbbf24', radius: 22 },
  { level: 4, name: '151–200', color: '#fb923c', radius: 26 },
  { level: 5, name: '>200', color: '#f43f5e', radius: 30 },
].map(band => Object.freeze(band)))

export function anomalyHeatBand(level) {
  if (!integer(level, 1) || level > ANOMALY_HEAT_BANDS.length) return null
  return ANOMALY_HEAT_BANDS[level - 1]
}

export function mappedAnomalyPoints(rows, systemMap, metric = null) {
  return (rows || []).flatMap(row => {
    const system = systemMap?.get(row.solar_system_id) || systemMap?.get(String(row.solar_system_id))
    if (!Number.isFinite(system?.px) || !Number.isFinite(system?.py)) return []
    return [{ ...row, px: system.px, py: system.py,
      activity_level: isAnomalyActivityMetric(metric) ? row.destroy_num : null }]
  })
}

export function fitAnomalyHotspots(points, size, { minZoom = .1, maxZoom = 10, padding = {} } = {}) {
  const finite = (points || []).filter(point => Number.isFinite(point.px) && Number.isFinite(point.py))
  if (!finite.length || !Number.isFinite(size?.width) || !Number.isFinite(size?.height)
    || size.width <= 0 || size.height <= 0 || !Number.isFinite(minZoom) || !Number.isFinite(maxZoom)
    || minZoom <= 0 || maxZoom < minZoom) return null
  const pad = Object.fromEntries(['left', 'right', 'top', 'bottom'].map(key => [key,
    Number.isFinite(padding[key]) ? Math.max(0, padding[key]) : 20]))
  const availableWidth = size.width - pad.left - pad.right
  const availableHeight = size.height - pad.top - pad.bottom
  if (availableWidth <= 0 || availableHeight <= 0) return null
  const xs = finite.map(point => point.px), ys = finite.map(point => point.py)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const zoom = Math.max(minZoom, Math.min(maxZoom,
    availableWidth / Math.max(1, maxX - minX), availableHeight / Math.max(1, maxY - minY)))
  return { zoom,
    panX: pad.left + availableWidth / 2 - (minX + maxX) / 2 * zoom,
    panY: pad.top + availableHeight / 2 - (minY + maxY) / 2 * zoom,
  }
}

// Each document retains only the current DPR's five display bands. Reusing
// raster circles preserves per-point source-over overlap, unlike batching all
// equal-color points into a single path (which changes overlap opacity).
const heatSpriteCaches = new WeakMap()
function heatSprite(ctx, band, ratio) {
  const doc = ctx.canvas?.ownerDocument
  if (!doc?.createElement || typeof ctx.drawImage !== 'function') return null
  let cache = heatSpriteCaches.get(doc)
  if (!cache || cache.ratio !== ratio) {
    cache = { ratio, bands: new Map() }
    heatSpriteCaches.set(doc, cache)
  }
  if (cache.bands.has(band.name)) return cache.bands.get(band.name)
  const canvas = doc.createElement('canvas')
  // One CSS pixel of transparent padding keeps the edge's antialiasing intact.
  canvas.width = canvas.height = Math.ceil((band.radius + 1) * 2 * ratio)
  const spriteCtx = canvas.getContext('2d')
  if (!spriteCtx) return null
  spriteCtx.setTransform(ratio, 0, 0, ratio, 0, 0)
  spriteCtx.fillStyle = band.color
  const center = canvas.width / ratio / 2
  for (const [radiusFactor, alpha] of [[1, .12], [.55, .22]]) {
    spriteCtx.globalAlpha = alpha
    spriteCtx.beginPath()
    spriteCtx.arc(center, center, band.radius * radiusFactor, 0, Math.PI * 2)
    spriteCtx.fill()
  }
  cache.bands.set(band.name, canvas)
  return canvas
}

export function drawAnomalyHeat(ctx, points, view, viewport) {
  if (!Number.isFinite(view.zoom) || view.zoom <= 0) return
  ctx.save()
  const ratio = Number.isFinite(viewport.ratio) && viewport.ratio > 0 ? viewport.ratio : 1
  for (const point of points) {
    const band = anomalyHeatBand(point.activity_level)
    if (!band) continue
    const screenX = point.px * view.zoom + view.panX
    const screenY = point.py * view.zoom + view.panY
    if (screenX < -band.radius || screenX > viewport.width + band.radius
      || screenY < -band.radius || screenY > viewport.height + band.radius) continue
    const sprite = heatSprite(ctx, band, ratio)
    if (sprite) {
      const diameter = sprite.width / ratio / view.zoom
      ctx.globalAlpha = 1
      ctx.drawImage(sprite, point.px - diameter / 2, point.py - diameter / 2, diameter, diameter)
      continue
    }
    // No DOM/2D backing surface (e.g. SSR): retain the original vector path.
    ctx.fillStyle = band.color
    for (const [radiusFactor, alpha] of [[1, .12], [.55, .22]]) {
      ctx.globalAlpha = alpha
      ctx.beginPath()
      ctx.arc(point.px, point.py, band.radius * radiusFactor / view.zoom, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
  ctx.globalAlpha = 1
}
