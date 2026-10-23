import test from 'node:test'
import assert from 'node:assert/strict'

const helpers = await import('../../src/utils/anomalyHotspots.js').catch(() => ({}))
const use = (name, ...args) => {
  assert.equal(typeof helpers[name], 'function', `${name} is not implemented`)
  return helpers[name](...args)
}
const row = (id, count, metadata = {}) => ({
  solar_system_id: id, destroy_num: count, system_name: null,
  region_id: null, region_name: null, ...metadata,
})
const snapshot = (systems = [], overrides = {}) => ({
  version: 1, collected_at_ms: 1_000, last_attempt_at_ms: 1_000,
  status: 'ok', statistics_window: null, systems, ...overrides,
})

test('bounded snapshots preserve exact counts and distinguish a valid empty result', () => {
  const input = snapshot([row(1, 0), row(2, 155)])
  assert.deepEqual(use('validateAnomalySnapshot', input), input)
  assert.deepEqual(use('validateAnomalySnapshot', snapshot()).systems, [])
})

test('invalid IDs, counts, duplicated rows, unsafe sums and excessive rows fail closed', () => {
  for (const systems of [
    [row(0, 1)], [row('1', 1)], [row(1, -1)], [row(1, 1.1)],
    [row(1, true)], [row(1, Number.MAX_SAFE_INTEGER + 1)],
    [row(1, 1), row(1, 2)], [row(1, Number.MAX_SAFE_INTEGER), row(2, 1)],
    Array.from({ length: 10_001 }, (_, i) => row(i + 1, 1)),
    [row(1, 1, { region_id: '5' })], [row(1, 1, { system_name: {} })],
  ]) assert.throws(() => use('validateAnomalySnapshot', snapshot(systems)), /异常热点数据无效/)
})

test('snapshot status and timeframe cannot invent an unsupported statistics window', () => {
  for (const overrides of [
    { version: 2 }, { statistics_window: '24h' }, { status: 'raw secret error' },
    { collected_at_ms: null }, { last_attempt_at_ms: 999 },
    { collected_at_ms: NaN }, { unexpected: 'secret' },
  ]) assert.throws(() => use('validateAnomalySnapshot', snapshot([row(1, 1)], overrides)), /异常热点数据无效/)
  assert.equal(use('validateAnomalySnapshot', snapshot([], {
    status: 'rate_limited', collected_at_ms: null, last_attempt_at_ms: 1_000,
  })).status, 'rate_limited')
})

test('system ranking is exact descending count then ID with default top ten and ID fallback', () => {
  const rows = [row(3, 155), row(1, 155), row(2, 100, { system_name: '阿尔法' }),
    ...Array.from({ length: 12 }, (_, i) => row(i + 4, 80 - i))]
  const before = JSON.stringify(rows)
  const result = use('rankAnomalySystems', rows)
  assert.equal(result.length, 10)
  assert.deepEqual(result.slice(0, 3).map(item => item.solar_system_id), [1, 3, 2])
  assert.equal(result[0].displayName, '星系 1')
  assert.equal(result[2].displayName, '阿尔法')
  assert.equal(result[0].destroy_num, 155)
  assert.equal(JSON.stringify(rows), before)
  assert.deepEqual(use('rankAnomalySystems', [...rows].reverse()), result)
})

test('region ranking uses peak value, then positive hotspot membership, never summed levels', () => {
  const rows = [row(4, 80), row(2, 30, { region_id: 20, region_name: '乙域' }),
    row(1, 50, { region_id: 10, region_name: '甲域' }), row(3, 20, { region_id: 20, region_name: '乙域' }), row(5, 0)]
  const result = use('rankAnomalyRegions', rows)
  assert.deepEqual(result.regions.map(item => [item.region_id, item.peak_value, item.hotspotSystemCount]), [[10, 50, 1], [20, 30, 2]])
  assert.deepEqual(result.regions[1].memberSystemIds, [2, 3])
  assert.equal(result.unknownRegionSystems, 2)
  assert.deepEqual(use('rankAnomalyRegions', [...rows].reverse()), result)
  assert.equal(use('rankAnomalyRegions', [row(1, 2, { region_id: 10 })]).regions[0].displayName, '星域 10')
})

const activityMetric = { kind: 'activity_level', range_version: 1 }
const currentSnapshot = (systems = [], overrides = {}) => snapshot(systems, { version: 2, metric: activityMetric, ...overrides })

