import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import sharp from 'sharp'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const approvedIds = [
  '28007000000',
  '42002000012', '42002000013', '42002000014', '42002000015',
  '42002000016', '42002000017', '42002000019',
  '42001000000', '42001000001', '42001000002', '42001000003',
  '42001000004', '42001000005', '42001000006', '42001000007',
  '42001000008', '42001000009', '42001000010', '42001000011',
  '42001000018', '42001000019', '42001000020', '42001000021',
  '42001000022', '42001000023', '42001000024', '42001000025',
  '42001000026', '42001000027', '42001000028', '42001000029',
  '42001000030', '42001000031', '42001000032', '42001000033',
  '42001000034', '42001000035',
  '41000000000', '41000000002', '41000000003', '41000000004',
  '41000000005', '41000000006', '41000000007', '41000000008',
  '41000000100', '41000000102',
]

const iconsDirectory = new URL('../../public/images/market-items/', import.meta.url)
const moduleUrl = new URL('../../src/utils/marketItemIcons.js', import.meta.url)
const componentPath = fileURLToPath(new URL('../../src/components/MarketItemIcon.jsx', import.meta.url))
const require = createRequire(import.meta.url)
let componentPromise

async function loadIcons() {
  assert.ok(existsSync(moduleUrl), 'The approved market icon lookup must exist')
  return import(moduleUrl.href)
}

async function loadComponent() {
  assert.ok(existsSync(componentPath), 'The reusable market icon component must exist')
  componentPromise ||= build({
    entryPoints: [componentPath], bundle: true, write: false, platform: 'node',
    format: 'cjs', packages: 'external', jsx: 'automatic',
  }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    return module.exports.default
  })
  return componentPromise
}

function assetFiles() {
  assert.ok(existsSync(iconsDirectory), 'The approved market icon assets must exist')
  return readdirSync(iconsDirectory).filter(name => name.endsWith('.webp')).sort()
}

test('known numeric and string item IDs resolve to the same stable asset path', async () => {
  const { getMarketItemIcon } = await loadIcons()
  for (const id of approvedIds) {
    assert.equal(getMarketItemIcon(id), `/images/market-items/${id}.webp`)
    assert.equal(getMarketItemIcon(Number(id)), `/images/market-items/${id}.webp`)
  }
})

test('unknown and malformed IDs never produce an icon URL', async () => {
  const { getMarketItemIcon } = await loadIcons()
  const invalidIds = [
    null, undefined, '', ' ', 0, -1, 1, 99999999999, '99999999999',
    NaN, Infinity, 28007000000.5, true, false, {}, [], ['28007000000'],
    ' 28007000000', '28007000000 ', '028007000000', '+28007000000',
    '28007000000.0', '2.8007e10', '../28007000000', '28007000000.webp',
    'constructor', '__proto__', Number.MAX_SAFE_INTEGER + 1, 28007000000n,
  ]
  for (const id of invalidIds) {
    assert.equal(getMarketItemIcon(id), null, `Invalid ID: ${String(id)}`)
  }
})

test('the exported icon registry contains exactly the 48 approved immutable IDs', async () => {
  const { MARKET_ITEM_ICON_IDS } = await loadIcons()
  assert.ok(Object.isFrozen(MARKET_ITEM_ICON_IDS))
  assert.equal(new Set(MARKET_ITEM_ICON_IDS).size, 48)
  assert.deepEqual([...MARKET_ITEM_ICON_IDS].sort(), [...approvedIds].sort())
})

test('all 48 shipped files agree exactly with the icon mapping', async () => {
  const { MARKET_ITEM_ICON_IDS, getMarketItemIcon } = await loadIcons()
  const filenames = assetFiles()
  assert.equal(filenames.length, 48)
  assert.deepEqual(filenames, MARKET_ITEM_ICON_IDS.map(id => `${id}.webp`).sort())
  for (const filename of filenames) {
    assert.equal(getMarketItemIcon(filename.slice(0, -5)), `/images/market-items/${filename}`)
  }
})

test('each approved icon is a 128 by 128 WebP image', async () => {
  for (const filename of assetFiles()) {
    const metadata = await sharp(fileURLToPath(new URL(filename, iconsDirectory))).metadata()
    assert.equal(metadata.format, 'webp', filename)
    assert.equal(metadata.width, 128, filename)
    assert.equal(metadata.height, 128, filename)
  }
})

test('the complete icon payload remains below 800 KB', () => {
  const bytes = assetFiles().reduce((total, filename) => total + statSync(new URL(filename, iconsDirectory)).size, 0)
  assert.ok(bytes > 0 && bytes < 800_000, `Actual payload: ${bytes} bytes`)
})

test('published provenance excludes private paths and original screenshot copies', () => {
  const filenames = assetFiles()
  const readme = new URL('README.md', iconsDirectory)
  assert.ok(existsSync(readme), 'Public icons need provenance documentation')
  const provenance = readFileSync(readme, 'utf8')
  assert.match(provenance, /user-provided/i)
  assert.match(provenance, /no generative/i)
  assert.doesNotMatch(provenance, /[A-Z]:[\\/]|\/Users\/|\/home\/|codex-clipboard-/i)
  assert.deepEqual(readdirSync(iconsDirectory).sort(), ['README.md', ...filenames].sort())
})

test('known icons render decorative lazy images with reserved square dimensions', async () => {
  const MarketItemIcon = await loadComponent()
  const markup = renderToStaticMarkup(React.createElement(MarketItemIcon, { itemId: 28007000000 }))
  assert.match(markup, /class="market-item-icon"/)
  assert.match(markup, /style="[^"]*width:40px;[^"]*height:40px/)
  assert.match(markup, /class="market-item-icon-image"/)
  assert.match(markup, /src="\/images\/game-items\/[a-f0-9]{64}\.png"/)
  assert.match(markup, /alt=""/)
  assert.match(markup, /width="40"/)
  assert.match(markup, /height="40"/)
  assert.match(markup, /loading="lazy"/)
  assert.match(markup, /decoding="async"/)
})

test('icon callers can provide a size and an additional outer class', async () => {
  const MarketItemIcon = await loadComponent()
  const markup = renderToStaticMarkup(React.createElement(MarketItemIcon, {
    itemId: '41000000000', size: 56, className: 'market-hero-icon',
  }))
  assert.match(markup, /class="market-item-icon market-hero-icon"/)
  assert.match(markup, /width="56"/)
  assert.match(markup, /height="56"/)
})

test('unknown icons render a decorative library fallback without a broken image', async () => {
  const MarketItemIcon = await loadComponent()
  const markup = renderToStaticMarkup(React.createElement(MarketItemIcon, { itemId: 'unknown' }))
  assert.doesNotMatch(markup, /<img\b/)
  assert.match(markup, /<svg\b/)
  assert.match(markup, /lucide-package/)
  assert.match(markup, /aria-hidden="true"/)
  assert.match(markup, /market-item-icon-fallback/)
})

test('market icon consumes API image metadata from the whole item', async () => {
  const MarketItemIcon = await loadComponent()
  const markup = renderToStaticMarkup(React.createElement(MarketItemIcon, {
    item: { item_id: '28007000000', image_url: '/images/game-data/current.png' },
  }))
  assert.match(markup, /src="\/images\/game-data\/current.png"/)
  assert.doesNotMatch(markup, /market-items\/28007000000/)
})
