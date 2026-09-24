import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  entryPoints: [fileURLToPath(new URL('../../src/services/apiMarket.js', import.meta.url))],
  bundle: true,
  write: false,
  format: 'iife',
  globalName: 'marketApi',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
})

function fixture(fetchImpl, authenticated = false) {
  const values = new Map()
  if (authenticated) {
    const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url')
    values.set('access_token', `x.${payload}.x`)
  }
  const window = new EventTarget()
  window.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
  window.atob = atob
  window.setTimeout = setTimeout
  window.clearTimeout = clearTimeout
  const context = vm.createContext({ window, Event, FormData, AbortController, DOMException, fetch: fetchImpl, URLSearchParams })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return context.marketApi
}

const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value })

test('public search is anonymous and encodes the query', async () => {
  const calls = []
  const api = fixture((url, options) => {
    calls.push({ url, options })
    return Promise.resolve(response({ count: 0, results: [] }))
  })
  await api.listMarketItems({ q: '  测试 舰船  ', page: 2 })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'http://local-test/api/market/items/?q=%E6%B5%8B%E8%AF%95+%E8%88%B0%E8%88%B9&page=2')
  assert.equal(calls[0].options?.headers?.Authorization, undefined)
})

test('admin mutations send bearer auth and JSON to the market endpoint', async () => {
  const calls = []
  const api = fixture((url, options) => {
    calls.push({ url, options })
    return Promise.resolve(response({ enabled: false }))
  }, true)
  await api.updateMarketItem('1001', { enabled: false })
  assert.equal(calls[0].url, 'http://local-test/api/market/admin/items/1001/')
  assert.equal(calls[0].options.method, 'PATCH')
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json')
  assert.match(calls[0].options.headers.Authorization, /^Bearer /)
  assert.equal(calls[0].options.body, '{"enabled":false}')
})

test('admin catalog search sends a trimmed query and page to the server', async () => {
  const calls = []
  const api = fixture((url, options) => {
    calls.push({ url, options })
    return Promise.resolve(response({ count: 0, results: [] }))
  }, true)
  await api.listMarketAdminItems({ q: '  测试 舰船  ', page: 2 })
  assert.equal(calls[0].url, 'http://local-test/api/market/admin/items/?q=%E6%B5%8B%E8%AF%95+%E8%88%B0%E8%88%B9&page=2')
  assert.match(calls[0].options.headers.Authorization, /^Bearer /)
})

test('permission denials retain status so the admin screen can hide controls', async () => {
  const api = fixture(async () => response({ detail: '无权限' }, 403), true)
  await assert.rejects(api.getMarketConfig(), error => error.status === 403 && error.message === '无权限')
})

test('field validation errors remain readable in admin notices', async () => {
  const api = fixture(async () => response({ item_id: ['This item already exists.'] }, 400), true)
  await assert.rejects(api.createMarketItem({ item_id: '1001', name: '重复', scope: 'global' }), error => error.status === 400 && error.message.includes('item_id') && error.message.includes('This item already exists.'))
})

test('history only permits bounded ranges', async () => {
  const api = fixture(async () => response({ results: [] }))
  assert.throws(() => api.getMarketHistory('1001', 365), /历史范围必须是/)
})
