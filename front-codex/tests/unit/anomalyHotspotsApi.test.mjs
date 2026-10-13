import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../src/services/apiTacticalBoard.js', import.meta.url))],
  bundle: true, write: false, format: 'iife', globalName: 'mapApi',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
})

function fixture(fetchImpl) {
  const window = new EventTarget()
  window.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} }
  const context = vm.createContext({ window, Event, AbortController, DOMException, FormData, fetch: fetchImpl })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return context.mapApi
}
const data = { version: 1, collected_at_ms: 1_000, last_attempt_at_ms: 1_000,
  status: 'ok', systems: [], statistics_window: null }

test('hotspots read only the stored API snapshot with cancellation through fetchWithAuth', async () => {
  const calls = []
  const api = fixture(async (url, options) => {
    calls.push({ url, options })
    return { ok: true, status: 200, json: async () => data }
  })
  assert.equal(typeof api.getAnomalyHotspots, 'function', 'getAnomalyHotspots is not implemented')
  const signal = new AbortController().signal
  assert.deepEqual(JSON.parse(JSON.stringify(await api.getAnomalyHotspots({ signal }))), data)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://local-test/api/anomaly-hotspots/')
  assert.equal(calls[0].options.signal, signal)
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.equal(calls[0].options.method || 'GET', 'GET')
})

test('HTTP and malformed snapshot failures reject without exposing arbitrary server errors', async () => {
  for (const reply of [
    { ok: false, status: 500, json: async () => ({ error: 'raw private error' }) },
    { ok: true, status: 200, json: async () => ({ ...data, statistics_window: '24h' }) },
  ]) {
    const api = fixture(async () => reply)
    assert.equal(typeof api.getAnomalyHotspots, 'function', 'getAnomalyHotspots is not implemented')
    await assert.rejects(api.getAnomalyHotspots(), /异常热点/)
  }
})

test('a logical unavailable refresh retains prior rows but an initial unavailable stays unavailable', async () => {
  const unavailable = { ...data, collected_at_ms: null, last_attempt_at_ms: null, status: 'unavailable' }
  const previous = { ...data, systems: [{ solar_system_id: 1, destroy_num: 155,
    system_name: '阿尔法', region_id: null, region_name: null }] }
  const api = fixture(async () => ({ ok: true, status: 200, json: async () => unavailable }))
  const retained = await api.getAnomalyHotspots({ previous })
  assert.equal(retained.collected_at_ms, 1_000)
  assert.equal(retained.systems[0].destroy_num, 155)
  assert.equal(retained.status, 'unavailable')
  const initial = await api.getAnomalyHotspots()
  assert.equal(initial.collected_at_ms, null)
  assert.equal(initial.systems.length, 0)
})
