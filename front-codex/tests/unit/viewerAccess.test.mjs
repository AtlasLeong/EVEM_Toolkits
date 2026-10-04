import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

async function policy(env) {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('../../src/utils/viewerAccess.js', import.meta.url))],
    bundle: true, write: false, format: 'iife', globalName: 'policy',
    define: { 'import.meta.env': JSON.stringify(env) },
  })
  const context = vm.createContext({})
  vm.runInContext(result.outputFiles[0].text, context)
  return context.policy
}

test('ordinary public reads default open in production and ignore every legacy viewer switch', async () => {
  for (const value of [undefined, '', 'invalid', 'false', '0', 'true', '1']) {
    const access = await policy({ PROD: true, VITE_VIEWER_ALLOWLIST_ENABLED: 'true', VITE_VIEWER_ALLOWLIST_EMAILS: 'owner@example.com', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: value })
    assert.equal(access.PUBLIC_READ_ACCESS_ENABLED, true, String(value))
    assert.equal(access.VIEWER_ACCESS_ENABLED, false)
    assert.equal(access.isViewerAllowed('new-pilot@example.com'), true)
    assert.equal(access.isViewerAllowed('owner@example.com'), true)
  }
})

test('the dedicated public-read switch accepts explicit true values in production and local builds', async () => {
  for (const value of ['true', '1', 'YES', ' on ']) {
    const access = await policy({ PROD: true, VITE_PUBLIC_READ_ACCESS_ENABLED: value })
    assert.equal(access.PUBLIC_READ_ACCESS_ENABLED, true)
    assert.equal(access.VIEWER_ACCESS_ENABLED, false)
    assert.equal(access.isViewerAllowed('other@example.com'), true)
  }
  assert.equal((await policy({ PROD: false })).PUBLIC_READ_ACCESS_ENABLED, true)
})

test('disabled or invalid dedicated switches require read login without reinstating an email whitelist', async () => {
  for (const value of ['false', '0', 'off', '', 'invalid']) {
    const access = await policy({ PROD: true, VITE_PUBLIC_READ_ACCESS_ENABLED: value, VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' })
    assert.equal(access.PUBLIC_READ_ACCESS_ENABLED, false, value)
    assert.equal(access.VIEWER_ACCESS_ENABLED, true)
    assert.equal(access.isViewerAllowed('new-pilot@example.com'), true)
  }
})
