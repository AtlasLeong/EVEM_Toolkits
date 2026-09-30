import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { selectGameItemImage } from '../../src/utils/gameItemImage.js'

const require = createRequire(import.meta.url)
const componentPath = fileURLToPath(new URL('../../src/components/GameItemImage.jsx', import.meta.url))

async function loadComponent() {
  const result = await build({ entryPoints: [componentPath], bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic' })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
  return module.exports.default
}

test('API image metadata wins over the approved local crop', () => {
  assert.equal(selectGameItemImage({ item_id: '28007000000', image_url: '/images/game-data/exact.png' }), '/images/game-data/exact.png')
  assert.equal(selectGameItemImage({ ship_type_id: '28007000000', ship_image_url: '/images/game-data/ship.png' }), '/images/game-data/ship.png')
})

test('known local crop is a fallback and unknown items have no invented URL', () => {
  assert.equal(selectGameItemImage({ item_id: '28007000000' }), '/images/market-items/28007000000.webp')
  assert.equal(selectGameItemImage({ type_id: '99999999999' }), null)
  assert.equal(selectGameItemImage(null), null)
})

test('shared image renders lazy source and explicit missing state', async () => {
  const GameItemImage = await loadComponent()
  const image = renderToStaticMarkup(React.createElement(GameItemImage, { src: '/images/exact.png', alt: '舰船', imageClassName: 'sample-image' }))
  assert.match(image, /class="sample-image"/)
  assert.match(image, /src="\/images\/exact.png"/)
  assert.match(image, /alt="舰船"/)
  assert.match(image, /loading="lazy"/)
  const missing = renderToStaticMarkup(React.createElement(GameItemImage, { missingLabel: '图像待补' }))
  assert.doesNotMatch(missing, /<img\b/)
  assert.match(missing, /图像待补/)
})
