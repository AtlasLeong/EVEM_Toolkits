import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import * as pirateIntel from '../../src/utils/pirateIntel.js'

const { groupPirateSightings } = pirateIntel

const require = createRequire(import.meta.url)
let modulePromise
function loadMap() {
  modulePromise ||= build({
    entryPoints: [fileURLToPath(new URL('../../src/components/tactical/PirateIntelMap.jsx', import.meta.url))],
    bundle: true,
    write: false,
    platform: 'node',
    format: 'cjs',
    packages: 'external',
    loader: { '.css': 'empty' },
    jsx: 'automatic',
  }).then(result => {
    const mapModule = { exports: {} }
    new Function('require', 'module', 'exports', result.outputFiles[0].text)(require, mapModule, mapModule.exports)
    return mapModule.exports
  })
  return modulePromise
}

const mapData = {
  systems: [
    { system_id: 101, constellation_id: 44, region_id: 7, name: 'Alpha', x: 0, z: 0 },
    { system_id: 102, constellation_id: 44, region_id: 7, name: 'Beta', x: 10, z: 0 },
    { system_id: 103, constellation_id: 45, region_id: 7, name: 'Gamma', x: 20, z: 10 },
  ],
  stargates: [
    { system_id: 101, destination_system_id: 102 },
    { system_id: 102, destination_system_id: 101 },
    { system_id: 102, destination_system_id: 103 },
  ],
  constellations: [{ constellation_id: 44, zh_name: '双星座' }],
  scope: { region_ids: [7], version: 1 },
}
const sighting = (id, name, kind, locationId) => ({
  id, character_name: name, ship_type: 'Nyx', target_key: [name.toLowerCase(), 'nyx'],
  status: 'active', location_kind: kind, location_id: locationId,
  location_name: kind === 'system' ? 'Alpha' : '双星座',
  observed_at: `2999-09-2${id}T12:00:00Z`,
})
const targets = groupPirateSightings([
  sighting(1, 'Pilot A', 'system', 101),
  sighting(2, 'Pilot B', 'system', 101),
  sighting(3, 'Pilot C', 'constellation', 44),
])

test('a sighting becomes historical only after 48 hours, with invalid timestamps treated cautiously', () => {
  assert.equal(typeof pirateIntel.isHistoricalSighting, 'function')
  const now = Date.parse('2026-09-24T12:00:00Z')
  assert.equal(pirateIntel.isHistoricalSighting({ observed_at: '2026-09-22T12:00:00Z' }, now), false)
  assert.equal(pirateIntel.isHistoricalSighting({ observed_at: '2026-09-22T11:59:59.999Z' }, now), true)
  assert.equal(pirateIntel.isHistoricalSighting({ observed_at: '2026-09-23T12:00:00Z' }, now), false)
  assert.equal(pirateIntel.isHistoricalSighting({ observed_at: 'not-a-date' }, now), true)
})

test('real systems expose selectable accessible hit areas', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: { ...mapData, systems: mapData.systems.map((node, index) => index === 0 ? { ...node, security_status: -.76 } : node) },
    targets: [], onSelectSystem() {}, selectedSystemId: 101,
  }))
  assert.match(html, /role="button"[^>]*aria-label="Alpha \(101\)，安等 -0\.76"/)
  assert.match(html, /data-pirate-system="101"/)
  assert.match(html, /data-pirate-system="102"/)
  assert.match(html, /pirate-map__system-hit--selected/)
  assert.match(html, /class="pirate-map__system-selection-ring"[^>]*data-fixed-kind="ring"[^>]*data-base-radius="12"/)
  assert.match(html, /class="pirate-map__system-hit pirate-map__system-hit--selected"[^>]*fill="transparent"/)
  assert.doesNotMatch(html, /class="pirate-map__labels" aria-hidden="true"[^>]*>.*data-pirate-system="101"/)
})

