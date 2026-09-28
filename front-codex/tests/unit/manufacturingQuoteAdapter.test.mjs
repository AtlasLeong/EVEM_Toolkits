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

test('chunks unique numeric item IDs into requests no larger than the market page limit', () => {
  const api = fixture()
  const ids = Array.from({ length: 201 }, (_, index) => String(index + 1))
  ids.push('1', 2)

  assert.deepEqual(JSON.parse(JSON.stringify(api.chunkItemIds(ids))), [
    ids.slice(0, 100),
    ids.slice(100, 200),
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

test('fetches each ID through the compatible public q filter without credentials', async () => {
  const api = fixture()
  const calls = []
  const fetchImpl = async (url, options) => {
    calls.push({ url, options })
    const parsed = new URL(url)
    const ids = [parsed.searchParams.get('q')]
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

  assert.equal(calls.length, 101)
  assert.equal(new URL(calls[0].url).searchParams.get('page_size'), '100')
  assert.equal(new URL(calls[0].url).searchParams.get('q'), '1')
  assert.equal(new URL(calls.at(-1).url).searchParams.get('q'), '101')
  assert.equal(calls[0].options.credentials, 'omit')
  assert.equal(calls[0].options.headers, undefined)
  assert.equal(quotes['1'].status, 'fresh')
  assert.equal(quotes['101'].best_sell, '10.00')
})

