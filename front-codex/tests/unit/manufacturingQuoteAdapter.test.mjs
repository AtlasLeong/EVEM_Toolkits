import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../src/services/apiManufacturing.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'manufacturingApi',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
})

function fixture() {
  const context = vm.createContext({
    URLSearchParams,
    AbortController,
    DOMException,
    fetch,
  })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return context.manufacturingApi
}

test('chunks unique numeric item IDs into requests no larger than the 50-ID batch limit', () => {
  const api = fixture()
  const ids = Array.from({ length: 201 }, (_, index) => String(index + 1))
  ids.push('1', 2)

  assert.deepEqual(JSON.parse(JSON.stringify(api.chunkItemIds(ids))), [
    ids.slice(0, 50),
    ids.slice(50, 100),
    ids.slice(100, 150),
    ids.slice(150, 200),
    ids.slice(200, 201),
  ])
})

test('normalizes item IDs as strings and preserves quote states, including absent items', () => {
  const api = fixture()
  const normalized = api.normalizeManufacturingQuotes({
    results: [
      { item_id: 101, status: 'fresh', best_sell: '1.25' },
      { item_id: '102', status: 'stale', best_sell: '2.50' },
      { item_id: 103, status: 'empty', best_sell: null },
      { item_id: 104, status: 'uncollected', best_sell: null },
    ],
  }, ['101', 102, '103', '104', '105'])

  assert.equal(normalized['101'].item_id, '101')
  assert.equal(normalized['101'].status, 'fresh')
  assert.equal(normalized['102'].status, 'stale')
  assert.equal(normalized['103'].status, 'empty')
  assert.equal(normalized['104'].status, 'uncollected')
  assert.deepEqual(JSON.parse(JSON.stringify(normalized['105'])), { item_id: '105', status: 'absent' })
})

test('fetches exact IDs in bounded batches without anonymous credentials or per-item fallback', async () => {
  const api = fixture()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const parsed = new URL(url)
    const ids = parsed.searchParams.get('ids').split(',')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        count: ids.length,
        results: ids.map(item_id => ({ item_id, status: 'fresh', best_sell: '10.00' })),
      }),
    }
  }

  const quotes = await api.fetchManufacturingQuotes(
    Array.from({ length: 101 }, (_, index) => index + 1),
    { fetchImpl },
  )

  assert.equal(calls.length, 3)
  assert.equal(new URL(calls[0].url).pathname, '/api/market/quotes/')
  assert.deepEqual([...new URL(calls[0].url).searchParams.keys()], ['ids'])
  assert.equal(new URL(calls[0].url).searchParams.get('ids'), Array.from({ length: 50 }, (_, i) => i + 1).join(','))
  assert.equal(new URL(calls.at(-1).url).searchParams.get('ids'), '101')
  assert.equal(calls[0].options.credentials, undefined)
  assert.equal(calls[0].options.headers, undefined)
  assert.equal(quotes['1'].status, 'fresh')
  assert.equal(quotes['101'].best_sell, '10.00')
})

test('48 manufacture leaves make one request while preserving absent rows, exact decimal strings and metadata', async () => {
  const api = fixture()
  const calls = []
  const ids = Array.from({ length: 48 }, (_, index) => String(index + 1))
  const result = await api.fetchManufacturingQuotes([...ids, '1'], { fetchImpl: async url => {
    calls.push(url)
    return { ok: true, json: async () => ({ results: [
      { item_id: '1', status: 'stale', best_sell: '9007199254740993.125', sell_prices: ['9007199254740993.125'], observed_at: '2020-01-01T00:00:00Z', image_url: '/exact.png' },
      { item_id: '2', status: 'empty', best_sell: null, observed_at: '2020-01-01T00:00:00Z' },
      { item_id: '3', status: 'uncollected', best_sell: null, observed_at: null },
    ] }) }
  } })
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0]).searchParams.get('ids'), ids.join(','))
  assert.equal(Object.keys(result).length, 48)
  assert.equal(result['1'].best_sell, '9007199254740993.125')
  assert.equal(result['1'].sell_prices[0], '9007199254740993.125')
  assert.equal(result['1'].image_url, '/exact.png')
  assert.equal(result['1'].status, 'stale')
  assert.equal(result['2'].status, 'empty')
  assert.equal(result['3'].status, 'uncollected')
  assert.equal(result['48'].status, 'absent')
})

test('skips invalid or overflowing IDs before constructing the bounded request', async () => {
  const api = fixture()
  const calls = []
  await api.fetchManufacturingQuotes(['0', '-1', '01', '１', '1.0', '9223372036854775808', '9223372036854775807'], { fetchImpl: async url => {
    calls.push(url)
    return { ok: true, json: async () => ({ results: [] }) }
  } })
  assert.equal(calls.length, 1)
  assert.equal(new URL(calls[0]).searchParams.get('ids'), '9223372036854775807')
})

test('does not turn an invalid successful JSON response into an absent quote', async () => {
  const api = fixture()
  await assert.rejects(
    api.fetchManufacturingQuotes(['101'], {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        json: async () => { throw new SyntaxError('invalid json') },
      }),
    }),
    error => error?.name === 'ManufacturingMarketError' && error?.code === 'invalid_json',
  )
})

test('surfaces network failures as transport errors instead of absent quotes', async () => {
  const api = fixture()
  await assert.rejects(
    api.fetchManufacturingQuotes(['101'], {
      fetchImpl: async () => { throw new Error('connection reset') },
    }),
    error => error?.name === 'ManufacturingMarketError' && error?.code === 'transport_error',
  )
})