test('dense maps cap offscreen system hit nodes without dropping the selected system', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const systems = Array.from({ length: 420 }, (_, index) => ({
    system_id: String(index + 1), region_id: index === 419 ? 2 : 1,
    name: `System ${index + 1}`, x: index === 419 ? 10000 : index % 42, z: index === 419 ? 10000 : Math.floor(index / 42),
  }))
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: { systems, stargates: [], scope: { region_ids: [1] } }, targets: [], selectedSystemId: 420,
  }))
  const hitCount = (html.match(/data-pirate-system=/g) || []).length
  assert.ok(hitCount > 0 && hitCount <= 250)
  assert.match(html, /data-pirate-system="420"/)
})

test('scene uses real system coordinates, deduplicates gates, and centers both kinds of intelligence marker', async () => {
  const { createPirateMapScene } = await loadMap()
  const scene = createPirateMapScene(mapData, targets, { width: 400, height: 240 })
  const byId = new Map(scene.systems.map(node => [node.system_id, node]))
  assert.equal(scene.gates.length, 2)
  assert.deepEqual(scene.gates.map(gate => [gate.x1, gate.y1, gate.x2, gate.y2]), [
    [byId.get(101).px, byId.get(101).py, byId.get(102).px, byId.get(102).py],
    [byId.get(102).px, byId.get(102).py, byId.get(103).px, byId.get(103).py],
  ])
  const systemMarker = scene.markers.find(marker => marker.location_kind === 'system')
  const constellationMarker = scene.markers.find(marker => marker.location_kind === 'constellation')
  assert.equal(systemMarker.count, 2)
  assert.deepEqual([systemMarker.x, systemMarker.y], [byId.get(101).px, byId.get(101).py])
  assert.deepEqual([constellationMarker.x, constellationMarker.y], [
    (byId.get(101).px + byId.get(102).px) / 2,
    (byId.get(101).py + byId.get(102).py) / 2,
  ])
})

test('static geometry can be reused across changing target snapshots', async () => {
  const { createPirateMapGeometry, createPirateMapScene } = await loadMap()
  assert.equal(typeof createPirateMapGeometry, 'function')
  const viewport = { width: 400, height: 240 }
  const geometry = createPirateMapGeometry(mapData, viewport)
  const first = createPirateMapScene(mapData, targets, viewport, { geometry })
  const next = createPirateMapScene(mapData, [], viewport, { geometry })
  assert.strictEqual(first.systems, geometry.systems)
  assert.strictEqual(next.systems, geometry.systems)
  assert.strictEqual(next.gates, first.gates)
  assert.equal(first.markers.length, 2)
  assert.equal(next.markers.length, 0)
})

test('desktop static fit reserves the header and floating search panel without changing mobile fit', async () => {
  const { createPirateMapGeometry } = await loadMap()
  const desktop = createPirateMapGeometry(mapData, { width: 1200, height: 600 })
  assert.ok(desktop.systems.every(node => node.px >= 350 && node.px <= 1140))
  assert.ok(desktop.systems.every(node => node.py >= 160 && node.py <= 530))
  const mobile = createPirateMapGeometry(mapData, { width: 390, height: 600 })
  assert.ok(mobile.systems.some(node => node.px < 300))
  assert.equal(mobile.safeArea.padding.left, 54)
  assert.equal(mobile.safeArea.padding.top, 116)
})

test('sub-540px map keeps stars and floating cards below the wrapped toolbar', async () => {
  const { createPirateMapGeometry, layoutPirateTargetCards } = await loadMap()
  const mobileViewport = { width: 390, height: 350 }
  const geometry = createPirateMapGeometry(mapData, mobileViewport)
  assert.ok(geometry.systems.every(node => node.py >= 116))
  assert.ok(geometry.safeArea.cardTop >= 108)
  const marker = { key: 'system:101', x: 200, y: 70, offset_x: 0, offset_y: 0 }
  const [card] = layoutPirateTargetCards([marker], mobileViewport, { x: 0, y: 0, scale: 1 })
  assert.ok(card.top >= 108)
  const wider = createPirateMapGeometry(mapData, { width: 540, height: 350 })
  assert.equal(wider.safeArea.padding.top, 64)
  assert.equal(wider.safeArea.cardTop, 56)
})