test('explicit v2 metrics bound current levels but preserve historical raw data without inference', () => {
  const current = currentSnapshot([row(1, 0), row(2, 5)])
  assert.equal(use('validateAnomalySnapshot', current), current)
  assert.equal(use('isAnomalyActivitySnapshot', current), true)
  assert.equal(use('isAnomalyActivitySnapshot', snapshot([row(1, 1)])), false)
  const legacy = currentSnapshot([row(1, 155)], { metric: { kind: 'legacy_unclassified', range_version: null } })
  assert.equal(use('validateAnomalySnapshot', legacy), legacy)
  assert.equal(use('isAnomalyActivitySnapshot', legacy), false)
  for (const invalid of [currentSnapshot([row(1, 6)]), currentSnapshot([row(1, -1)]),
    currentSnapshot([], { metric: { kind: 'activity_level', range_version: 2 } }),
    currentSnapshot([], { metric: { kind: 'legacy_unclassified', range_version: 1 } }),
    currentSnapshot([], { metric: { ...activityMetric, arbitrary: true } }),
    snapshot([], { metric: activityMetric }), currentSnapshot([], { statistics_window: '24h' })]) {
    assert.throws(() => use('validateAnomalySnapshot', invalid), /异常热点数据无效/)
  }
})

test('unavailable fallback retains matching version, metric, raw rows and original success time', () => {
  const previous = currentSnapshot([row(1, 4)])
  const unavailable = currentSnapshot([], { collected_at_ms: null, last_attempt_at_ms: 2000,
    status: 'unavailable', metric: { kind: 'legacy_unclassified', range_version: null } })
  const retained = use('retainLastGoodAnomalySnapshot', previous, unavailable)
  assert.deepEqual(retained.metric, activityMetric)
  assert.equal(retained.version, 2)
  assert.equal(retained.collected_at_ms, 1000)
  assert.equal(retained.last_attempt_at_ms, 2000)
  assert.equal(retained.systems, previous.systems)
  assert.equal(use('validateAnomalySnapshot', retained), retained)
  const legacyRetained = use('retainLastGoodAnomalySnapshot', snapshot([row(1, 155)]), unavailable)
  assert.equal(legacyRetained.version, 1)
  assert.equal(Object.hasOwn(legacyRetained, 'metric'), false)
  assert.equal(use('validateAnomalySnapshot', legacyRetained), legacyRetained)
})

test('heat mapping requires explicit activity metric even for small legacy values', () => {
  const rows = [row(1, 1), row(2, 5), row(3, 0)]
  const map = new Map(rows.map(item => [item.solar_system_id, { px: 10, py: 20 }]))
  assert.ok(use('mappedAnomalyPoints', rows, map).every(point => point.activity_level == null))
  assert.deepEqual(use('mappedAnomalyPoints', rows, map, activityMetric).map(point => point.activity_level), [1, 5, 0])
  const arcs = []
  const ctx = { save() {}, restore() {}, beginPath() {}, fill() {}, arc() { arcs.push(true) } }
  use('drawAnomalyHeat', ctx, use('mappedAnomalyPoints', rows, map), { zoom: 1, panX: 0, panY: 0 }, { width: 100, height: 100 })
  assert.equal(arcs.length, 0, 'legacy values must not acquire guessed level colors')
})

test('equal-peak region ordering uses positive hotspot member count then stable ID', () => {
  const result = use('rankAnomalyRegions', [row(1, 5, { region_id: 30 }), row(2, 5, { region_id: 20 }),
    row(3, 1, { region_id: 20 }), row(4, 0, { region_id: 30 }), row(5, 5, { region_id: 10 }), row(6, 2, { region_id: 10 })])
  assert.deepEqual(result.regions.map(item => [item.region_id, item.peak_value, item.hotspotSystemCount]), [[10, 5, 2], [20, 5, 2], [30, 5, 1]])
  assert.deepEqual(result.regions[2].memberSystemIds, [1])
})

