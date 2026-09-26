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

test('manual pirate refresh exposes busy state and last successful sync time', () => {
  assert.match(source, /const \[refreshing, setRefreshing\] = useState\(false\)/)
  assert.match(source, /const \[lastSyncAt, setLastSyncAt\] = useState\(null\)/)
  assert.match(source, /setRefreshing\(true\)/)
  assert.match(source, /setLastSyncAt\(/)
  assert.match(source, /aria-busy=\{refreshing\}/)
  assert.match(source, /disabled=\{refreshing\}/)
  assert.match(source, /上次同步/)
})

test('pirate scope editor speaks in intelligence coverage terms', () => {
  assert.match(source, /<ScopeEditor[^>]*variant="pirate"/)
  assert.match(controls, /variant === 'pirate' \? '设置情报覆盖星域'/)
})

test('system map selection opens a prefilled report without changing target selection', () => {
  assert.match(source, /const \[reportLocation, setReportLocation\] = useState\(null\)/)
  assert.match(source, /selectedSystemId=\{reportLocation\?\.id\}/)
  assert.match(source, /onSelectSystem=\{system => \{ const location = \{ \.\.\.system, id: system\.id \?\? system\.system_id/)
  assert.match(source, /name: system\.zh_name \?\? system\.name \?\? system\.system_name/)
  assert.match(source, /initialLocation=\{reportLocation\}/)
  assert.match(source, /setFormOpen\(false\); setReportLocation\(null\)/)
})

test('sighting form accepts and displays an initial exact location', () => {
  const form = readFileSync(fileURLToPath(new URL('components/tactical/PirateSightingForm.jsx', root)), 'utf8')
  assert.match(form, /initialLocation = null/)
  assert.match(form, /useState\(initialLocation\)/)
  assert.match(form, /setLocationKind\('system'\)/)
  assert.match(form, /setLocation\(initialLocation\)/)
  assert.match(form, /\}, \[initialLocation\]\)/)
})
