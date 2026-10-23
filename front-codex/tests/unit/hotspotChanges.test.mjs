import test from 'node:test'
import assert from 'node:assert/strict'

const helpers = await import('../../src/utils/hotspotChanges.js').catch(() => ({}))
const use = (name, ...args) => {
  assert.equal(typeof helpers[name], 'function', `${name} is not implemented`)
  return helpers[name](...args)
}
const interval = { id: 2000, start_at_ms: 1000, end_at_ms: 2000, elapsed_ms: 1000 }
const row = (id, previous, current) => ({ solar_system_id: id, previous_destroy_num: previous,
  destroy_num: current, delta: current - previous, system_name: null, region_id: null, region_name: null })
const data = systems => ({ version: 1, status: 'ok', statistics_window: null, interval,
  coverage: { comparable: systems.length, new: 2, missing: 1, negative: 1, unchanged: 0 },
  systems, intervals: [interval], next_before: null })

test('changes validate signed positive differences, sort descending then ID without mutation', () => {
  const input = data([row(3, 20, 25), row(2, 30, 40), row(1, 4, 9)])
  assert.deepEqual(use('validateHotspotChanges', input), input)
  assert.deepEqual(use('rankHotspotChanges', input.systems).map(item => item.solar_system_id), [2, 1, 3])
  assert.deepEqual(input.systems.map(item => item.solar_system_id), [3, 2, 1])
})

test('changes reject malformed, invented windows, unsafe and duplicate fields', () => {
  const valid = data([row(1, 2, 8)])
  for (const item of [
    { ...valid, statistics_window: '10m' }, { ...valid, unexpected: 'secret' },
    { ...valid, interval: { ...interval, elapsed_ms: 9 } },
    data([row(1, 2, 8), row(1, 2, 8)]),
    data([{ ...row(1, 2, 8), delta: 7 }]), data([row(0, 2, 8)]),
    data([row(1, 2, Number.MAX_SAFE_INTEGER + 1)]),
    { ...valid, coverage: { ...valid.coverage, missing: -1 } },
  ]) assert.throws(() => use('validateHotspotChanges', item), /变化榜数据无效/)
})

test('complete comparable payload includes signed decreases and zeros but ranks only positive growth', () => {
  const input = data([row(3, 40, 30), row(2, 50, 50), row(1, 20, 25)])
  assert.deepEqual(use('validateHotspotChanges', input), input)
  assert.deepEqual(use('rankHotspotChanges', input.systems).map(item => item.solar_system_id), [1])
})

test('baseline has no invented rows or interval and elapsed labels show actual gap', () => {
  const baseline = { ...data([]), status: 'baseline', interval: null, intervals: [], coverage: { comparable: 0, new: 0, missing: 0, negative: 0, unchanged: 0 } }
  assert.deepEqual(use('validateHotspotChanges', baseline), baseline)
  assert.equal(use('formatHotspotElapsed', 95 * 60_000), '95 分钟')
  assert.equal(use('formatHotspotElapsed', 90_000), '1 分 30 秒')
  assert.throws(() => use('validateHotspotChanges', { ...baseline, systems: [row(1, 2, 8)] }), /变化榜数据无效/)
})

const metric = { kind: 'activity_level', range_version: 1 }
const current = systems => ({ ...data(systems), version: 2, metric })
test('v2 comparable changes are explicit bounded level differences, not destruction count growth', () => {
  const input = current([row(1, 1, 5), row(2, 4, 4), row(3, 3, 1)])
  assert.equal(use('validateHotspotChanges', input), input)
  assert.deepEqual(use('rankHotspotChanges', input.systems).map(item => item.delta), [4])
  for (const invalid of [current([row(1, 0, 6)]), current([row(1, 6, 5)]),
    { ...input, metric: { kind: 'legacy_unclassified', range_version: null } },
    { ...input, metric: { kind: 'activity_level', range_version: 0 } }]) {
    assert.throws(() => use('validateHotspotChanges', invalid), /变化榜数据无效/)
  }
})
test('incomparable legacy or mixed pair retains its real interval and choices without invented rows', () => {
  const input = { ...current([]), status: 'incomparable', metric: { kind: 'legacy_unclassified', range_version: null },
    coverage: { comparable: 0, new: 0, missing: 0, negative: 0, unchanged: 0 } }
  assert.equal(use('validateHotspotChanges', input), input)
  for (const invalid of [{ ...input, interval: null }, { ...input, systems: [row(1, 1, 2)] },
    { ...input, metric },
    { ...input, coverage: { ...input.coverage, comparable: 1 } }]) {
    assert.throws(() => use('validateHotspotChanges', invalid), /变化榜数据无效/)
  }
})
