import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PirateIntelMap from '../../src/components/tactical/PirateIntelMap'

const systems = Array.from({ length: 100 }, (_, index) => ({
  system_id: index + 1, constellation_id: 1, region_id: 7,
  name: `System ${index}`, x: index % 10, z: Math.floor(index / 10),
}))
const mapData = { systems, stargates: [], scope: { region_ids: [7], version: 1 } }
const targets = systems.map((system, index) => ({
  key: `target:${index}`, character_name: `Pilot ${index}`, ship_type: 'Nyx', count: 1,
  latest: { status: 'active', location_kind: 'system', location_id: system.system_id,
    location_name: system.name, observed_at: '2026-09-24T12:00:00Z' },
}))

function Harness() {
  const [selectedKey, setSelectedKey] = useState(null)
  window.__pirateSetSelectedKey = setSelectedKey
  return <div style={{ width: 1200, height: 700 }}>
    <PirateIntelMap mapData={mapData} targets={targets} selectedKey={selectedKey}
      onSelectTarget={target => setSelectedKey(target.key)} />
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
