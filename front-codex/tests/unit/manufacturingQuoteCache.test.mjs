import test from 'node:test'
import assert from 'node:assert/strict'
import { manufacturingQuoteIdsDue, mergeManufacturingQuoteSnapshots, MANUFACTURING_QUOTE_CACHE_TTL_MS } from '../../src/utils/manufacturingQuoteCache.js'

const now = Date.parse('2026-10-04T10:00:00Z')
const quote = (time, price = '1200', status = 'fresh') => ({ observed_at: time, best_sell: price, status })

test('cache TTL is independent of observation age and exact due boundary', () => {
  const checks = { a: now, b: now - MANUFACTURING_QUOTE_CACHE_TTL_MS + 1, c: now - MANUFACTURING_QUOTE_CACHE_TTL_MS }
  assert.deepEqual(manufacturingQuoteIdsDue(['a', 'b', 'c', 'd'], checks, now), ['c', 'd'])
  assert.deepEqual(manufacturingQuoteIdsDue(['a'], checks, now + MANUFACTURING_QUOTE_CACHE_TTL_MS), ['a'])
})

test('older per-item snapshots cannot overwrite newer stored values or clear them', () => {
  const latest = quote('2026-10-04T09:30:00Z', '900')
  const other = quote('2026-10-04T09:00:00Z', '800')
  const previous = { a: latest, b: other }
  const merged = mergeManufacturingQuoteSnapshots(previous, { a: quote('2026-10-04T09:00:00Z', null, 'empty'), b: quote('2026-10-04T09:30:00Z', '850') }, now)
  assert.equal(merged.a, latest)
  assert.equal(merged.b.best_sell, '850')
  assert.equal(previous.b, other)
})

test('successful newer empty or invalid sell replaces an old usable price without historical fallback', () => {
  for (const price of [null, 'oops', '-10', '0']) {
    const replacement = quote('2026-10-04T09:30:00Z', price, 'empty')
    assert.equal(mergeManufacturingQuoteSnapshots({ a: quote('2026-10-04T09:00:00Z') }, { a: replacement }, now).a, replacement)
  }
})

test('unknown observation time does not manufacture an ordering guarantee', () => {
  const unknown = quote(null, null, 'uncollected')
  assert.equal(mergeManufacturingQuoteSnapshots({ a: quote('2026-10-04T09:00:00Z') }, { a: unknown }, now).a, unknown)
  const current = quote('2026-10-04T09:30:00Z', '50')
  assert.equal(mergeManufacturingQuoteSnapshots({ a: quote('2026-10-04T11:00:00Z') }, { a: current }, now).a, current)
})
