// Precompute this once per static map; target rows should not scan thousands of stars.
export function buildPirateCoverage(mapData) {
  if (!mapData) return null
  return {
    systems: new Set((mapData.systems || []).map(system => Number(system.system_id))),
    constellations: new Set((mapData.systems || []).map(system => Number(system.constellation_id))),
  }
}

// Unknown means static geometry has not been loaded yet, not that intel was lost.
export function isLocationInPirateMap(sighting, coverage) {
  if (!coverage) return null
  const id = Number(sighting?.location_id)
  if (sighting?.location_kind === 'system') {
    return coverage.systems.has(id)
  }
  if (sighting?.location_kind === 'constellation') {
    return coverage.constellations.has(id)
  }
  return false
}
