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

test('production viewer gate stays closed for missing, legacy and invalid public switches', async () => {
  for (const value of [undefined, '', 'invalid', 'false', '0']) {
    const access = await policy({ PROD: true, VITE_VIEWER_ALLOWLIST_ENABLED: 'false', VITE_VIEWER_PUBLIC_ACCESS_ENABLED: value })
    assert.equal(access.VIEWER_ACCESS_ENABLED, true, String(value))
    assert.equal(access.isViewerAllowed('other@example.com'), false)
    assert.equal(access.isViewerAllowed(' 2235102484@QQ.COM '), true)
  }
})

test('only an explicit public switch opens production; local previews stay open', async () => {
  for (const env of [{ PROD: true, VITE_VIEWER_PUBLIC_ACCESS_ENABLED: 'true' }, { PROD: false }]) {
    const access = await policy(env)
    assert.equal(access.VIEWER_ACCESS_ENABLED, false)
    assert.equal(access.isViewerAllowed('other@example.com'), true)
  }
})