test('sub-540px map zoom controls provide 44px touch targets', () => {
  const css = readFileSync(new URL('../../src/styles/pirateIntelMap.css', import.meta.url), 'utf8')
  assert.match(css, /@media \(max-width: 539px\)\s*\{[\s\S]*?\.pirate-map__zoom-controls button\s*\{[^}]*min-width:\s*44px;[^}]*height:\s*44px;/)
})

test('900px tablet map uses ordinary fit, card placement and focus margins', async () => {
  const { createPirateMapGeometry, layoutPirateTargetCards, focusPirateCamera } = await loadMap()
  const viewport = { width: 900, height: 600 }
  const geometry = createPirateMapGeometry(mapData, viewport)
  assert.equal(geometry.safeArea.padding.left, 54)
  assert.equal(geometry.safeArea.padding.top, 64)
  assert.ok(geometry.systems.some(node => node.px < 350))
  const marker = { key: 'system:101', x: 200, y: 140, offset_x: 0, offset_y: 0 }
  const [card] = layoutPirateTargetCards([marker], viewport, { x: 0, y: 0, scale: 1 })
  assert.ok(card.left < 350 && card.top < 160)
  const camera = { x: 0, y: 0, scale: 1 }
  assert.strictEqual(focusPirateCamera(camera, marker, viewport), camera)
})

test('map renders one floating identity card per location marker and preserves selected marker highlight', async () => {
  const { default: PirateIntelMap, createPirateMapGeometry } = await loadMap()
  const alpha = createPirateMapGeometry(mapData).systems.find(node => node.system_id === 101)
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData, targets, selectedKey: targets.find(target => target.latest.location_kind === 'constellation').key,
    onSelectTarget() {},
  }))
  assert.match(html, /class="pirate-map__gate"/)
  assert.match(html, /data-location-kind="system"/)
  assert.match(html, /data-location-kind="constellation"/)
  assert.match(html, /role="group" aria-label="海盗情报星图"/)
  assert.match(html, /role="button" tabindex="0" aria-label="双星座：1 个目标，星座范围（非精确星系）"/)
  assert.match(html, /pirate-map__marker--constellation pirate-map__marker--selected/)
  assert.match(html, /aria-label="双星座：1 个目标，星座范围（非精确星系）"/)
  assert.match(html, /class="pirate-map__labels"/)
  assert.match(html, /class="tac-star-name"[^>]*>Alpha<\/text>/)
  assert.match(html, /class="tac-star-security"[^>]*>安等未知<\/text>/)
  assert.doesNotMatch(html, /<\/title>0<circle/)
  assert.equal((html.match(/data-pirate-card=/g) || []).length, 2)
  assert.match(html, /data-pirate-card="system:101"[^>]*>.*?Alpha.*?2 个目标/)
  assert.match(html, /data-pirate-card="constellation:44"[^>]*>.*?Pilot C.*?Nyx.*?星座范围/)
  assert.equal((html.match(/class="pirate-map__card-tether"/g) || []).length, 2)
})

test('a single system target card displays character and ship rather than just its numeral', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const oneTarget = targets.filter(target => target.character_name === 'Pilot A')
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData, targets: oneTarget, onSelectTarget() {},
  }))
  assert.equal((html.match(/data-pirate-card=/g) || []).length, 1)
  assert.match(html, /data-pirate-card="system:101"[^>]*>.*?Pilot A.*?Nyx/)
})

