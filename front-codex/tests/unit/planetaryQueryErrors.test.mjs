import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

async function fixture(status, payload) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL('../../src/services/apiPlanetaryResource.js', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'api',
    define: { 'import.meta.env': JSON.stringify({ PROD: true, VITE_API_URL: 'http://local-test/api', VITE_PUBLIC_READ_ACCESS_ENABLED: 'true' }) },
  })
  const window = new EventTarget()
  window.location = { origin: 'http://local-test' }
  window.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }
  const calls = []
  const context = vm.createContext({
    window, Event, AbortController, DOMException, URLSearchParams, URL,
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { ok: status < 400, status, json: async () => payload }
    },
  })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return { api: context.api, calls }
}

test('planetary 400 and 429 guidance reaches the caller without splitting or retrying the query', async () => {
  for (const [status, payload, expected] of [
    [400, { error: '查询结果过多，请缩小地点或资源条件后重试。' }, /请缩小地点/],
    [429, { detail: '请求过于频繁，请稍后重试。' }, /请求过于频繁/],
  ]) {
    const { api, calls } = await fixture(status, payload)
    await assert.rejects(api.searchPlanetResources({ systemValue: [3] }), expected)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.method, 'POST')
  }
})

test('planetary unexpected or non-string error bodies use a safe bounded fallback', async () => {
  for (const payload of [{ error: { internal: 'not a user message' } }, { error: 'x'.repeat(501) }, { error: '<html>upstream debug dump</html>' }]) {
    const { api, calls } = await fixture(400, payload)
    await assert.rejects(api.searchPlanetResources({}), /^Error: 查询失败，请稍后重试。$/)
    assert.equal(calls.length, 1)
  }
})

test('planetary successful reads preserve the existing flat array', async () => {
  const rows = [{ key: 'p1', resource_yield: '100', resource_name: '光泽合金' }]
  const { api } = await fixture(200, rows)
  assert.deepEqual(await api.searchPlanetResources({}), rows)
})
