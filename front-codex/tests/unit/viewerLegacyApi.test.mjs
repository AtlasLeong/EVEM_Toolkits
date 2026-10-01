import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

async function fixture(module, env = {}) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(`../../src/services/${module}.js`, import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'api',
    define: { 'import.meta.env': JSON.stringify({ PROD: true, VITE_API_URL: 'http://local-test/api', ...env }) },
  })
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600, email: '2235102484@qq.com' })).toString('base64url')
  const values = new Map([['access_token', `x.${payload}.x`]])
  const window = new EventTarget()
  window.location = { origin: 'http://local-test' }
  window.atob = atob
  window.localStorage = { getItem: key => values.get(key) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
  const calls = []
  const context = vm.createContext({
    window, Event, FormData, AbortController, DOMException, URLSearchParams, URL, Blob,
    fetch: async (url, options) => {
      calls.push({ url, options })
      return { ok: true, status: 200, json: async () => [], headers: new Headers({ 'content-type': 'image/png' }), blob: async () => new Blob(['image']) }
    },
  })
  vm.runInContext(compiled.outputFiles[0].text, context)
  return { api: context.api, calls }
}

for (const [module, invoke] of [
  ['apiTacticalBoard', async api => { await api.getBoardSystems(); await api.getBoardStarGate(); await api.getConstellations(); await api.getRegions() }],
  ['apiStarField', async api => { await api.getRegionList(); await api.getConstellations(1); await api.getSolarSystems(1) }],
  ['apiPlanetaryResource', async api => { await api.getPlanetResources(); await api.searchPlanetResources({}) }],
  ['apiFraudList', api => api.searchFraud('test')],
  ['apiBazaar', api => api.getBazaarNameList()],
  ['apiCommunity', async api => { await api.listCorporations({}); await api.getCommunityRegions(); await api.getCorporation(1) }],
  ['apiStarsea', async api => { await api.listPosts({}); await api.getPost(1); await api.searchShips({}) }],
]) {
  test(`private production ${module} requests carry the viewer JWT`, async () => {
    const { api, calls } = await fixture(module)
    await invoke(api)
    assert.ok(calls.length > 0)
    for (const call of calls) assert.match(call.options?.headers?.Authorization ?? '', /^Bearer /, call.url)
  })
}

test('private production community images use JWT only after same-origin URL validation', async () => {
  const { api, calls } = await fixture('apiCommunity')
  const blobUrl = await api.fetchCommunityImage('/api/community/corporations/1/media/1/', false)
  URL.revokeObjectURL(blobUrl)
  assert.match(calls[0].options?.headers?.Authorization ?? '', /^Bearer /)
  await assert.rejects(api.fetchCommunityImage('https://attacker.invalid/api/community/corporations/1/media/1/'), /图片地址/)
  assert.equal(calls.length, 1)
})