test('floating cards track the map camera, stay near anchors and avoid nearby cards', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  assert.equal(typeof layoutPirateTargetCards, 'function')
  const markers = [
    { key: 'system:101', x: 100, y: 100, offset_x: 0, offset_y: 0 },
    { key: 'system:102', x: 110, y: 105, offset_x: 0, offset_y: 0 },
  ]
  const viewport = { width: 700, height: 400 }
  const cards = layoutPirateTargetCards(markers, viewport, { x: 10, y: -5, scale: 2 })
  assert.deepEqual(cards.map(card => [card.anchorX, card.anchorY]), [[210, 195], [230, 205]])
  assert.ok(cards.every(card => card.left >= 8 && card.top >= 8))
  assert.ok(cards.every(card => Math.hypot(card.tetherX - card.anchorX, card.tetherY - card.anchorY) <= 170))
  const [a, b] = cards
  assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left ||
    a.top + a.height <= b.top || b.top + b.height <= a.top, 'nearby cards should not overlap')
  const zoomed = layoutPirateTargetCards(markers, viewport, { x: 10, y: -5, scale: 3 })
  assert.deepEqual(zoomed.map(card => [card.anchorX, card.anchorY]), [[310, 295], [340, 310]])
})

test('crowded cards are bounded and never overlap while the selected target keeps a card', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const viewport = { width: 1200, height: 700 }
  const markers = Array.from({ length: 100 }, (_, index) => ({
    key: `system:${index}`, x: 350 + (index * 37) % 800, y: 160 + (index * 53) % 500,
    targets: [{ key: `target:${index}` }],
  }))
  const cards = layoutPirateTargetCards(markers, viewport, { x: 0, y: 0, scale: 1 }, [], undefined, 'target:99')
  assert.ok(cards.length <= 24, `rendered ${cards.length} cards for 100 markers`)
  assert.ok(cards.some(card => card.marker.key === 'system:99'), 'selected target needs a card')
  assert.ok(cards.every(card => card.top + card.height <= viewport.height - 60),
    'cards leave the summary strip readable')
  for (let index = 0; index < cards.length; index += 1) {
    for (let other = index + 1; other < cards.length; other += 1) {
      const a = cards[index], b = cards[other]
      assert.ok(a.left + a.width <= b.left || b.left + b.width <= a.left ||
        a.top + a.height <= b.top || b.top + b.height <= a.top,
      `${a.marker.key} overlaps ${b.marker.key}`)
    }
  }
})

test('crowded card selection stays stable during small camera movements', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const viewport = { width: 1200, height: 700 }
  const markers = Array.from({ length: 100 }, (_, index) => ({
    key: `system:${index}`, x: 400 + (index * 31) % 650, y: 200 + (index * 47) % 400,
    targets: [{ key: `target:${index}` }],
  }))
  const keys = camera => layoutPirateTargetCards(markers, viewport, camera).map(card => card.marker.key).sort()
  const initial = keys({ x: 0, y: 0, scale: 1 })
  assert.ok(initial.length <= 24, `rendered ${initial.length} cards`)
  assert.deepEqual(keys({ x: 5, y: -3, scale: 1.02 }), initial)
})

test('zoomed and panned sparse viewport does not rescan offscreen marker coordinates for card collisions', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const reads = { x: 0, y: 0 }
  const offscreen = Array.from({ length: 5000 }, (_, index) => ({
    key: `system:${index}`,
    get x() { reads.x += 1; return 2000 + index },
    get y() { reads.y += 1; return 2000 },
  }))
  const markers = [{ key: 'system:visible', x: 500, y: 250 }, ...offscreen]
  const viewport = { width: 1200, height: 700 }
  for (const camera of [{ x: 0, y: 0, scale: 1 }, { x: -3500, y: -1750, scale: 8 }]) {
    reads.x = 0; reads.y = 0
    const cards = layoutPirateTargetCards(markers, viewport, camera)
    assert.deepEqual(cards.map(card => card.marker.key), ['system:visible'])
    assert.deepEqual(reads, { x: 5000, y: 5000 }, 'offscreen marker coordinates should be read only for visibility')
  }
})