test('failed refresh keeps the last-good rows and time while explicitly reporting failure', () => {
  const input = snapshot([row(1, 155)], { status: 'rate_limited', last_attempt_at_ms: 2_000 })
  const result = use('anomalySnapshotState', input, { now: 3_000 })
  assert.equal(result.hasSnapshot, true)
  assert.equal(result.kind, 'warning')
  assert.match(result.label, /限流/)
  assert.match(result.detail, /保留/)
  const httpFailure = use('anomalySnapshotState', snapshot([row(1, 155)]), { now: 3_000, requestFailed: true })
  assert.match(httpFailure.label, /更新失败/)
  assert.equal(input.collected_at_ms, 1_000)
  assert.equal(input.systems[0].destroy_num, 155)
})

test('a missing-file unavailable sentinel cannot wipe a browser last-good snapshot', () => {
  const previous = snapshot([row(1, 155)])
  const unavailable = snapshot([], { status: 'unavailable', collected_at_ms: null, last_attempt_at_ms: null })
  const retained = use('retainLastGoodAnomalySnapshot', previous, unavailable)
  assert.equal(retained.status, 'unavailable')
  assert.equal(retained.collected_at_ms, previous.collected_at_ms)
  assert.deepEqual(retained.systems, previous.systems)
  assert.equal(retained.last_attempt_at_ms, previous.last_attempt_at_ms)
  assert.equal(use('retainLastGoodAnomalySnapshot', null, unavailable), unavailable)
  const validEmpty = snapshot([], { collected_at_ms: 2_000, last_attempt_at_ms: 2_000 })
  assert.equal(use('retainLastGoodAnomalySnapshot', previous, validEmpty), validEmpty)
})

test('missing data is not presented as zero and a 20-minute old snapshot is stale', () => {
  assert.equal(use('anomalySnapshotState', null, { loading: true }).label, '正在读取热点')
  assert.equal(use('anomalySnapshotState', null).hasSnapshot, false)
  assert.equal(use('anomalySnapshotState', snapshot()).label, '当前快照无异常摧毁记录')
  assert.equal(use('anomalySnapshotState', snapshot([row(1, 0)])).hasSnapshot, true)
  assert.equal(use('anomalySnapshotState', snapshot([row(1, 1)]), { now: 1_000 + 20 * 60_000 }).stale, true)
  assert.equal(use('anomalySnapshotState', snapshot([row(1, 1)]), { now: 1_000 + 19 * 60_000 }).stale, false)
  assert.equal(use('anomalySnapshotState', snapshot([], { collected_at_ms: null, status: 'unavailable' })).hasSnapshot, false)
})

test('timestamps are always 24-hour Asia/Shanghai and no timestamp is not epoch zero', () => {
  assert.equal(use('formatAnomalyUpdatedAt', Date.UTC(2026, 9, 13, 15, 5, 2)), '2026/10/13 23:05:02')
  assert.equal(use('formatAnomalyUpdatedAt', Date.UTC(2026, 9, 13, 16, 0, 0)), '2026/10/14 00:00:00')
  assert.equal(use('formatAnomalyUpdatedAt', null), '暂无成功快照')
})

const heatBands = [
  { level: 1, name: '1–50', color: '#34d399', radius: 14 },
  { level: 2, name: '51–100', color: '#bef264', radius: 18 },
  { level: 3, name: '101–150', color: '#fbbf24', radius: 22 },
  { level: 4, name: '151–200', color: '#fb923c', radius: 26 },
  { level: 5, name: '>200', color: '#f43f5e', radius: 30 },
]

test('five immutable heat bands map discrete game levels to distinct colors and increasing screen radii', () => {
  assert.deepEqual(helpers.ANOMALY_HEAT_BANDS, heatBands)
  assert.ok(Object.isFrozen(helpers.ANOMALY_HEAT_BANDS))
  assert.ok(helpers.ANOMALY_HEAT_BANDS.every(Object.isFrozen))
  for (const expected of heatBands) {
    assert.deepEqual(use('anomalyHeatBand', expected.level), expected)
    assert.equal(use('anomalyHeatBand', expected.level), helpers.ANOMALY_HEAT_BANDS[expected.level - 1])
  }
  assert.equal(new Set(heatBands.map(band => band.color)).size, 5)
  assert.ok(heatBands.every((band, index) => index === 0 || band.radius > heatBands[index - 1].radius))
})

test('heat levels reject invalid inputs and never reinterpret numeric values as legacy counts', () => {
  for (const invalid of [0, -1, true, false, '1', '5', 1.5, 6, 50, 80, 155, 200, 201, NaN, Infinity, -Infinity, null, undefined]) {
    assert.equal(use('anomalyHeatBand', invalid), null, `invalid level ${String(invalid)}`)
  }
})

