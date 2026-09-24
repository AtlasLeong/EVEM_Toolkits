import test from 'node:test'
import assert from 'node:assert/strict'
import { activityWindowLabel, currentPirateTargets, groupPirateSightings, pirateMapMarkers, sightingPayload } from '../../src/utils/pirateIntel.js'

const seen = (id, character_name, ship_type, location_kind, location_id, observed_at, extra = {}) => ({
  id, version: 1, character_name, ship_type, target_key: [character_name.toLowerCase(), ship_type.toLowerCase()],
  location_kind, location_id, location_name: String(location_id), observed_at,
  status: 'active', author_name: 'atlas123', ...extra,
})

test('target grouping uses character and exact ship, with latest active sighting as marker', () => {
  const rows = [
    seen(1, 'Pilot', 'Nyx', 'system', 101, '2026-09-21T10:00:00Z'),
    seen(2, 'Pilot', 'Nyx', 'system', 102, '2026-09-22T10:00:00Z'),
    seen(3, 'Pilot', 'Hel', 'system', 101, '2026-09-22T09:00:00Z'),
    seen(4, 'Pilot', 'Nyx', 'system', 103, '2026-09-23T10:00:00Z', { status: 'withdrawn' }),
  ]
  const groups = groupPirateSightings(rows)
  assert.equal(groups.length, 2)
  assert.equal(groups.find(group => group.ship_type === 'Nyx').latest.location_id, 102)
  assert.equal(groups.find(group => group.ship_type === 'Nyx').history.length, 3)
})

test('map markers merge targets by location but keep constellation precision distinct', () => {
  const targets = groupPirateSightings([
    seen(1, 'A', 'Nyx', 'system', 101, '2026-09-22T10:00:00Z'),
    seen(2, 'B', 'Hel', 'system', 101, '2026-09-22T11:00:00Z'),
    seen(3, 'C', 'Revelation', 'constellation', 44, '2026-09-22T12:00:00Z'),
  ])
  const systems = [
    { system_id: 101, constellation_id: 44, px: 20, py: 40 },
    { system_id: 102, constellation_id: 44, px: 60, py: 80 },
  ]
  const markers = pirateMapMarkers(targets, systems)
  assert.deepEqual(markers.map(item => [item.location_kind, item.location_id, item.count, item.x, item.y]), [
    ['system', 101, 2, 20, 40],
    ['constellation', 44, 1, 40, 60],
  ])
})

test('activity window labels a midnight-crossing UTC range without implying live position', () => {
  assert.equal(activityWindowLabel('23:00', '02:00'), '每日 23:00–次日 02:00 UTC')
  assert.equal(activityWindowLabel(null, null), '活跃时段未记录')
})

test('current candidates use UTC windows with an inclusive start and exclusive end', () => {
  const targets = groupPirateSightings([
    seen(1, 'Night', 'Nyx', 'system', 101, '2026-09-24T20:00:00Z',
      { activity_start_utc: '23:00', activity_end_utc: '02:00' }),
  ])
  assert.equal(currentPirateTargets(targets, Date.parse('2026-09-24T23:00:00Z')).length, 1)
  assert.equal(currentPirateTargets(targets, Date.parse('2026-09-25T01:59:59Z')).length, 1)
  assert.equal(currentPirateTargets(targets, Date.parse('2026-09-25T02:00:00Z')).length, 0)
  assert.equal(currentPirateTargets(targets, Date.parse('2026-09-24T22:59:59Z')).length, 0)
})

test('current candidates require a complete nonzero activity window and an active latest sighting', () => {
  const now = Date.parse('2026-09-24T12:30:00Z')
  const targets = groupPirateSightings([
    seen(1, 'Missing', 'Nyx', 'system', 101, '2026-09-24T12:00:00Z'),
    seen(2, 'Partial', 'Hel', 'system', 102, '2026-09-24T12:00:00Z',
      { activity_start_utc: '12:00' }),
    seen(3, 'Equal', 'Phoenix', 'system', 103, '2026-09-24T12:00:00Z',
      { activity_start_utc: '12:00', activity_end_utc: '12:00' }),
    seen(4, 'Withdrawn', 'Revelation', 'system', 104, '2026-09-24T12:00:00Z',
      { status: 'withdrawn', activity_start_utc: '12:00', activity_end_utc: '13:00' }),
    seen(5, 'Valid', 'Avatar', 'system', 105, '2026-09-24T12:00:00Z',
      { activity_start_utc: '12:00', activity_end_utc: '13:00' }),
  ])
  assert.deepEqual(currentPirateTargets(targets, now).map(target => target.character_name), ['Valid'])
})

test('current candidates exclude stale and future sightings at the 48-hour boundary', () => {
  const now = Date.parse('2026-09-24T12:30:00Z')
  const window = { activity_start_utc: '12:00', activity_end_utc: '13:00' }
  const targets = groupPirateSightings([
    seen(1, 'Boundary', 'Nyx', 'system', 101, '2026-09-22T12:30:00Z', window),
    seen(2, 'Stale', 'Hel', 'system', 102, '2026-09-22T12:29:59.999Z', window),
    seen(3, 'Future', 'Phoenix', 'system', 103, '2026-09-24T12:30:01Z', window),
  ])
  assert.deepEqual(currentPirateTargets(targets, now).map(target => target.character_name), ['Boundary'])
})

test('current candidates use only each target latest active sighting and sort newest first', () => {
  const now = Date.parse('2026-09-24T12:30:00Z')
  const targets = groupPirateSightings([
    seen(1, 'Older', 'Nyx', 'system', 101, '2026-09-24T10:00:00Z',
      { activity_start_utc: '12:00', activity_end_utc: '13:00' }),
    seen(2, 'Newer', 'Hel', 'system', 102, '2026-09-24T11:00:00Z',
      { activity_start_utc: '12:00', activity_end_utc: '13:00' }),
    seen(3, 'Changed', 'Phoenix', 'system', 103, '2026-09-24T09:00:00Z',
      { activity_start_utc: '12:00', activity_end_utc: '13:00' }),
    seen(4, 'Changed', 'Phoenix', 'system', 104, '2026-09-24T12:00:00Z',
      { activity_start_utc: '14:00', activity_end_utc: '15:00' }),
  ])
  const originalOrder = targets.map(target => target.character_name)
  assert.deepEqual(currentPirateTargets(targets, now).map(target => target.character_name), ['Newer', 'Older'])
  assert.deepEqual(targets.map(target => target.character_name), originalOrder)
})

test('sighting payload trims identity, preserves location precision and submits an aware timestamp', () => {
  const payload = sightingPayload({ character_name: ' Pilot ', ship_type: ' Nyx ',
    location_kind: 'constellation', location_id: 44, observed_at: '2026-09-23T12:30',
    activity_start_utc: '23:00', activity_end_utc: '02:00', notes: ' 夜间巡逻 ' })
  assert.equal(payload.character_name, 'Pilot')
  assert.equal(payload.ship_type, 'Nyx')
  assert.equal(payload.location_kind, 'constellation')
  assert.equal(payload.location_id, 44)
  assert.match(payload.observed_at, /Z$/)
  assert.equal(payload.notes, '夜间巡逻')
  assert.throws(() => sightingPayload({ character_name: ' ', ship_type: 'Nyx', location_kind: 'system', location_id: 101,
    observed_at: '2026-09-23T12:30' }))
})
