import test from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient, QueryObserver } from '@tanstack/react-query'
import { marketBookEmptyLabel, marketReadOptions } from '../../src/utils/marketDataState.js'

for (const nextKey of [['market-series', '1002', 1], ['market-series', '1001', 7], ['market-items', '', 'minerals', 1]]) {
  test(`a pending ${JSON.stringify(nextKey)} cannot inherit another key's data`, async () => {
    const client = new QueryClient()
    const initialKey = nextKey[0] === 'market-items' ? ['market-items', '', null, 1] : ['market-series', '1001', 1]
    const initial = { points: [{ best_sell: '130' }], stats: { sell: { current: { value: '130' } } }, change: { best_sell: { absolute: '10' } }, market_scope: { label: '旧范围' } }
    client.setQueryData(initialKey, initial)
    const observer = new QueryObserver(client, { ...marketReadOptions, queryKey: initialKey, queryFn: async () => initial })
    const unsubscribe = observer.subscribe(() => {})
    let release
    const nextData = { points: [{ best_sell: '230' }] }
    const response = new Promise(resolve => { release = resolve })
    try {
      observer.setOptions({ ...marketReadOptions, queryKey: nextKey, queryFn: () => response })
      const pending = observer.getCurrentResult()
      assert.equal(pending.isPending, true)
      assert.equal(pending.isFetching, true)
      assert.equal(pending.data, undefined)
      release(nextData)
      await observer.refetch({ cancelRefetch: false })
      assert.deepEqual(observer.getCurrentResult().data, nextData)
      assert.deepEqual(client.getQueryData(initialKey), initial)
    } finally {
      release(nextData)
      unsubscribe()
      client.clear()
    }
  })
}

test('a failed same-key refresh retains the last successful data and read time', async () => {
  const client = new QueryClient()
  const key = ['market-series', '1001', 1]
  const data = { count: 1, points: [{ best_sell: '130' }] }
  const updatedAt = Date.now()
  client.setQueryData(key, data, { updatedAt })
  const observer = new QueryObserver(client, { ...marketReadOptions, queryKey: key, queryFn: async () => { throw new Error('503') } })
  const unsubscribe = observer.subscribe(() => {})
  try {
    await observer.refetch()
    const failed = observer.getCurrentResult()
    assert.equal(failed.isError, true)
    assert.equal(failed.isRefetchError, true)
    assert.equal(failed.dataUpdatedAt, updatedAt)
    assert.deepEqual(failed.data, data)
    observer.setOptions({ ...marketReadOptions, queryKey: key, queryFn: async () => ({ count: 0, points: [] }) })
    await observer.refetch()
    assert.equal(observer.getCurrentResult().isError, false)
    assert.deepEqual(observer.getCurrentResult().data, { count: 0, points: [] })
  } finally {
    unsubscribe()
    client.clear()
  }
})

test('order book absence distinguishes a confirmed empty side from uncollected and legacy snapshots', () => {
  assert.equal(marketBookEmptyLabel({ observed_at: '2026-10-03T18:00:00Z', best_sell: null }, 'best_sell'), '暂无挂单')
  assert.equal(marketBookEmptyLabel({ observed_at: null, best_sell: null }, 'best_sell'), '尚未采集')
  assert.equal(marketBookEmptyLabel({ observed_at: '2026-10-03T18:00:00Z', status: 'uncollected', best_sell: null }, 'best_sell'), '尚未采集')
  assert.equal(marketBookEmptyLabel({ observed_at: '2026-10-03T18:00:00Z', best_sell: '0' }, 'best_sell'), '未提供多档报价')
  assert.equal(marketBookEmptyLabel({ observed_at: '2026-10-03T18:00:00Z', best_sell: '9999999999999999.99' }, 'best_sell'), '未提供多档报价')
})