test('mapped heat points use only known finite normalized coordinates and retain unknown ranking rows', () => {
  const rows = [row(1, 50), row(2, 155), row(3, 200), row(4, 0), row(5, 10)]
  const map = new Map([[1, { px: 20, py: 30 }], ['2', { px: 40, py: 50 }],
    [3, { px: NaN, py: 70 }], [4, { px: 80, py: 90 }]])
  const points = use('mappedAnomalyPoints', rows, map)
  assert.deepEqual(points.map(item => [item.solar_system_id, item.px, item.py]), [[1, 20, 30], [2, 40, 50], [4, 80, 90]])
  assert.equal(use('rankAnomalySystems', rows).length, 5)
})

test('region fit targets verified hotspot member bounds with overlay padding and bounded zoom', () => {
  const points = [{ px: 100, py: 200 }, { px: 300, py: 400 }, { px: Infinity, py: 999 }]
  const options = { minZoom: .3, maxZoom: 8, padding: { left: 300, right: 340, top: 70, bottom: 30 } }
  const result = use('fitAnomalyHotspots', points, { width: 1200, height: 800 }, options)
  assert.equal(result.zoom, 2.8)
  assert.equal(200 * result.zoom + result.panX, 580)
  assert.equal(300 * result.zoom + result.panY, 420)
  assert.deepEqual(use('fitAnomalyHotspots', [...points].reverse(), { width: 1200, height: 800 }, options), result)
  assert.equal(use('fitAnomalyHotspots', [{ px: 10, py: 10 }], { width: 1200, height: 800 }, options).zoom, 8)
  assert.equal(use('fitAnomalyHotspots', [{ px: 0, py: 0 }, { px: 10_000, py: 10_000 }], { width: 1200, height: 800 }, options).zoom, .3)
  assert.equal(use('fitAnomalyHotspots', [], { width: 1200, height: 800 }, options), null)
  assert.equal(use('fitAnomalyHotspots', points, { width: 0, height: 800 }, options), null)
})

test('heat circles cull with their full radius and reset alpha before route and security drawing', () => {
  const calls = []
  const ctx = {
    globalAlpha: 1, fillStyle: '',
    save() { calls.push('save') }, restore() { calls.push('restore') },
    beginPath() {}, arc(x, y, radius) { calls.push({ x, y, radius, alpha: this.globalAlpha, color: this.fillStyle }) }, fill() {},
  }
  use('drawAnomalyHeat', ctx, [
    { px: -15, py: 20, destroy_num: 3, activity_level: 3 },
    { px: -80, py: 20, destroy_num: 3, activity_level: 3 },
    { px: 20, py: 20, destroy_num: 0, activity_level: 0 },
  ], { zoom: 2, panX: 20, panY: 0 }, { width: 300, height: 200 })
  const arcs = calls.filter(item => typeof item === 'object')
  assert.ok(arcs.length > 0, 'a circle intersecting the edge is visible')
  assert.ok(arcs.every(item => item.x === -15 && item.alpha > 0 && item.alpha < 1))
  assert.deepEqual(arcs.map(item => item.color), ['#fbbf24', '#fbbf24'])
  assert.equal(ctx.globalAlpha, 1)
  assert.equal(calls[0], 'save')
  assert.equal(calls.at(-1), 'restore')
})

test('direct heat circles use all five actual colors with constant CSS-pixel radii at different zooms', () => {
  for (const zoom of [.5, 2]) {
    const arcs = []
    const ctx = { globalAlpha: 1, globalCompositeOperation: 'source-over', save() {}, restore() {}, beginPath() {}, fill() {},
      arc(x, y, radius) { arcs.push({ x, y, radius, alpha: this.globalAlpha, color: this.fillStyle, composite: this.globalCompositeOperation }) } }
    const points = heatBands.map(band => ({ px: 50, py: 50, destroy_num: band.level, activity_level: band.level }))
    use('drawAnomalyHeat', ctx, [...points, { px: 50, py: 50, destroy_num: 6 }],
      { zoom, panX: 0, panY: 0 }, { width: 300, height: 200 })
    assert.equal(arcs.length, 10)
    assert.deepEqual(arcs.map(item => item.color), heatBands.flatMap(band => [band.color, band.color]))
    assert.deepEqual(arcs.map(item => item.radius * zoom), heatBands.flatMap(band => [band.radius, band.radius * .55]))
    assert.deepEqual(arcs.map(item => item.alpha), heatBands.flatMap(() => [.12, .22]))
    assert.ok(arcs.every(item => item.composite === 'source-over'))
    assert.equal(ctx.globalAlpha, 1)
  }
})

