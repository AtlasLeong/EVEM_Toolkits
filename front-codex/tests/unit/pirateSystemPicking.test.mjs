import test from 'node:test'
import assert from 'node:assert/strict'
import { indexPirateSystems, pickPirateSystems } from '../../src/utils/pirateSystemPicking.js'

test('full-index picking finds unsampled stars at fixed screen radius under pan and zoom', () => {
  const systems = Array.from({ length: 5000 }, (_, index) => ({ system_id: index + 1,
    px: index % 100 * 60 - 3000, py: Math.floor(index / 100) * 60 - 1500 }))
  const index = indexPirateSystems(systems)
  const target = systems[3111]
  for (const scale of [.5, 1, 4, 16]) {
    const camera = { x: 160, y: -80, scale }
    assert.deepEqual(pickPirateSystems(index, { x: target.px * scale + camera.x,
      y: target.py * scale + camera.y }, camera), [target])
  }
})

test('picking ignores distant stars and missing coordinates instead of using the nearest sampled hit', () => {
  const nodes = [{ system_id: 1, px: 0, py: 0 }, { system_id: 2, px: 100, py: 100 }, { system_id: 3 }]
  const index = indexPirateSystems(nodes)
  assert.deepEqual(pickPirateSystems(index, { x: 23, y: 0 }, { x: 0, y: 0, scale: 1 }), [])
  assert.deepEqual(pickPirateSystems(index, { x: 22, y: 0 }, { x: 0, y: 0, scale: 1 }), [nodes[0]])
})

test('near ties and coincident stars return named candidates in stable distance order', () => {
  const nodes = [{ system_id: 5, px: 0, py: 0 }, { system_id: 2, px: 0, py: 0 }, { system_id: 3, px: 20, py: 0 }]
  const index = indexPirateSystems(nodes)
  assert.deepEqual(pickPirateSystems(index, { x: 0, y: 0 }, { x: 0, y: 0, scale: 1 }).map(node => node.system_id), [2, 5, 3])
  assert.deepEqual(pickPirateSystems(index, { x: 20, y: 0 }, { x: 0, y: 0, scale: 1 }), [nodes[2]])
})

test('pointer queries inspect only nearby spatial buckets, not all 5000 system coordinates', () => {
  let reads = 0
  const nodes = Array.from({ length: 5000 }, (_, index) => ({ system_id: index,
    get px() { reads += 1; return index % 100 * 80 },
    get py() { reads += 1; return Math.floor(index / 100) * 80 },
  }))
  const index = indexPirateSystems(nodes)
  reads = 0
  assert.equal(pickPirateSystems(index, { x: 80, y: 80 }, { x: 0, y: 0, scale: 1 })[0].system_id, 101)
  assert.ok(reads < 20, `unexpected full coordinate scan: ${reads}`)
})
