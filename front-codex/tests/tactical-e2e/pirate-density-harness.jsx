import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PirateIntelMap from '../../src/components/tactical/PirateIntelMap'

const systems = Array.from({ length: 5000 }, (_, index) => ({
  system_id: index + 1,
  constellation_id: Math.floor(index / 20) + 1,
  region_id: 7,
  name: `System ${index + 1}`,
  x: index % 100,
  z: Math.floor(index / 100),
}))
const parameters = new URLSearchParams(window.location.search)
const stargates = parameters.has('gates') ? systems.flatMap((system, index) => [
  ...(index % 100 < 99 ? [{ system_id: system.system_id, destination_system_id: system.system_id + 1 }] : []),
  ...(index < 1000 ? [{ system_id: system.system_id, destination_system_id: system.system_id + 100 }] : []),
]) : []
const mapData = { systems, stargates, scope: { region_ids: [7], version: 1 } }
const targets = systems.map((system, index) => ({
  key: `target:${index}`,
  character_name: `Pilot ${index}`,
  ship_type: 'Nyx',
  count: 1,
  latest: { status: 'active', location_kind: 'system', location_id: system.system_id,
    location_name: system.name, observed_at: '2026-09-24T12:00:00Z' },
}))
targets.push({ ...targets[0], key: 'target:duplicate', character_name: 'Second pilot' })
const displayedTargets = parameters.has('empty') ? [] : parameters.has('cluster')
  ? targets.map(target => ({ ...target, latest: { ...target.latest, location_id: 1, location_name: 'System 1' } }))
  : targets

function Harness() {
  const [selectedKey, setSelectedKey] = useState(null)
  const [focusTargetKey, setFocusTargetKey] = useState(null)
  const [focusRequestId, setFocusRequestId] = useState(0)
  const [now, setNow] = useState(Date.parse('2026-09-24T12:00:00Z'))
  window.__pirateDensityAdvanceNow = () => setNow(previous => previous + 60_000)
  window.__pirateDensitySelect = index => {
    const key = `target:${index}`
    setSelectedKey(key)
    setFocusTargetKey(key)
    setFocusRequestId(previous => previous + 1)
  }
  return <div data-density-now={now} style={{ width: '100vw', height: '100vh' }}>
    <PirateIntelMap mapData={mapData} targets={displayedTargets} selectedKey={selectedKey}
      focusTargetKey={focusTargetKey} focusRequestId={focusRequestId}
      onSelectTarget={target => setSelectedKey(target.key)} now={now} />
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
