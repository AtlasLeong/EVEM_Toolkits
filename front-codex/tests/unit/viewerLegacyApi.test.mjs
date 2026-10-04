import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

async function fixture(module, env = {}, authenticated = true) {
  const compiled = await build({
    entryPoints: [fileURLToPath(new URL(`../../src/services/${module}.js`, import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'api',
    define: { 'import.meta.env': JSON.stringify({ PROD: true, VITE_API_URL: 'http://local-test/api', VITE_PUBLIC_READ_ACCESS_ENABLED: 'false', ...env }) },
  })
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600, email: '2235102484@qq.com' })).toString('base64url')
  const values = new Map(authenticated ? [['access_token', `x.${payload}.x`]] : [])
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

for (const env of [
  { VITE_PUBLIC_READ_ACCESS_ENABLED: undefined },
  { VITE_PUBLIC_READ_ACCESS_ENABLED: 'true', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'false' },
  { VITE_PUBLIC_READ_ACCESS_ENABLED: 'true', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' },
]) {
  test(`public community reads omit JWT while private calls and private media retain JWT (${JSON.stringify(env)})`, async () => {
    const { api, calls } = await fixture('apiCommunity', env)
    await api.listCorporations({})
    await api.getCorporation(1)
    const publicImage = await api.fetchCommunityImage('/api/community/corporations/1/media/1/', false)
    URL.revokeObjectURL(publicImage)
    assert.equal(calls.length, 3)
    for (const call of calls) assert.equal(call.options?.headers?.Authorization, undefined, call.url)
    calls.length = 0
    await api.getCommunityCapabilities()
    await api.getMyCorporations()
    await api.getCorporationManagement(1)
    await api.listCorporationReviews('claims')
    const privateImage = await api.fetchCommunityImage('/api/community/media/1/private/', true)
    URL.revokeObjectURL(privateImage)
    assert.equal(calls.length, 5)
    for (const call of calls) assert.match(call.options?.headers?.Authorization ?? '', /^Bearer /, call.url)
  })

  test(`public starsea reads omit JWT while drafts, reviews and private media retain JWT (${JSON.stringify(env)})`, async () => {
    const { api, calls } = await fixture('apiStarsea', env)
    await api.listPosts({})
    await api.getPost(1)
    await api.searchShips({})
    const publicImage = await api.fetchImage(1, false)
    URL.revokeObjectURL(publicImage)
    assert.equal(calls.length, 4)
    for (const call of calls) assert.equal(call.options?.headers?.Authorization, undefined, call.url)
    calls.length = 0
    await api.getCapabilities()
    await api.getMine(1)
    await api.getManagement(1)
    await api.listReviews(1)
    const privateImage = await api.fetchImage(1, true)
    URL.revokeObjectURL(privateImage)
    assert.equal(calls.length, 5)
    for (const call of calls) assert.match(call.options?.headers?.Authorization ?? '', /^Bearer /, call.url)
  })
}

test('guest default planet prices use only the public default endpoint for either reset mode', async () => {
  const { api, calls } = await fixture('apiPlanetaryResource', { VITE_PUBLIC_READ_ACCESS_ENABLED: 'true' }, false)
  await api.getDefaultResourcePriceSetting(false)
  await api.getDefaultResourcePriceSetting(true)
  assert.equal(calls.length, 2)
  for (const call of calls) {
    assert.equal(call.url, 'http://local-test/api/planetresourceprice/default')
    assert.equal(call.options?.headers?.Authorization, undefined)
  }
})

test('registered planet-price requests retain personal prices and authenticated saving', async () => {
  const { api, calls } = await fixture('apiPlanetaryResource', { VITE_PUBLIC_READ_ACCESS_ENABLED: 'true' })
  await api.getDefaultResourcePriceSetting(false)
  await api.getDefaultResourcePriceSetting(true)
  await api.saveUserPrePrice({ prePriceElement: [] })
  assert.deepEqual(calls.map(call => call.url), [
    'http://local-test/api/planetresourceprice?resetPrice=false',
    'http://local-test/api/planetresourceprice?resetPrice=true',
    'http://local-test/api/planetresourceprice',
  ])
  assert.equal(calls[2].options.method, 'POST')
  for (const call of calls) assert.match(call.options?.headers?.Authorization ?? '', /^Bearer /, call.url)
})
