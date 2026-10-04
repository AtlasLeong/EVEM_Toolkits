import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const compiled = await build({
  stdin: {
    contents: `export { default as fetchWithAuth, hasActiveSession, notifyAuthChanged } from './fetchWithAuth.js';
      export { readValidatedSession } from './validatedSession.js';
      export { getDefaultResourcePriceSetting } from './apiPlanetaryResource.js';
      export { openTacticalStream } from './apiTacticalCollaboration.js';`,
    resolveDir: fileURLToPath(new URL('../../src/services/', import.meta.url)),
  },
  bundle: true, write: false, format: 'iife', globalName: 'api',
  define: { 'import.meta.env': JSON.stringify({ VITE_API_URL: 'http://local-test/api' }) },
})
const jwt = (id, expires = 600, extra = {}) => `x.${Buffer.from(JSON.stringify({ user_id: id, exp: Date.now() / 1000 + expires, userName: `synthetic-${id}`, ...extra })).toString('base64url')}.synthetic`
const changed = error => error?.name === 'AuthSessionChangedError'
const deferred = () => {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}
const response = (body, status = 200) => ({ status, ok: status < 400, json: async () => body })

function fixture(fetchImpl) {
  const values = new Map(), calls = [], window = new EventTarget()
  window.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  window.atob = atob
  window.setTimeout = setTimeout
  window.clearTimeout = clearTimeout
  const context = vm.createContext({ window, Event, FormData, AbortController, DOMException, URL, URLSearchParams,
    fetch: async (url, options) => {
      calls.push({ url, authorized: Object.entries(options?.headers || {}).some(([key, value]) => key.toLowerCase() === 'authorization' && Boolean(value)) })
      if (fetchImpl) return fetchImpl(url, options)
      return url.includes('/planetresourceprice/default') ? response([{ resource_price: 1200 }]) : response({ detail: 'Authentication required' }, 401)
    },
  })
  vm.runInContext(compiled.outputFiles[0].text, context)
  const api = context.api
  const pair = (access, refresh) => {
    values.clear()
    if (access) values.set('access_token', access)
    if (refresh) values.set('refresh_token', refresh)
    api.notifyAuthChanged()
  }
  return { api, values, calls, pair, window }
}

for (const [accessId, refreshId] of [['A', 'B'], ['B', 'A']]) {
  for (const expires of [600, -60]) {
    test(`mixed ${accessId} access (${expires > 0 ? 'valid' : 'expired'}) and ${refreshId} refresh select anonymous default without modifying tokens`, async () => {
      const { api, values, calls, pair } = fixture()
      const access = jwt(accessId, expires), refresh = jwt(refreshId, 3600)
      pair(access, refresh)
      assert.equal(api.hasActiveSession(), false)
      const snapshot = api.readValidatedSession()
      assert.equal(snapshot.identity, 'guest')
      assert.equal(snapshot.mismatchedPair, true)
      assert.equal(snapshot.userInfo, null)
      const result = await api.getDefaultResourcePriceSetting('user')
      assert.equal(result[0].resource_price, 1200)
      assert.deepEqual(calls, [{ url: 'http://local-test/api/planetresourceprice/default', authorized: false }])
      assert.equal(values.get('access_token') === access, true)
      assert.equal(values.get('refresh_token') === refresh, true)
    })
  }
}

for (const headerName of ['Authorization', 'authorization', 'aUtHoRiZaTiOn']) {
  test(`mixed private GET suppresses caller ${headerName}, returns backend denial, and never refreshes another identity`, async () => {
    const { api, calls, pair } = fixture()
    pair(jwt('A'), jwt('B', 3600))
    const res = await api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user', { headers: { [headerName]: 'Bearer synthetic-explicit-credential' } })
    assert.equal(res.status, 401)
    assert.deepEqual(calls, [{ url: 'http://local-test/api/planetresourceprice?resetPrice=user', authorized: false }])
  })
}

for (const kind of ['access-only', 'same-identity-pair']) {
  test(`${kind} still selects authenticated private preset prices`, async () => {
    const { api, calls, pair } = fixture(async () => response([{ resource_price: 910001 }]))
    pair(jwt(11, 600, { jti: 'new-access' }), kind === 'access-only' ? null : jwt('11', 3600, { jti: 'older-refresh' }))
    assert.equal(api.hasActiveSession(), true)
    assert.equal(api.readValidatedSession().identity, 'user:11')
    assert.equal((await api.getDefaultResourcePriceSetting('user'))[0].resource_price, 910001)
    assert.deepEqual(calls, [{ url: 'http://local-test/api/planetresourceprice?resetPrice=user', authorized: true }])
  })
}

