import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const componentPath = fileURLToPath(new URL('../../src/components/killboard/KillParticipantRow.jsx', import.meta.url))
const require = createRequire(import.meta.url)
let componentPromise

async function loadComponent() {
  assert.ok(existsSync(componentPath), 'The participant row should render the exact hull name')
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

test('participant row shows player, corporation, exact ship and damage without raw IDs', async () => {
  const Row = await loadComponent()
  const html = renderToStaticMarkup(React.createElement(Row, { row: {
    character_name: '刀功料理', corporation_name: '罗德骑士团',
    ship_type_id: '10500000601', ship_name: '元帅级', damage: 419320, is_top_damage: true,
  } }))
  for (const text of ['刀功料理', '罗德骑士团', '元帅级', '419,320', '最高伤害']) assert.ok(html.includes(text))
  assert.doesNotMatch(html, /10500000601/)
})

test('an unmapped hull keeps readable missing-data text without a guessed image URL', async () => {
  const Row = await loadComponent()
  const html = renderToStaticMarkup(React.createElement(Row, { row: {
    character_name: '测试角色', ship_type_id: '99999999999', damage: 0,
  } }))
  assert.match(html, /舰船名称待补/)
  assert.match(html, /军团资料未返回/)
  assert.match(html, /0 伤害/)
  assert.doesNotMatch(html, /<img/)
})

test('a verified participant hull renders its exact API image URL', async () => {
  const Row = await loadComponent()
  const html = renderToStaticMarkup(React.createElement(Row, { row: {
    character_name: '测试角色', ship_type_id: '10500000601', ship_name: '元帅级',
    ship_image_url: '/images/killboard-items/d72e89a78cdf24fa1e19f1aed0c8a07e.png', damage: 1,
  } }))
  assert.match(html, /src="\/images\/killboard-items\/d72e89a78cdf24fa1e19f1aed0c8a07e\.png"/)
  assert.match(html, /loading="lazy"/)
})