test('snapshot time formatting reuses one formatter instead of constructing it per camera frame', async () => {
  const Original = Intl.DateTimeFormat
  let constructors = 0
  Intl.DateTimeFormat = new Proxy(Original, {
    construct(target, args) { constructors += 1; return Reflect.construct(target, args) },
  })
  try {
    const fresh = await import('../../src/utils/anomalyHotspots.js?formatter-reuse-test')
    assert.equal(fresh.formatAnomalyUpdatedAt(Date.UTC(2026, 9, 13, 15)), '2026/10/13 23:00:00')
    assert.equal(fresh.formatAnomalyUpdatedAt(Date.UTC(2026, 9, 13, 16)), '2026/10/14 00:00:00')
    assert.equal(constructors, 1)
  } finally { Intl.DateTimeFormat = Original }
})

test('DPR-aware heat sprites preserve five colors and per-point overlap while reusing five bands per DPR', () => {
  const sprites = [], images = [], sourceArcs = []
  const ownerDocument = { createElement(tag) {
    assert.equal(tag, 'canvas')
    const canvas = { width: 0, height: 0, getContext: () => ({
      setTransform(...args) { canvas.transform = args }, beginPath() {}, fill() {},
      globalCompositeOperation: 'source-over',
      arc(x, y, radius) { sourceArcs.push({ radius, alpha: this.globalAlpha, color: this.fillStyle, composite: this.globalCompositeOperation }) },
    }) }
    sprites.push(canvas)
    return canvas
  } }
  const composites = []
  const ctx = { canvas: { ownerDocument }, globalAlpha: 1, globalCompositeOperation: 'source-over', save() {}, restore() {},
    drawImage(...args) { images.push(args); composites.push(this.globalCompositeOperation) }, beginPath() { assert.fail('heat paths should be cached') },
    arc() { assert.fail('heat arcs should be cached') }, fill() {} }
  const points = [1, 2, 3, 4, 5].map(destroy_num => ({ px: 40, py: 50, destroy_num, activity_level: destroy_num }))
  points.push({ px: -1000, py: 50, destroy_num: 5 }, { px: 40, py: 50, destroy_num: 6 })
  const view = { zoom: .5, panX: 0, panY: 0 }, viewport = { width: 300, height: 200, ratio: 2 }
  use('drawAnomalyHeat', ctx, points, view, viewport)
  use('drawAnomalyHeat', ctx, points, view, viewport)
  assert.equal(sprites.length, 5)
  assert.equal(sourceArcs.length, 10)
  assert.deepEqual(sourceArcs.map(arc => arc.alpha), heatBands.flatMap(() => [.12, .22]))
  assert.deepEqual(sourceArcs.map(arc => arc.color), heatBands.flatMap(band => [band.color, band.color]))
  assert.deepEqual(sourceArcs.map(arc => arc.radius), heatBands.flatMap(band => [band.radius, band.radius * .55]))
  assert.ok(sourceArcs.every(arc => arc.composite === 'source-over'))
  assert.equal(images.length, 10)
  assert.ok(composites.every(composite => composite === 'source-over'))
  assert.deepEqual(images.slice(0, 5).map(([canvas]) => canvas), images.slice(5).map(([canvas]) => canvas))
  assert.ok(sprites.every(canvas => canvas.width === canvas.height && canvas.transform[0] === 2))
  assert.ok(images.every(([canvas, , , width, height]) => width === canvas.width / 2 / view.zoom && height === width))
  assert.equal(ctx.globalAlpha, 1)
  use('drawAnomalyHeat', ctx, points, view, { ...viewport, ratio: 1 })
  assert.equal(sprites.length, 10, 'changing DPR replaces the five active raster surfaces')
  use('drawAnomalyHeat', ctx, points, view, { ...viewport, ratio: 1 })
  assert.equal(sprites.length, 10, 'unchanged DPR keeps the five new surfaces')
})