test('crowded map keeps every SVG marker and explains omitted identity cards', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const denseMap = {
    systems: Array.from({ length: 100 }, (_, index) => ({
      system_id: index + 1, constellation_id: 1, region_id: 7,
      name: `System ${index}`, x: index % 10, z: Math.floor(index / 10),
    })),
    stargates: [], scope: { region_ids: [7], version: 1 },
  }
  const denseTargets = groupPirateSightings(Array.from({ length: 100 }, (_, index) => ({
    id: index + 1, character_name: `Pilot ${index}`, ship_type: 'Nyx',
    target_key: [`pilot-${index}`, 'nyx'], status: 'active',
    location_kind: 'system', location_id: index + 1, location_name: `System ${index}`,
    observed_at: '2026-09-24T12:00:00Z',
  })))
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: denseMap, targets: denseTargets, selectedKey: denseTargets[99].key,
  }))
  assert.equal((html.match(/data-pirate-marker=/g) || []).length, 100)
  assert.ok((html.match(/data-pirate-card=/g) || []).length <= 24)
  assert.match(html, /其余.*目标.*列表.*标记/)
})

test('card placement leaves visible star labels clear when another nearby position is available', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const marker = { key: 'system:101', x: 230, y: 160, offset_x: 0, offset_y: 0 }
  const labels = [{ px: 245, py: 200, name: 'Nearby', primary: true }]
  const [card] = layoutPirateTargetCards([marker], { width: 700, height: 400 },
    { x: 0, y: 0, scale: 1 }, labels)
  const label = { left: 254, top: 178, width: 76, height: 20 }
  assert.ok(card.left + card.width <= label.left || label.left + label.width <= card.left ||
    card.top + card.height <= label.top || label.top + label.height <= card.top)
})

test('desktop target cards never occupy the header or floating search panel', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const viewport = { width: 1200, height: 600 }
  const markers = [{ key: 'system:101', x: 300, y: 145, offset_x: 0, offset_y: 0 }]
  const [card] = layoutPirateTargetCards(markers, viewport, { x: 0, y: 0, scale: 1 })
  assert.ok(card.left >= 350, `card left ${card.left} overlaps the search panel`)
  assert.ok(card.top >= 160, `card top ${card.top} overlaps the header`)
  assert.ok(card.left + card.width <= viewport.width - 8)
  assert.ok(card.top + card.height <= viewport.height - 8)
})

test('an open desktop detail panel reserves its right edge for floating target cards', async () => {
  const { createPirateMapGeometry, layoutPirateTargetCards } = await loadMap()
  const viewport = { width: 1200, height: 600 }
  const geometry = createPirateMapGeometry(mapData, viewport, { desktopOverlay: true })
  const openArea = { ...geometry.safeArea,
    padding: { ...geometry.safeArea.padding, right: 354 } }
  const marker = { key: 'system:101', x: 900, y: 300, offset_x: 0, offset_y: 0 }
  const [card] = layoutPirateTargetCards([marker], viewport, { x: 0, y: 0, scale: 1 }, [], openArea)
  assert.ok(openArea.padding.right >= 320, `right inset ${openArea.padding.right} does not cover the detail panel`)
  assert.ok(card.left + card.width <= viewport.width - openArea.padding.right,
    `card right ${card.left + card.width} lies behind the detail panel`)
  assert.equal(geometry.safeArea.padding.right, 68, 'opening a detail should not refit static star positions')
})

test('external target focus recenters only when its location is outside the safe viewport', async () => {
  const { focusPirateCamera } = await loadMap()
  assert.equal(typeof focusPirateCamera, 'function')
  const viewport = { width: 700, height: 400 }
  const start = { x: 0, y: 0, scale: 2 }
  const visible = { x: 150, y: 120, offset_x: 0, offset_y: 0 }
  assert.strictEqual(focusPirateCamera(start, visible, viewport), start)
  const outside = { x: 500, y: 350, offset_x: 26, offset_y: -24 }
  const focused = focusPirateCamera(start, outside, viewport)
  assert.equal(focused.scale, start.scale)
  assert.deepEqual([outside.x * focused.scale + focused.x + outside.offset_x,
    outside.y * focused.scale + focused.y + outside.offset_y], [viewport.width / 2, viewport.height / 2])
})

