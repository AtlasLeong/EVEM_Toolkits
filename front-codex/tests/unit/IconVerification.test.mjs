import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const pagePath = fileURLToPath(new URL('../../src/pages/IconVerification.jsx', import.meta.url))
const require = createRequire(import.meta.url)
let modulePromise

async function loadPage() {
  modulePromise ||= build({
    entryPoints: [pagePath], bundle: true, write: false, platform: 'node',
    format: 'cjs', packages: 'external', jsx: 'automatic',
  }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    return module.exports
  })
  return modulePromise
}

const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)
const items = [
  { itemId: '101', name: '阿特龙级', category: 'ship' },
  { itemId: '202', name: '三钛合金', category: 'material' },
]
const candidates = [
  { source: 'ships/atlas.png', sourceHash: hashA, png: 'ships/atlas.png', width: 128, height: 128, format: 'png', thumbnailUrl: `thumbnails/${hashA}.webp` },
  { source: 'ore/titan.png', sourceHash: hashB, png: 'ore/titan.png', width: 96, height: 96, format: 'png', thumbnailUrl: `thumbnails/${hashB}.webp` },
]

test('searches catalog items by display name and internal ID without making ID the primary label', async () => {
  const { filterCatalogItems } = await loadPage()
  assert.deepEqual(filterCatalogItems(items, { query: '阿特' }), [items[0]])
  assert.deepEqual(filterCatalogItems(items, { query: '202' }), [items[1]])
  assert.equal(filterCatalogItems(items, { query: '阿特' })[0].name, '阿特龙级')
})

test('filters candidates by hash, source, format, and dimensions', async () => {
  const { filterCandidates } = await loadPage()
  assert.deepEqual(filterCandidates(candidates, { query: hashB }), [candidates[1]])
  assert.deepEqual(filterCandidates(candidates, { source: 'ships' }), [candidates[0]])
  assert.deepEqual(filterCandidates(candidates, { format: 'png', minDimension: 120 }), [candidates[0]])
})

test('selecting a candidate creates a confirmed binding with a controlled production path', async () => {
  const { createBinding } = await loadPage()
  const result = createBinding({ item: items[0], candidate: candidates[0], now: '2026-09-29T00:00:00.000Z' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.binding, {
    itemId: '101', iconId: null, iconPath: '/images/client-items/101.png',
    sourceHash: hashA, width: 128, height: 128, format: 'png',
    status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z',
  })
})

test('binding warns and refuses silent overwrite when the item or candidate is already bound', async () => {
  const { createBinding } = await loadPage()
  const existing = { '101': { itemId: '101', sourceHash: hashA, status: 'confirmed' } }
  const itemConflict = createBinding({ item: items[0], candidate: candidates[1], existingBindings: existing })
  assert.equal(itemConflict.ok, false)
  assert.equal(itemConflict.reason, 'conflict')
  const candidateConflict = createBinding({ item: items[1], candidate: candidates[0], existingBindings: existing })
  assert.equal(candidateConflict.ok, false)
  assert.equal(candidateConflict.reason, 'conflict')
})

test('revoking a binding preserves a schema-valid revoked record', async () => {
  const { revokeBinding } = await loadPage()
  const revoked = revokeBinding({
    itemId: '101',
    binding: { itemId: '101', iconPath: '/images/client-items/101.png', sourceHash: hashA, width: 128, height: 128, format: 'png', status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z' },
  })
  assert.equal(revoked.status, 'revoked')
  assert.equal(revoked.itemId, '101')
})

test('exports schema-versioned mappings and rejects unsafe candidate URLs', async () => {
  const { buildExportPayload, normalizeCandidateForUi } = await loadPage()
  assert.equal(normalizeCandidateForUi({ ...candidates[0], thumbnailUrl: 'https://evil.test/icon.webp' }), null)
  const payload = buildExportPayload({
    '101': { itemId: '101', iconId: null, iconPath: '/images/client-items/101.png', sourceHash: hashA, width: 128, height: 128, format: 'png', status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z' },
  })
  assert.equal(payload.schemaVersion, 1)
  assert.equal(payload.mappings[0].status, 'confirmed')
  assert.equal(payload.mappings[0].iconPath, '/images/client-items/101.png')
})

test('empty candidate manifests provide an icons:prepare recovery instruction', async () => {
  const { EMPTY_MANIFEST_MESSAGE } = await loadPage()
  assert.match(EMPTY_MANIFEST_MESSAGE, /icons:prepare/)
})

test('normalizes malformed persisted bindings before UI state derives statuses', async () => {
  const { normalizeStoredBindings } = await loadPage()
  const persisted = {
    good: { itemId: '101', iconPath: '/images/client-items/101.png', sourceHash: hashA, width: 128, height: 128, format: 'png', status: 'confirmed', confirmedAt: '2026-09-29T00:00:00.000Z' },
    nullEntry: null,
    arrayEntry: [],
    textEntry: 'bad',
  }
  assert.deepEqual(Object.keys(normalizeStoredBindings(persisted)), ['good'])
  assert.deepEqual(normalizeStoredBindings({ nullEntry: null, arrayEntry: [] }), {})
})

test('catalog categories prefer recipe classifications over generic item entries', async () => {
  const { catalogItemsFromSource } = await loadPage()
  const catalog = catalogItemsFromSource({
    items: [{ itemId: '101', name: '试验舰船' }, { itemId: '202', name: '基础材料' }],
    recipes: [{ productId: '101', name: '试验舰船', category: 'ship', materials: [{ itemId: '202' }] }],
  })
  assert.equal(catalog.find(item => item.itemId === '101').category, 'ship')
  assert.equal(catalog.find(item => item.itemId === '202').category, 'material')
})
