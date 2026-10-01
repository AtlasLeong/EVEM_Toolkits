import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../src/services/apiKillboard.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'killboardApi',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
})

function fixture(fetchImpl) {
  const window = new EventTarget()
  window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const context = vm.createContext({ window, Event, AbortController, DOMException, FormData, fetch: fetchImpl, URLSearchParams })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return context.killboardApi
}

test('killboard reports use the authenticated client and encode filters', async () => {
  const calls = []
  const api = fixture((url, options) => {
    calls.push({ url, options })
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ results: [] }) })
  })
  await api.listKillReports({ page: 2, pageSize: 25, q: '  测试 舰船 ', shipClass: 'battleship', signal: new AbortController().signal })
  assert.equal(calls[0].url, 'http://local-test/api/killboard/reports/?page=2&page_size=25&q=%E6%B5%8B%E8%AF%95+%E8%88%B0%E8%88%B9&ship_class=battleship')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
})

test('killboard API exposes access, detail, filters and status routes', async () => {
  const urls = []
  const api = fixture(url => {
    urls.push(url)
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) })
  })
  await api.getKillboardAccess()
  await api.getKillReport('19748417')
  await api.listKillboardFilters()
  await api.getKillboardStatus()
  await api.getKillboardCollectorLogs()
  assert.deepEqual(urls, [
    'http://local-test/api/killboard/access/',
    'http://local-test/api/killboard/reports/19748417/',
    'http://local-test/api/killboard/filters/',
    'http://local-test/api/killboard/status/',
    'http://local-test/api/killboard/collector/logs/',
  ])
})
