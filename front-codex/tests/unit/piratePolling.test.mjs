import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { pirateRefreshDelay } from '../../src/utils/piratePolling.js'

const root = new URL('../../src/', import.meta.url)
const source = readFileSync(fileURLToPath(new URL('components/tactical/PirateIntelBoard.jsx', root)), 'utf8')
const controls = readFileSync(fileURLToPath(new URL('components/tactical/TacticalControls.jsx', root)), 'utf8')

test('polling delay grows from 15 to 60 seconds and is bounded', () => {
  assert.equal(pirateRefreshDelay(0), 15000)
  assert.equal(pirateRefreshDelay(1), 30000)
  assert.equal(pirateRefreshDelay(2), 60000)
  assert.equal(pirateRefreshDelay(9), 60000)
})

test('visible pirate polling backs off after failures and does not overlap a fixed interval', () => {
  assert.match(source, /pirateRefreshDelay\(failures\)/)
  assert.match(source, /setTimeout\(poll, pirateRefreshDelay\(failures\)\)/)
  assert.doesNotMatch(source, /setInterval\(/)
  assert.match(source, /visibilitychange/)
})

test('mobile-first pirate board defers star map geometry until the map is opened', () => {
  assert.match(source, /mobileViewport && !mapOpen/)
  assert.match(source, /if \(!hasScope \|\| \(mobileViewport && !mapOpen\)\)/)
})

test('old sightings are labeled as historical rather than live positions', () => {
  assert.match(source, /isHistoricalSighting\(target\.latest, serverNow\)/)
  assert.match(source, /ageLabel\(target\.latest\.observed_at, serverNow\)/)
  assert.match(source, /now=\{serverNow\}/)
  assert.match(source, /历史线索 ·/)
  assert.match(source, /并非实时位置/)
})

test('star map failure has its own retry instead of a permanent loading message', () => {
  assert.match(source, /setMapError\(controller\.signal\.aborted \?/)
  assert.match(source, /setMapRetry\(value => value \+ 1\)/)
  assert.match(source, /mapError \? <div className="pirate-map-empty"/)
})

test('pirate scope editor speaks in intelligence coverage terms', () => {
  assert.match(source, /<ScopeEditor[^>]*variant="pirate"/)
  assert.match(controls, /variant === 'pirate' \? '设置情报覆盖星域'/)
})
