import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
const entry = fileURLToPath(new URL('../../src/services/apiControlCenter.js', import.meta.url))
const compiled = existsSync(entry) ? await build({ entryPoints: [entry], bundle: true, write: false, format: 'iife', globalName: 'api',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) } }) : null
function fixture(fetchImpl) {
  const window = new EventTarget()
  window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  class CustomEvent extends Event { constructor(type, options) { super(type); this.detail = options.detail } }
  const context = vm.createContext({ window, Event, CustomEvent, AbortController, DOMException, FormData, URLSearchParams, fetch: fetchImpl })
  if (compiled) vm.runInContext(compiled.outputFiles[0].text, context)
  return context.api || {}
}
test('capabilities are strict booleans read with no-store and cancellation', async () => {
  const calls = [], signal = new AbortController().signal
  const api = fixture(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => ({ can_manage: false, can_view_hotspot_changes: true }) } })
  assert.equal(typeof api.getControlCenterAccess, 'function')
  assert.equal((await api.getControlCenterAccess({ signal })).can_view_hotspot_changes, true)
  assert.equal(calls[0].url, 'http://local-test/api/control-center/access/')
  assert.equal(calls[0].options.cache, 'no-store')
  assert.equal(calls[0].options.signal, signal)
  for (const data of [{ can_manage: 'true', can_view_hotspot_changes: true }, { can_manage: true }]) {
    const invalid = fixture(async () => ({ ok: true, json: async () => data }))
    await assert.rejects(invalid.getControlCenterAccess(), /权限数据无效/)
  }
})
test('private API keeps status codes but never surfaces raw server errors', async () => {
  const api = fixture(async () => ({ ok: false, status: 403, json: async () => ({ detail: 'raw secret error' }) }))
  assert.equal(typeof api.getHotspotChanges, 'function')
  await assert.rejects(api.getHotspotChanges(), error => error.status === 403 && !error.message.includes('secret'))
})
test('exact search escapes input and grant writes use optimistic version with bounded reason', async () => {
  const calls = []
  const user = { id: 3, username: 'name', email: 'name@example.com', grant: { enabled: true, version: 2 } }
  const api = fixture(async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => url.includes('/users/') ? { results: [user] } : user } })
  assert.equal(typeof api.searchControlUsers, 'function')
  await api.searchControlUsers('a+b@example.com')
  await api.updateHotspotGrant(3, { enabled: false, version: 2, reason: '取消查看' })
  assert.match(calls[0].url, /q=a%2Bb%40example.com/)
  assert.equal(calls[1].options.method, 'PUT')
  assert.deepEqual(JSON.parse(calls[1].options.body), { enabled: false, version: 2, reason: '取消查看' })
  await assert.rejects(api.updateHotspotGrant(3, { enabled: true, version: 2, reason: 'x'.repeat(501) }))
  assert.equal(calls.length, 2)
})

test('overview accepts the backend bounded 200 attempts and rejects excessive history', async () => {
  const data = length => ({ collection: { status: 'ok', collected_at_ms: 1000, last_attempt_at_ms: 1000,
    system_count: 2, history_status: 'baseline', latest_interval: null,
    attempts: Array.from({ length }, () => ({ at_ms: 1000, status: 'ok', system_count: 2 })) }, modules: [] })
  const api = fixture(async () => ({ ok: true, json: async () => data(200) }))
  assert.equal((await api.getControlOverview()).collection.attempts.length, 200)
  const excessive = fixture(async () => ({ ok: true, json: async () => data(201) }))
  await assert.rejects(excessive.getControlOverview(), /管理数据无效/)
})

test('overview rejects malformed attempts rather than rendering arbitrary objects or raw errors', async () => {
  for (const attempt of [{ at_ms: 1000, status: 'raw private error', system_count: 0 },
    { at_ms: 1000, status: 'ok', system_count: 1, session_slot: { private: 'object' } },
    { at_ms: 1000, status: 'ok', system_count: 1, rpc_count: 100000 }]) {
    const api = fixture(async () => ({ ok: true, json: async () => ({ collection: { status: 'ok', collected_at_ms: 1000,
      last_attempt_at_ms: 1000, system_count: 1, history_status: 'ok', latest_interval: null, attempts: [attempt] }, modules: [] }) }))
    await assert.rejects(api.getControlOverview(), /管理数据无效/)
  }
})
