import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

async function fixture(fetchImpl) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../../src/services/apiTacticalUsage.js', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'usageApi',
    define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
  })
  const payload = Buffer.from(JSON.stringify({ user_id: 7, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
  const values = new Map([['access_token', `x.${payload}.x`]])
  const window = new EventTarget()
  Object.assign(window, {
    localStorage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) },
    atob, setTimeout, clearTimeout,
  })
  const context = vm.createContext({ window, Event, FormData, AbortController, DOMException, fetch: fetchImpl })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return context.usageApi
}

const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value })

test('capability and overview use authenticated, uncached GET without client identities', async () => {
  const calls = []
  const api = await fixture(async (url, options) => { calls.push({ url, options }); return response({ can_view_usage: true }) })
  const signal = new AbortController().signal
  await api.getTacticalUsageAccess({ signal })
  await api.getTacticalUsageOverview({ signal })
  assert.deepEqual(calls.map(call => call.url), ['http://local-test/api/tactical/usage/access/', 'http://local-test/api/tactical/usage/overview/'])
  for (const { options } of calls) {
    assert.equal(options.method, 'GET')
    assert.equal(options.cache, 'no-store')
    assert.match(options.headers.Authorization, /^Bearer /)
    assert.equal(options.body, undefined)
    assert.equal(options.signal, signal)
  }
})

test('only the server capability controls access; false is preserved', async () => {
  const api = await fixture(async () => response({ can_view_usage: false }))
  assert.equal((await api.getTacticalUsageAccess()).can_view_usage, false)
})

test('overview preserves aggregate zero and time-range values', async () => {
  const data = { totals: { creator_users: 0 }, periods: [{ key: 'today', operation_users: 0 }], first_operation_at: null }
  const api = await fixture(async () => response(data))
  assert.deepEqual(await api.getTacticalUsageOverview(), data)
})

test('permission and network errors are not converted to empty statistics', async () => {
  const api = await fixture(async () => response({ detail: '无权访问此页面。' }, 403))
  await assert.rejects(api.getTacticalUsageOverview(), error => error.status === 403 && /无权/.test(error.message))
  const failed = await fixture(async () => { throw new Error('offline') })
  await assert.rejects(failed.getTacticalUsageOverview(), /offline/)
})

test('unreadable server failures retain their status without leaking response HTML', async () => {
  const api = await fixture(async () => ({ ok: false, status: 502, json: async () => { throw new SyntaxError('upstream HTML') } }))
  await assert.rejects(api.getTacticalUsageOverview(), error => error.status === 502 && !error.message.includes('HTML'))
})

test('cancelled requests propagate the abort rather than showing zero', async () => {
  const api = await fixture(async () => { throw new DOMException('cancelled', 'AbortError') })
  await assert.rejects(api.getTacticalUsageOverview(), error => error.name === 'AbortError')
})
