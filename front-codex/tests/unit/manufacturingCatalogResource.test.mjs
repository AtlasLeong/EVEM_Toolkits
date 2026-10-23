import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { QueryClient } from '@tanstack/react-query'
import { manufacturingCatalogQuery } from '../../src/services/manufacturingCatalogResource.js'

const source = JSON.parse(await readFile(new URL('../../public/industry/manufacturing-scope.json', import.meta.url), 'utf8'))

test('catalog query uses HTTP revalidation and shares successful public data between consumers', async () => {
  const calls = []
  const options = manufacturingCatalogQuery(async (url, init) => {
    calls.push({ url, init })
    return { ok: true, json: async () => source }
  })
  const client = new QueryClient()
  try {
    const first = await client.fetchQuery(options)
    const second = await client.fetchQuery(options)
    assert.equal(first, second)
    assert.equal(first.recipes.length, 503)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].url, '/industry/manufacturing-scope.json')
    assert.equal(calls[0].init.cache, 'no-cache')
    assert.ok(calls[0].init.signal instanceof AbortSignal)
    assert.equal(options.staleTime, 3600000)
    assert.equal(options.gcTime, 3600000)
    assert.equal(options.retry, false)
  } finally { client.clear() }
})

test('failed catalog reads are not reused as successful data and can be retried', async () => {
  let calls = 0
  const options = manufacturingCatalogQuery(async () => {
    calls += 1
    return { ok: calls > 1, status: 503, json: async () => source }
  })
  const client = new QueryClient()
  try {
    await assert.rejects(client.fetchQuery(options), /503/)
    assert.equal(client.getQueryData(options.queryKey), undefined)
    const loaded = await client.fetchQuery(options)
    assert.equal(loaded.recipes.length, 503)
    assert.equal(calls, 2)
  } finally { client.clear() }
})

test('catalog cancellation forwards the signal and cannot populate the shared cache after cancellation', async () => {
  let receivedSignal
  let started
  const entered = new Promise(resolve => { started = resolve })
  const options = manufacturingCatalogQuery(async (_, { signal }) => {
    receivedSignal = signal
    started()
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
  })
  const client = new QueryClient()
  try {
    const pending = client.fetchQuery(options)
    const rejected = assert.rejects(pending)
    await entered
    await client.cancelQueries({ queryKey: options.queryKey })
    await rejected
    assert.equal(receivedSignal.aborted, true)
    assert.equal(client.getQueryData(options.queryKey), undefined)
  } finally { client.clear() }
})

test('a new query client revalidates and validates changed catalog contents', async () => {
  let reads = 0
  const options = manufacturingCatalogQuery(async () => {
    reads += 1
    return { ok: true, json: async () => reads === 1 ? source : { ...source, schemaVersion: 999 } }
  })
  const first = new QueryClient()
  const nextDocument = new QueryClient()
  try {
    await first.fetchQuery(options)
    await assert.rejects(nextDocument.fetchQuery(options), /schemaVersion/)
    assert.equal(reads, 2)
    assert.equal(nextDocument.getQueryData(options.queryKey), undefined)
  } finally { first.clear(); nextDocument.clear() }
})
