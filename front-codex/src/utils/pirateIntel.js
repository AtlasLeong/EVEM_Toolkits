const recentFirst = (left, right) => Date.parse(right.observed_at) - Date.parse(left.observed_at) || right.id - left.id

const HISTORICAL_SIGHTING_AGE_MS = 48 * 60 * 60 * 1000

export function isHistoricalSighting(sighting, now = Date.now()) {
  const observed = Date.parse(sighting?.observed_at ?? '')
  const reference = Number(now)
  return !Number.isFinite(observed) || !Number.isFinite(reference) || reference - observed > HISTORICAL_SIGHTING_AGE_MS
}

export function groupPirateSightings(sightings = []) {
  const groups = new Map()
  for (const row of sightings) {
    const identity = row.target_key || [row.character_name?.normalize('NFKC').toLowerCase(), row.ship_type?.normalize('NFKC').toLowerCase()]
    const key = JSON.stringify(identity)
    if (!groups.has(key)) groups.set(key, { key, character_name: row.character_name, ship_type: row.ship_type, history: [] })
    groups.get(key).history.push(row)
  }
  return [...groups.values()].map(group => {
    group.history.sort(recentFirst)
    group.latest = group.history.find(row => row.status === 'active') || null
    group.count = group.history.length
    return group
  }).sort((left, right) => {
    if (!left.latest) return right.latest ? 1 : 0
    if (!right.latest) return -1
    return recentFirst(left.latest, right.latest)
  })
}

export function currentPirateTargets(targets = [], now = Date.now()) {
  const reference = Number(now)
  if (!Number.isFinite(reference)) return []
  const utcTime = new Date(reference)
  const timeOfDay = ((utcTime.getUTCHours() * 60 + utcTime.getUTCMinutes()) * 60 + utcTime.getUTCSeconds()) * 1000 + utcTime.getUTCMilliseconds()
  const parseTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value || '')
    ? (Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5))) * 60 * 1000
    : null

  return targets.filter(target => {
    const latest = target.latest
    if (latest?.status !== 'active') return false
    const observed = Date.parse(latest.observed_at ?? '')
    const age = reference - observed
    if (!Number.isFinite(age) || age < 0 || age > HISTORICAL_SIGHTING_AGE_MS) return false
    const start = parseTime(latest.activity_start_utc)
    const end = parseTime(latest.activity_end_utc)
    if (start === null || end === null || start === end) return false
    return start < end ? timeOfDay >= start && timeOfDay < end : timeOfDay >= start || timeOfDay < end
  }).sort((left, right) => recentFirst(left.latest, right.latest))
}

export function pirateMapMarkers(targets = [], systems = []) {
  const bySystem = new Map(systems.map(system => [Number(system.system_id), system]))
  const byConstellation = new Map()
  for (const system of systems) {
    const id = Number(system.constellation_id)
    if (!byConstellation.has(id)) byConstellation.set(id, [])
    byConstellation.get(id).push(system)
  }
  const locations = new Map()
  for (const target of targets) {
    const latest = target.latest
    if (!latest) continue
    const id = Number(latest.location_id)
    const kind = latest.location_kind
    const key = `${kind}:${id}`
    if (!locations.has(key)) {
      const members = kind === 'system' ? [bySystem.get(id)].filter(Boolean) : byConstellation.get(id) || []
      if (!members.length) continue
      locations.set(key, { key, location_kind: kind, location_id: id,
        location_name: latest.location_name,
        x: members.reduce((sum, row) => sum + row.px, 0) / members.length,
        y: members.reduce((sum, row) => sum + row.py, 0) / members.length,
        targets: [], count: 0 })
    }
    const marker = locations.get(key)
    marker.targets.push(target)
    marker.count += 1
  }
  return [...locations.values()].sort((left, right) =>
    (left.location_kind === right.location_kind ? 0 : left.location_kind === 'system' ? -1 : 1) ||
    left.location_id - right.location_id)
}

export function activityWindowLabel(start, end) {
  if (!start || !end) return '活跃时段未记录'
  return `每日 ${start}–${start > end ? '次日 ' : ''}${end} UTC`
}

export function sightingPayload(draft) {
  const character_name = String(draft.character_name || '').trim()
  const ship_type = String(draft.ship_type || '').trim()
  const notes = String(draft.notes || '').trim()
  const location_id = Number(draft.location_id)
  const observed = new Date(draft.observed_at)
  if (!character_name || character_name.length > 120 || !ship_type || ship_type.length > 120 ||
      !['system', 'constellation'].includes(draft.location_kind) || !Number.isSafeInteger(location_id) || location_id <= 0 ||
      !Number.isFinite(observed.getTime()) || notes.length > 1000) {
    throw new Error('请填写目标、船型、有效地点和观测时间。')
  }
  const start = draft.activity_start_utc || null
  const end = draft.activity_end_utc || null
  if (Boolean(start) !== Boolean(end) || [start, end].some(value => value && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) {
    throw new Error('活跃时段需填写完整的 UTC 起止时间。')
  }
  return { character_name, ship_type, location_kind: draft.location_kind, location_id,
    observed_at: observed.toISOString(), activity_start_utc: start, activity_end_utc: end, notes }
}