test('desktop focus treats targets beneath the floating search panel as occluded', async () => {
  const { focusPirateCamera } = await loadMap()
  const viewport = { width: 1200, height: 600 }
  const start = { x: 0, y: 0, scale: 1 }
  const covered = { x: 200, y: 240, offset_x: 0, offset_y: 0 }
  const focused = focusPirateCamera(start, covered, viewport)
  assert.notStrictEqual(focused, start)
  assert.ok(covered.x + focused.x >= 350)
  assert.ok(covered.y + focused.y >= 160)
  const clear = { x: 500, y: 300, offset_x: 0, offset_y: 0 }
  assert.strictEqual(focusPirateCamera(start, clear, viewport), start)
})

test('desktop focus treats targets beneath the header as occluded', async () => {
  const { focusPirateCamera } = await loadMap()
  const viewport = { width: 1200, height: 600 }
  const start = { x: 0, y: 0, scale: 1 }
  const covered = { x: 500, y: 120, offset_x: 0, offset_y: 0 }
  const focused = focusPirateCamera(start, covered, viewport)
  assert.notStrictEqual(focused, start)
  assert.ok(covered.y + focused.y >= 160)
})

test('focus respects all four supplied overlay-safe margins', async () => {
  const { focusPirateCamera } = await loadMap()
  const viewport = { width: 1000, height: 600 }
  const safeArea = { cardLeft: 350, cardTop: 160,
    padding: { left: 350, top: 170, right: 310, bottom: 220 } }
  const start = { x: 0, y: 0, scale: 1 }
  const covered = { x: 750, y: 450, offset_x: 0, offset_y: 0 }
  const focused = focusPirateCamera(start, covered, viewport, safeArea)
  assert.notStrictEqual(focused, start)
  assert.ok(covered.x + focused.x <= viewport.width - safeArea.padding.right)
  assert.ok(covered.y + focused.y <= viewport.height - safeArea.padding.bottom)
})

test('empty static scope shows an actionable explanation without fake geometry', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: { systems: [], stargates: [], scope: { region_ids: [] } }, targets: [], onSelectTarget() {},
  }))
  assert.match(html, /请先设置这块板的星图范围/)
  assert.doesNotMatch(html, /class="pirate-map__gate"/)
  assert.doesNotMatch(html, /data-location-kind=/)
})

test('an overlapping system target stays clickable above its constellation target', async () => {
  const { default: PirateIntelMap, createPirateMapScene } = await loadMap()
  const oneSystemMap = { ...mapData, systems: mapData.systems.slice(0, 1), stargates: [] }
  const scene = createPirateMapScene(oneSystemMap, targets)
  const constellation = scene.markers.find(marker => marker.location_kind === 'constellation')
  const star = scene.systems[0]
  assert.deepEqual([constellation.x, constellation.y], [star.px, star.py])
  assert.ok(Math.hypot(constellation.offset_x, constellation.offset_y) >= 25)
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: oneSystemMap,
    targets, onSelectTarget() {},
  }))
  assert.ok(html.indexOf('data-location-kind="constellation"') < html.indexOf('data-location-kind="system"'))
  assert.match(html, /data-location-kind="system"[^>]*>.*?<circle class="pirate-map__marker-halo" r="18" pointer-events="none"/)
  assert.match(html, /pirate-map__constellation-range/)
  assert.match(html, /星座范围（非精确星系）/)
})

