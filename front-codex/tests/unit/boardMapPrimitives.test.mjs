import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const require = createRequire(import.meta.url)
const entryPoint = fileURLToPath(new URL('../../src/components/tactical/BoardMapPrimitives.jsx', import.meta.url))
let modulePromise
async function loadPrimitives() {
  assert.ok(existsSync(entryPoint), 'Shared board map primitives must exist')
  modulePromise ||= build({
    entryPoints: [entryPoint], bundle: true, write: false, platform: 'node',
    format: 'cjs', packages: 'external', jsx: 'automatic',
  }).then(result => {
    const module = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, module, module.exports)
    return module.exports
  })
  return modulePromise
}

const node = { px: 80, py: 120, security_status: -0.76 }
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props))
function tagAttributes(markup, tag, className) {
  const element = [...markup.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'g'))]
    .map(match => match[0]).find(value => value.includes(`class="${className}"`))
  assert.ok(element, `Expected ${tag}.${className}`)
  return Object.fromEntries([...element.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))
}

test('ordinary star radius stays three screen pixels at every committed zoom', async () => {
  const { BoardStarGlyph } = await loadPrimitives()
  for (const scale of [.5, 1, 2, 8, 16]) {
    const markup = render(BoardStarGlyph, { node, scale })
    const dot = tagAttributes(markup, 'circle', 'tac-star-dot')
    assert.equal(Number(dot.r) * scale, 3)
    assert.equal(dot.fill, '#8ca0a3')
    assert.equal(dot.cx, '80')
    assert.equal(dot.cy, '120')
    assert.doesNotMatch(markup, /tac-star-ring|tac-star-hit/)
  }
})

test('reported and selected stars preserve the war board emphasis and color priority', async () => {
  const { BoardStarGlyph } = await loadPrimitives()
  for (const [selected, reported, radius, ringRadius, color, opacity] of [
    [false, true, 4, 9, '#d49a7e', .4],
    [true, false, 5, 12, '#f0e5c5', .8],
    [true, true, 5, 12, '#d49a7e', .8],
  ]) {
    const scale = 8
    const markup = render(BoardStarGlyph, { node, scale, selected, reported })
    const dot = tagAttributes(markup, 'circle', 'tac-star-dot')
    const ring = tagAttributes(markup, 'circle', 'tac-star-ring')
    assert.equal(Number(dot.r) * scale, radius)
    assert.equal(dot.fill, color)
    assert.equal(Number(ring.r) * scale, ringRadius)
    assert.equal(Number(ring['stroke-width']) * scale, 1)
    assert.equal(Number(ring.opacity), opacity)
    assert.equal(ring.stroke, color)
  }
})

test('related star highlighting and an optional transparent hit target stay independent', async () => {
  const { BoardStarGlyph } = await loadPrimitives()
  const markup = render(BoardStarGlyph, { node, scale: 2, related: true, showHit: true })
  assert.equal(tagAttributes(markup, 'circle', 'tac-star-dot').fill, '#bbc9c4')
  const hit = tagAttributes(markup, 'circle', 'tac-star-hit')
  assert.equal(hit.r, '9.5')
  assert.equal(hit.fill, 'transparent')
  assert.doesNotMatch(markup, /role=|tabindex=|aria-label=/)
})

test('star selector overrides reuse identical neutral geometry', async () => {
  const { BoardStarGlyph } = await loadPrimitives()
  const markup = render(BoardStarGlyph, {
    node, scale: 8, reported: true, dotClassName: 'pirate-map__star', ringClassName: 'pirate-map__ring',
  })
  assert.equal(tagAttributes(markup, 'circle', 'pirate-map__star').r, '0.5')
  assert.equal(tagAttributes(markup, 'circle', 'pirate-map__ring').r, '1.125')
})

test('real gate lines preserve quiet and focused topology styles without scaling thickness', async () => {
  const { BoardGateLine } = await loadPrimitives()
  const a = { px: 12, py: 34 }, b = { px: 56, py: 78 }
  for (const scale of [.5, 1, 8]) {
    const quiet = tagAttributes(render(BoardGateLine, { a, b, scale }), 'line', 'tac-map-gate')
    assert.deepEqual([quiet.x1, quiet.y1, quiet.x2, quiet.y2], ['12', '34', '56', '78'])
    assert.equal(quiet.stroke, '#46565c')
    assert.equal(Number(quiet['stroke-width']) * scale, .65)
    assert.equal(Number(quiet.opacity), Math.max(.3, Math.min(.5, .18 + scale * .12)))
    assert.equal(quiet['pointer-events'], 'none')
    const active = tagAttributes(render(BoardGateLine, { a, b, scale, active: true }), 'line', 'tac-map-gate is-active')
    assert.equal(active.stroke, '#819591')
    assert.equal(Number(active['stroke-width']) * scale, 1.8)
    assert.equal(active.opacity, '0.88')
  }
  assert.equal(render(BoardGateLine, { a }), '')
  assert.equal(render(BoardGateLine, { b }), '')
  assert.ok(render(BoardGateLine, { a, b, className: 'pirate-map__gate' }).includes('class="pirate-map__gate"'))
})

test('system labels center the same readable name and security lines without business wrappers', async () => {
  const { BoardSystemLabel } = await loadPrimitives()
  const label = { x: 30, y: 50, width: 100, height: 36, name: 'V-NL3K' }
  const markup = render(BoardSystemLabel, { label, node })
  for (const [className, y, fontSize, fill] of [
    ['tac-star-name', '64', '13', '#d2dcda'],
    ['tac-star-security', '80', '10', '#d19b91'],
  ]) {
    const text = tagAttributes(markup, 'text', className)
    assert.equal(text.x, '80')
    assert.equal(text.y, y)
    assert.equal(text['text-anchor'], 'middle')
    assert.equal(text['font-size'], fontSize)
    assert.equal(text['font-weight'], '400')
    assert.equal(text.fill, fill)
    assert.equal(text.stroke, '#19252b')
    assert.equal(text['stroke-width'], '4')
    assert.equal(text['paint-order'], 'stroke')
  }
  assert.ok(markup.includes('>V-NL3K</text>'))
  assert.ok(markup.includes('>-0.76</text>'))
  assert.doesNotMatch(markup, /<rect|<g|role=|tabindex=|aria-label=/)
})

test('selected names and gate-aware label backdrops retain the war board treatment', async () => {
  const { BoardSystemLabel } = await loadPrimitives()
  const label = { x: 30, y: 50, width: 100, height: 36, name: 'Alpha', gateBackdrop: true }
  const markup = render(BoardSystemLabel, { label, node, selected: true })
  assert.equal(tagAttributes(markup, 'text', 'tac-star-name').fill, '#f6edda')
  assert.match(markup, /<rect x="32" y="51" width="96" height="34" rx="3" fill="#19252b" opacity="\.92" pointer-events="none"><\/rect>/)
})

test('security formatting and bands match the tactical board including unknown values', async () => {
  const { securityColor, securityLabel } = await loadPrimitives()
  for (const [value, text, color] of [
    [undefined, '安等未知', '#a6adb1'], [null, '安等未知', '#a6adb1'],
    [1, '1.00', '#96b8a5'], [.5, '0.50', '#96b8a5'],
    ['0.49', '0.49', '#cfb288'], [0, '0.00', '#d19b91'], [-.76, '-0.76', '#d19b91'],
  ]) {
    assert.equal(securityLabel(value), text)
    assert.equal(securityColor(value), color)
  }
})
