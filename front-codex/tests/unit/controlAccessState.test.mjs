import test from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { readFile } from 'node:fs/promises'
const helper = await import('../../src/utils/controlAccessState.js').catch(() => ({}))

test('revocation removes only this identity private queries and completed mutation data', async () => {
  assert.equal(typeof helper.denyControlAccess, 'function')
  const client = new QueryClient()
  client.setQueryData(['control-access', '2'], { can_manage: true, can_view_hotspot_changes: true })
  client.setQueryData(['control-private', '2', 'changes'], { private: 'old' })
  client.setQueryData(['control-private', '3', 'changes'], { private: 'other' })
  client.setQueryData(['market'], { public: true })
  const own = client.getMutationCache().build(client, { mutationKey: ['control-private', '2', 'grant-update'], gcTime: Infinity, mutationFn: async () => ({ email: 'private@example.com' }) })
  const other = client.getMutationCache().build(client, { mutationKey: ['control-private', '3', 'grant-update'], gcTime: Infinity, mutationFn: async () => 'other' })
  const unrelated = client.getMutationCache().build(client, { mutationKey: ['market-save'], gcTime: Infinity, mutationFn: async () => 'market' })
  await Promise.all([own.execute(), other.execute(), unrelated.execute()])
  assert.equal(own.state.data.email, 'private@example.com')
  helper.denyControlAccess(client, '2')
  assert.equal(client.getQueryData(['control-private', '2', 'changes']), undefined)
  assert.deepEqual(client.getQueryData(['control-private', '3', 'changes']), { private: 'other' })
  assert.deepEqual(client.getQueryData(['market']), { public: true })
  assert.deepEqual(client.getMutationCache().getAll(), [other, unrelated])
  assert.equal(client.getQueryData(['control-access', '2']).denied, true)
  client.clear()
})

test('grant mutation belongs to the identity scope and aborts on owner page unmount', async () => {
  const source = await readFile(new URL('../../src/pages/AdminConsole.jsx', import.meta.url), 'utf8')
  assert.match(source, /mutationKey:\s*\[\.\.\.root, 'grant-update'\]/)
  assert.match(source, /useEffect\(\(\) => \(\) => controller\.current\?\.abort\(\), \[\]\)/)
})
