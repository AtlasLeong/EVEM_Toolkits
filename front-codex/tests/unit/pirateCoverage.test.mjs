import assert from 'node:assert/strict'
import { test } from 'node:test'
import { buildPirateCoverage, isLocationInPirateMap } from '../../src/utils/pirateCoverage.js'

const map = { systems: [
  { system_id: 101, constellation_id: 11 },
  { system_id: 102, constellation_id: 12 },
] }

test('location visibility distinguishes exact systems from constellation coverage', () => {
  const coverage = buildPirateCoverage(map)
  assert.equal(isLocationInPirateMap({ location_kind: 'system', location_id: 101 }, coverage), true)
  assert.equal(isLocationInPirateMap({ location_kind: 'system', location_id: 999 }, coverage), false)
  assert.equal(isLocationInPirateMap({ location_kind: 'constellation', location_id: 12 }, coverage), true)
  assert.equal(isLocationInPirateMap({ location_kind: 'constellation', location_id: 999 }, coverage), false)
  assert.equal(isLocationInPirateMap({ location_kind: 'system', location_id: 101 }, null), null)
})
