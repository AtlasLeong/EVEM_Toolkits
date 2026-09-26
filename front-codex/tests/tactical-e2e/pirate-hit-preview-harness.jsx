import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import PirateIntelMap from '../../src/components/tactical/PirateIntelMap'

const params = new URLSearchParams(location.search)
const count = params.has('dense') ? 5000 : 201
const columns = params.has('dense') ? 100 : 20
const systems = Array.from({ length: count }, (_, index) => ({ system_id: index + 1,
  name: `System ${index + 1}`, region_id: 7, security_status: -.2,
  x: index % columns, z: Math.floor(index / columns),
}))
if (params.has('overlap')) systems[11] = { ...systems[11], x: systems[10].x, z: systems[10].z }
const mapData = { systems, stargates: [], scope: { region_ids: [7], version: 1 } }
const targets = params.has('card') ? [{ key: 'review:111', character_name: 'Review Pilot', ship_type: 'Nyx', count: 1,
  latest: { status: 'active', location_kind: 'system', location_id: 111, location_name: 'System 111',
    observed_at: new Date().toISOString() } }] : []

function Harness() {
  const [selected, setSelected] = useState(null)
  const [focusSystem, setFocusSystem] = useState(null)
  return <div style={{ width: '100vw', height: '100vh' }}>
    <output style={{ position: 'absolute', zIndex: 10, bottom: 0 }} data-testid="selected-system">{selected?.system_id ?? ''}</output>
    <button style={{ position: 'absolute', zIndex: 10, bottom: 0, right: 0 }}
      onClick={() => setFocusSystem({ id: 11, requestId: Date.now() })}>定位 11</button>
    <PirateIntelMap mapData={mapData} targets={targets} onSelectSystem={setSelected} focusSystem={focusSystem}
      selectedSystemId={params.has('selected') ? 1 : params.has('card') ? 111 : undefined} />
  </div>
}
createRoot(document.getElementById('root')).render(<Harness />)
