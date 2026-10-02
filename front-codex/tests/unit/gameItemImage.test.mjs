import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MARKET_ITEM_ICON_IDS } from '../../src/utils/marketItemIcons.js'

const require = createRequire(import.meta.url)
const griffinDigest = 'f85f571fb15bd0ae205db258bd4d85420a5bdb12e0fed10bfeaa0139907bf23c'
const griffinSource = `/images/game-items/${griffinDigest}.png`
const bundleCache = new Map()
function load(relative) {
  if (!bundleCache.has(relative)) bundleCache.set(relative, build({
    entryPoints: [fileURLToPath(new URL(relative, import.meta.url))], bundle: true, write: false,
    platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
  }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    return module.exports
  }))
  return bundleCache.get(relative)
}

test('metadata URLs take precedence over scoped or legacy item images', async () => {
  const { selectGameItemImage } = await load('../../src/utils/gameItemImage.js')
  const item = { item_id: '10100000101', image_url: '/images/api.png', ship_image_url: '/images/ship.png' }
  assert.equal(selectGameItemImage(item, ' /images/explicit.png '), '/images/explicit.png')
  assert.equal(selectGameItemImage(item), '/images/api.png')
  assert.equal(selectGameItemImage({ ...item, image_url: ' ' }), '/images/ship.png')
})

test('exact numeric and string IDs use verified content-addressed shared PNG paths', async () => {
  const { selectGameItemImage } = await load('../../src/utils/gameItemImage.js')
  for (const key of ['item_id', 'type_id', 'ship_type_id']) {
    for (const id of ['10100000101', 10100000101]) assert.equal(selectGameItemImage({ [key]: id }), griffinSource)
  }
})

test('unknown and malformed IDs do not resolve scoped images', async () => {
  const { selectGameItemImage } = await load('../../src/utils/gameItemImage.js')
  for (const id of [null, undefined, true, [], ['10100000101'], {}, 10100000101n, ' 10100000101', '010100000101', 'constructor', '__proto__', Number.MAX_SAFE_INTEGER + 1, 0, -1, 10100000101.1]) {
    assert.equal(selectGameItemImage({ item_id: id }), null, `ID: ${String(id)}`)
  }
  assert.equal(selectGameItemImage({ item_id: '99999999999' }), null)
})

test('explicit mapping compatibility overrides the scoped fallback but not API metadata', async () => {
  const { selectGameItemImage } = await load('../../src/utils/gameItemImage.js')
  const mapping = { schemaVersion: 1, mappings: [{ itemId: '28007000000', iconPath: '/images/client-items/test.png', sourceHash: 'a'.repeat(64), status: 'confirmed' }] }
  assert.equal(selectGameItemImage({ item_id: '28007000000' }, undefined, mapping), '/images/client-items/test.png')
  assert.equal(selectGameItemImage({ item_id: '28007000000', image_url: '/images/api.png' }, undefined, mapping), '/images/api.png')
  assert.equal(selectGameItemImage({ item_id: '28007000000' }, undefined, { schemaVersion: 1, mappings: [] }), '/images/market-items/28007000000.webp')
})

test('the shipped snapshot covers every manufacturing reference and approved market item with valid PNG hashes', () => {
  const snapshot = JSON.parse(readFileSync(new URL('../../src/data/game-item-images.json', import.meta.url), 'utf8'))
  const scope = JSON.parse(readFileSync(new URL('../../public/industry/manufacturing-scope.json', import.meta.url), 'utf8'))
  const manufacturingIds = new Set([...scope.items.map(item => item.itemId), ...scope.recipes.flatMap(recipe => [recipe.productId, ...recipe.materials.map(item => item.itemId)])])
  assert.equal(manufacturingIds.size, 566)
  for (const id of [...manufacturingIds, ...MARKET_ITEM_ICON_IDS]) assert.match(snapshot.items[id], /^[a-f0-9]{64}$/)
  for (const digest of new Set(Object.values(snapshot.items))) {
    const bytes = readFileSync(new URL(`../../public/images/game-items/${digest}.png`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), digest)
  }
})

test('shared images preserve dimensions, non-square proportions, and descriptive alt text', async () => {
  const { default: GameItemImage } = await load('../../src/components/GameItemImage.jsx')
  const markup = renderToStaticMarkup(React.createElement(GameItemImage, { item: { item_id: '10100000101' }, alt: '狮鹫级', width: 40, height: 40 }))
  assert.ok(markup.includes(`src="${griffinSource}"`))
  assert.match(markup, /alt="狮鹫级"/)
  assert.match(markup, /object-fit:contain/)
  assert.match(markup, /width="40"/)
  assert.match(markup, /height="40"/)
  assert.match(markup, /loading="lazy"/)
  assert.match(markup, /decoding="async"/)
})

test('high priority images opt into eager loading and high fetch priority', async () => {
  const { default: GameItemImage } = await load('../../src/components/GameItemImage.jsx')
  const markup = renderToStaticMarkup(React.createElement(GameItemImage, {
    item: { item_id: '10100000101' }, alt: '狮鹫级', width: 40, height: 40, priority: 'high',
  }))
  assert.match(markup, /loading="eager"/)
  assert.match(markup, /fetchpriority="high"/)
})

test('failed loads use the supplied fallback and a different source gets a fresh keyed instance', async () => {
  const { default: GameItemImage } = await load('../../src/components/GameItemImage.jsx')
  const originalUseState = React.useState
  let failed = false
  React.useState = () => [failed, value => { failed = value }]
  try {
    const fallback = React.createElement('span', { className: 'test-fallback' }, 'missing')
    const child = GameItemImage({ src: '/images/first.png', fallback })
    const image = child.type(child.props)
    assert.equal(image.type, 'img')
    image.props.onError()
    assert.equal(child.type(child.props), fallback)
    const next = GameItemImage({ src: '/images/second.png', fallback })
    assert.notEqual(next.key, child.key)
  } finally { React.useState = originalUseState }
})