test('a location marker is historical only when every latest target is older than 48 hours', async () => {
  const { createPirateMapScene } = await loadMap()
  const now = Date.parse('2026-09-24T12:00:00Z')
  const mixed = groupPirateSightings([
    { ...sighting(1, 'Old', 'system', 101), observed_at: '2026-09-20T10:00:00Z' },
    { ...sighting(2, 'New', 'system', 101), observed_at: '2026-09-24T10:00:00Z' },
    { ...sighting(3, 'Old constellation', 'constellation', 44), observed_at: '2026-09-20T10:00:00Z' },
  ])
  const markers = createPirateMapScene(mapData, mixed, { width: 400, height: 240 }, { now }).markers
  const system = markers.find(marker => marker.location_kind === 'system')
  const constellation = markers.find(marker => marker.location_kind === 'constellation')
  assert.equal(system.is_historical, false)
  assert.equal(system.historical_count, 1)
  assert.equal(constellation.is_historical, true)
  assert.equal(constellation.historical_count, 1)
})

test('historical marker advertises age in its accessible name and distinct class', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const oldTargets = groupPirateSightings([
    { ...sighting(1, 'Old', 'system', 101), observed_at: '2000-01-01T00:00:00Z' },
  ])
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData, targets: oldTargets, onSelectTarget() {},
  }))
  assert.match(html, /pirate-map__marker--historical/)
  assert.match(html, /aria-label="Alpha：1 个目标，星系定位，历史线索（目击已超过 48 小时）"/)
  assert.match(html, /data-pirate-card="system:101"[^>]*aria-label="Old，Nyx，Alpha，星系定位，历史线索/)
  assert.match(html, /data-pirate-card="system:101"[^>]*>.*?历史线索/)
})

test('wheel zoom preserves pointer-anchored world point and pan uses gesture origin', async () => {
  const { zoomPirateCamera, panPirateCamera } = await loadMap()
  const start = { x: 24, y: -12, scale: 1 }
  const anchor = { x: 180, y: 90 }
  const next = zoomPirateCamera(start, anchor, -400)
  assert.ok(next.scale > start.scale)
  assert.ok(Math.abs((anchor.x - start.x) / start.scale - (anchor.x - next.x) / next.scale) < 1e-9)
  assert.ok(Math.abs((anchor.y - start.y) / start.scale - (anchor.y - next.y) / next.scale) < 1e-9)
  assert.deepEqual(panPirateCamera(start, { x: 10, y: 20 }, { x: 42, y: 8 }), { x: 56, y: -24, scale: 1 })
})

test('camera scheduler commits one frame for rapid updates and cancels stale frames on immediate changes', async () => {
  const { createPirateCameraScheduler } = await loadMap()
  assert.equal(typeof createPirateCameraScheduler, 'function')
  const commits = [], frames = new Map(), cancelled = []
  let nextFrame = 1
  const scheduler = createPirateCameraScheduler(camera => commits.push(camera), {
    requestFrame(callback) { const id = nextFrame++; frames.set(id, callback); return id },
    cancelFrame(id) { cancelled.push(id); frames.delete(id) },
  })
  scheduler.schedule(camera => ({ ...camera, x: camera.x + 4 }))
  scheduler.schedule(camera => ({ ...camera, x: camera.x + 6 }))
  scheduler.schedule(camera => ({ ...camera, y: camera.y - 3 }))
  assert.equal(frames.size, 1)
  assert.equal(commits.length, 0)
  frames.get(1)()
  assert.deepEqual(commits, [{ x: 10, y: -3, scale: 1 }])
  scheduler.schedule(camera => ({ ...camera, x: camera.x + 20 }))
  scheduler.immediate({ x: 0, y: 0, scale: 1 })
  assert.deepEqual(cancelled, [2])
  assert.deepEqual(commits.at(-1), { x: 0, y: 0, scale: 1 })
  scheduler.dispose()
})