test('refresh-only identity retains legitimate same-account refresh and private price access', async () => {
  const { api, calls, pair } = fixture(async url => url.endsWith('/refresh') ? response({ access: jwt('A') }) : response([{ resource_price: 910001 }]))
  pair(null, jwt('A', 3600))
  assert.equal(api.hasActiveSession(), true)
  assert.equal((await api.getDefaultResourcePriceSetting('user'))[0].resource_price, 910001)
  assert.deepEqual(calls, [{ url: 'http://local-test/api/user/token/refresh', authorized: false }, { url: 'http://local-test/api/planetresourceprice?resetPrice=user', authorized: true }])
})

for (const initial of ['access-only', 'paired']) {
  test(`pending ${initial} A response is discarded on transition to mixed guest, including unchanged A refresh marker`, async () => {
    const network = deferred(), started = deferred()
    const { api, values, calls, pair, window } = fixture(async () => { started.resolve(); return network.promise })
    pair(jwt('A'), initial === 'paired' ? jwt('A', 3600) : null)
    const pending = api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user')
    await started.promise
    if (initial === 'paired') values.set('access_token', jwt('B'))
    else values.set('refresh_token', jwt('B', 3600))
    window.dispatchEvent(new Event('storage'))
    assert.equal(api.hasActiveSession(), false)
    network.resolve(response([{ resource_price: 910001 }]))
    await assert.rejects(pending, changed)
    assert.equal(calls.length, 1)
  })
}

test('pending A refresh cannot replace access B during partial token replacement with refresh A unchanged', async () => {
  const refresh = deferred(), started = deferred()
  const { api, values, calls, pair, window } = fixture(async () => { started.resolve(); return refresh.promise })
  pair(jwt('A', -60), jwt('A', 3600))
  const pending = api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user')
  await started.promise
  const accessB = jwt('B')
  values.set('access_token', accessB)
  window.dispatchEvent(new Event('storage'))
  refresh.resolve(response({ access: jwt('A') }))
  await assert.rejects(pending, changed)
  assert.equal(values.get('access_token') === accessB, true)
  assert.equal(api.hasActiveSession(), false)
  assert.deepEqual(calls, [{ url: 'http://local-test/api/user/token/refresh', authorized: false }])
})

test('refresh response for a different explicit identity is not committed or used for private request', async () => {
  const { api, values, calls, pair } = fixture(async () => response({ access: jwt('B') }))
  const oldAccess = jwt('A', -60)
  pair(oldAccess, jwt('A', 3600))
  await assert.rejects(api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user'), changed)
  assert.equal(values.get('access_token') === oldAccess, true)
  assert.deepEqual(calls, [{ url: 'http://local-test/api/user/token/refresh', authorized: false }])
})

test('healthy same-account access rotation keeps stable identity and allows its pending response', async () => {
  const network = deferred(), started = deferred()
  const { api, values, pair } = fixture(async () => { started.resolve(); return network.promise })
  pair(jwt('A', 600, { jti: 'first' }), jwt('A', 3600))
  const identity = api.readValidatedSession().identity
  const pending = api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user')
  await started.promise
  values.set('access_token', jwt('A', 600, { jti: 'rotated' }))
  api.notifyAuthChanged()
  assert.equal(api.readValidatedSession().identity, identity)
  network.resolve(response([{ resource_price: 910001 }]))
  assert.equal((await pending).status, 200)
})

for (const refreshKind of ['malformed', 'unidentified']) {
  test(`unchanged ${refreshKind} refresh cannot hide a known access identity switch from the pending request fence`, async () => {
    for (const status of [200, 401]) {
      const network = deferred(), started = deferred()
      const { api, values, calls, pair, window } = fixture(async () => { started.resolve(); return network.promise })
      const refresh = refreshKind === 'malformed' ? 'synthetic-malformed-refresh' : jwt(undefined, 3600)
      pair(jwt('A'), refresh)
      const pending = api.fetchWithAuth('http://local-test/api/planetresourceprice?resetPrice=user')
      await started.promise
      const accessB = jwt('B')
      values.set('access_token', accessB)
      window.dispatchEvent(new Event('storage'))
      network.resolve(response([{ resource_price: 910001 }], status))
      await assert.rejects(pending, changed)
      assert.equal(api.readValidatedSession().identity, 'user:B')
      assert.equal(values.get('access_token') === accessB, true)
      assert.equal(values.get('refresh_token') === refresh, true)
      assert.equal(calls.length, 1)
    }
  })
}

test('mixed tactical stream is rejected before constructing or authenticating any WebSocket', () => {
  const { api, pair } = fixture()
  pair(jwt('A'), jwt('B', 3600))
  let constructed = 0
  class ClosedSocket { constructor() { constructed++ } }
  assert.throws(() => api.openTacticalStream({ organizationId: 1, connectionId: 'local-only', WebSocketImpl: ClosedSocket }), changed)
  assert.equal(constructed, 0)
})