test('normalizes expired snapshots and observed time aliases without fabricating a timestamp', () => {
  const api = fixture()
  const normalized = api.normalizeManufacturingQuotes({ results: [
    { item_id: 1, status: 'expired', best_sell: '12', observedAt: '2020-10-04T18:00:00+08:00' },
    { item_id: 2, status: 'fresh', best_sell: '13', observed_at: 'invalid date' },
  ] }, ['1', '2'])
  assert.equal(normalized['1'].status, 'stale')
  assert.equal(normalized['1'].observed_at, '2020-10-04T10:00:00.000Z')
  assert.equal(normalized['2'].observed_at, null)
})

test('invalid calendar dates and ambiguous timestamp strings cannot become credible observations', () => {
  const api = fixture()
  for (const observed_at of ['0', '2026-02-30T10:00:00Z', '2026-10-04 10:00:00', 'not a date']) {
    const row = api.normalizeManufacturingQuotes([{ item_id: '1', status: 'fresh', best_sell: '12', observed_at }], ['1'])['1']
    assert.equal(row.observed_at, null)
    assert.equal(row.best_sell, '12')
  }
  const invalid = api.normalizeManufacturingQuotes([{ item_id: '1', status: 'invalid', best_sell: 'oops' }], ['1'])['1']
  assert.equal(invalid.status, 'invalid')
  const conflict = api.normalizeManufacturingQuotes([{ item_id: '1', status: 'fresh', best_sell: '12', observed_at: '2026-02-30T10:00:00Z', observedAt: '2020-01-01T00:00:00Z' }], ['1'])['1']
  assert.equal(conflict.observed_at, null)
  assert.equal(conflict.observedAt, null)
})

test('default quote transport never exceeds eight simultaneous stored-snapshot reads', async () => {
  const api = fixture()
  let active = 0
  let peak = 0
  const urls = []
  const result = await api.fetchManufacturingQuotes(Array.from({ length: 451 }, (_, i) => i + 1), { fetchImpl: async url => {
    urls.push(url)
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 1))
    active -= 1
    return { ok: true, json: async () => ({ results: new URL(url).searchParams.get('ids').split(',').map(item_id => ({ item_id, status: 'fresh', best_sell: '1' })) }) }
  } })
  assert.equal(Object.keys(result).length, 451)
  assert.equal(peak, 8)
  assert.equal(urls.length, 10)
  assert.ok(urls.every(url => new URL(url).pathname === '/api/market/quotes/' && new URL(url).searchParams.get('ids').split(',').length <= 50))
  assert.ok(urls.every(url => !/[?&](?:force|refresh|collect)=/u.test(url)))
})

test('aborting a superseded plan stops scheduling remaining items and rejects late JSON', async () => {
  const api = fixture()
  const controller = new AbortController()
  const calls = []
  await assert.rejects(api.fetchManufacturingQuotes(Array.from({ length: 101 }, (_, i) => i + 1), {
    signal: controller.signal, concurrency: 1,
    fetchImpl: async url => {
      calls.push(url)
      return { ok: true, json: async () => { controller.abort(); return { results: [] } } }
    },
  }), error => error.name === 'AbortError')
  assert.equal(calls.length, 1)
})

test('one failed batch aborts sibling reads and never falls back or schedules remaining batches without aborting the caller', async () => {
  const api = fixture()
  const parent = new AbortController()
  const calls = []
  let releaseSibling
  let siblingSignal
  const deferred = new Promise(resolve => { releaseSibling = resolve })
  const ids = Array.from({ length: 151 }, (_, i) => i + 1)
  await assert.rejects(api.fetchManufacturingQuotes(ids, {
    signal: parent.signal, concurrency: 2,
    fetchImpl: async (url, options) => {
      const id = new URL(url).searchParams.get('ids').split(',')[0]
      calls.push(id)
      if (id === '1') return { ok: false, status: 503, json: async () => ({ detail: 'stored snapshot unavailable' }) }
      siblingSignal = options.signal
      await deferred
      return { ok: true, json: async () => ({ results: [{ item_id: id, best_sell: '12', status: 'fresh' }] }) }
    },
  }), error => error.name === 'ManufacturingMarketError' && error.status === 503)
  assert.equal(parent.signal.aborted, false)
  assert.equal(siblingSignal.aborted, true)
  assert.deepEqual(calls, ['1', '51'])
  releaseSibling()
  await new Promise(resolve => setTimeout(resolve, 0))
  assert.deepEqual(calls, ['1', '51'])
  // A native sibling AbortError must not win the aggregate error race and
  // hide the actual HTTP failure from the page's refresh status.
  await assert.rejects(api.fetchManufacturingQuotes(ids, {
    concurrency: 2,
    fetchImpl: async (url, options) => {
      if (new URL(url).searchParams.get('ids').split(',')[0] === '1') return { ok: false, status: 503, json: async () => ({}) }
      await new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('sibling cancelled', 'AbortError')), { once: true }))
      return { ok: true, json: async () => ({ results: [] }) }
    },
  }), error => error.name === 'ManufacturingMarketError' && error.status === 503)
})

test('a target cancellation reaches every active child request and never schedules remaining IDs', async () => {
  const api = fixture()
  const parent = new AbortController()
  const signals = []
  const calls = []
  let release
  const deferred = new Promise(resolve => { release = resolve })
  const pending = api.fetchManufacturingQuotes(Array.from({ length: 151 }, (_, i) => i + 1), {
    signal: parent.signal, concurrency: 2,
    fetchImpl: async (url, options) => {
      calls.push(new URL(url).searchParams.get('ids').split(',')[0])
      signals.push(options.signal)
      await deferred
      return { ok: true, json: async () => ({ results: [] }) }
    },
  })
  parent.abort()
  assert.equal(signals.length, 2)
  assert.ok(signals.every(signal => signal.aborted))
  release()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.deepEqual(calls, ['1', '51'])
})