test('ending a drag commits its final pointer position without a delayed post-release move', async () => {
  const { createPirateCameraScheduler, finishPirateDrag, panPirateCamera } = await loadMap()
  assert.equal(typeof finishPirateDrag, 'function')
  const commits = [], frames = new Map(), cancelled = []
  const scheduler = createPirateCameraScheduler(camera => commits.push(camera), {
    requestFrame(callback) { frames.set(1, callback); return 1 },
    cancelFrame(id) { cancelled.push(id); frames.delete(id) },
  })
  const drag = { camera: { x: 0, y: 0, scale: 1 }, origin: { x: 10, y: 10 } }
  scheduler.schedule(panPirateCamera(drag.camera, drag.origin, { x: 20, y: 20 }))
  finishPirateDrag(scheduler, drag, { x: 30, y: 25 })
  assert.deepEqual(commits, [{ x: 20, y: 15, scale: 1 }])
  assert.deepEqual(cancelled, [1])
  assert.equal(frames.size, 0)
  scheduler.dispose()
})

test('pirate map shares the war board small stars and centered name/security typography', async () => {
  const { default: PirateIntelMap } = await loadMap()
  const html = renderToStaticMarkup(React.createElement(PirateIntelMap, {
    mapData: { ...mapData, systems: [{ ...mapData.systems[0], security_status: -.76 }] }, targets: [],
  }))
  assert.match(html, /class="pirate-map__star"[^>]*r="3"/)
  assert.match(html, /class="tac-star-name"[^>]*text-anchor="middle"[^>]*font-size="13"[^>]*font-weight="400"/)
  assert.match(html, /class="tac-star-security"[^>]*font-size="10"[^>]*>-0.76<\/text>/)
  assert.doesNotMatch(html, /dx="0.9em"/)
})

test('a sparse target card is centered above or below its real system', async () => {
  const { layoutPirateTargetCards } = await loadMap()
  const [card] = layoutPirateTargetCards([{ key: 'system:1', x: 400, y: 300, targets: [] }],
    { width: 900, height: 700 }, { x: 0, y: 0, scale: 1 })
  assert.equal(card.left + card.width / 2, card.anchorX)
  assert.equal(card.tetherX, card.anchorX)
})

test('wheel previews move layers per frame but commit React once when the gesture settles', async () => {
  const { createPirateCameraScheduler } = await loadMap()
  const commits = [], previews = [], frames = new Map(), timers = new Map()
  let id = 0
  const scheduler = createPirateCameraScheduler(camera => commits.push(camera), {
    requestFrame(callback) { frames.set(++id, callback); return id },
    cancelFrame(key) { frames.delete(key) },
    setTimer(callback) { timers.set(++id, callback); return id },
    clearTimer(key) { timers.delete(key) },
    onPreview(camera) { previews.push(camera) },
  })
  assert.equal(typeof scheduler.preview, 'function')
  const runFrame = () => { const [key, callback] = frames.entries().next().value; frames.delete(key); callback() }
  scheduler.preview(camera => ({ ...camera, scale: 2 }))
  scheduler.preview(camera => ({ ...camera, x: 24 }))
  assert.equal(frames.size, 1)
  runFrame()
  assert.deepEqual(previews, [{ x: 24, y: 0, scale: 2 }])
  assert.equal(commits.length, 0)
  scheduler.preview(camera => ({ ...camera, scale: 3 }))
  runFrame()
  assert.equal(commits.length, 0)
  assert.equal(timers.size, 1)
  const [timer, settle] = timers.entries().next().value
  timers.delete(timer); settle()
  assert.deepEqual(commits, [{ x: 24, y: 0, scale: 3 }])
  scheduler.preview(camera => ({ ...camera, x: 100 }))
  scheduler.immediate({ x: 0, y: 0, scale: 1 })
  assert.equal(frames.size, 0)
  assert.equal(timers.size, 0)
  scheduler.preview(camera => ({ ...camera, y: 100 }))
  scheduler.dispose()
  assert.equal(frames.size, 0)
  assert.equal(timers.size, 0)
})
