import test from 'node:test'
import assert from 'node:assert/strict'
import { collectionLabel, marketQualityCounts, qualityAge, qualityCoverage, qualityRefetchInterval, qualityNow } from '../../src/utils/marketQuality.js'

const now = Date.parse('2026-10-04T18:00:00Z')

test('quality polling preserves API headroom, hidden-tab pause and failure backoff', () => {
  assert.equal(qualityRefetchInterval({}, 'visible'), 300000)
  assert.equal(qualityRefetchInterval({}, 'hidden'), false)
  assert.equal(qualityRefetchInterval({ state: { fetchFailureCount: 3 } }, 'visible'), 900000)
})

test('cached quality ages monotonically across wall clock rollback and a component remount', () => {
  const cached = { generated_at: new Date(now).toISOString(), client_read_monotonic_ms: 100 }
  assert.equal(qualityNow(cached, 30100, now - 3600000), now + 30000)
  assert.equal(qualityNow(cached, 60100, now - 7200000), now + 60000)
})
const observation = (age, has_sell, has_buy) => ({ observed_at: new Date(now - age).toISOString(), has_sell, has_buy })
const data = {
  counts: { enabled: 6 }, stale_after_seconds: 7200,
  observations: [observation(0, true, true), observation(7200000, true, false), observation(7200001, true, true), observation(0, false, true), observation(7200001, false, false), { observed_at: null, has_sell: false, has_buy: false }],
}

test('quality keeps fresh boundary, old sells, missing sells, empty books and uncollected separate', () => {
  assert.deepEqual(marketQualityCounts(data, now), {
    enabled: 6, observed: 5, uncollected: 1, fresh_sell: 2, stale_sell: 1,
    stale_observed: 2, missing_sell: 2, empty_book: 1,
  })
  assert.equal(marketQualityCounts(data, now + 30000).fresh_sell, 1)
  assert.equal(marketQualityCounts(data, now + 30000).stale_sell, 2)
})

test('a missing or empty denominator cannot advertise 0% coverage', () => {
  assert.equal(marketQualityCounts(undefined), null)
  assert.equal(qualityCoverage(0, 0), '暂无采集商品')
  assert.equal(qualityCoverage(2, 6), '33.3%')
})

test('unknown collection states never render server diagnostic text', () => {
  assert.equal(collectionLabel('recovered'), '采集已恢复')
  assert.equal(collectionLabel('failed'), '最近采集失败')
  assert.equal(collectionLabel('/private/session-account.json'), '采集状态未知')
})

test('record ages are explicit and a future observation has no negative age', () => {
  assert.equal(qualityAge(null, now), '尚无成功采集')
  assert.equal(qualityAge('invalid', now), '尚无成功采集')
  assert.equal(qualityAge(new Date(now + 60000).toISOString(), now), '刚刚')
  assert.equal(qualityAge(new Date(now - 7260000).toISOString(), now), '2 小时 1 分钟前')
})
