import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { wheelCameraFrame } from '../../src/utils/tacticalMapInteraction.js'

const require = createRequire(import.meta.url)
const bundled = await build({ entryPoints: [fileURLToPath(new URL('../../src/components/tactical/PirateIntelMap.jsx', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', loader: { '.css': 'empty' }, jsx: 'automatic' })
const componentModule = { exports: {} }
new Function('require', 'module', 'exports', bundled.outputFiles[0].text)(require, componentModule, componentModule.exports)
const { default: PirateIntelMap, zoomPirateCamera } = componentModule.exports

for (const selectedSystemId of [12, '12']) test(`a searched non-base star ${typeof selectedSystemId} ID keeps its highlighted name and security label`, () => {
  const systems = Array.from({ length: 201 }, (_, i) => ({ system_id: i + 1, name: `Review ${i + 1}`,
    region_id: 7, security_status: -.17, x: i % 20, z: Math.floor(i / 20) }))
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: { systems, stargates: [], scope: { region_ids: [7] } }, selectedSystemId,
  }))
  assert.match(html, /data-pirate-system="12"/)
  assert.match(html, />Review 12<\/text>/)
  assert.match(html, /class="pirate-map__system-selection-ring"/)
})

test('pirate wheel camera exactly matches shared war-board response for the same normalized delta', () => {
  const view = { x: -33, y: 80, scale: 2 }
  const anchor = { x: 321, y: 456 }
  for (const delta of [-1200, -120, -1, 0, 45, 120, 1200]) {
    assert.deepEqual(zoomPirateCamera(view, anchor, delta), wheelCameraFrame({ view, anchor, delta }).view,
      `wheel delta ${delta} differs between board types`)
  }
})
