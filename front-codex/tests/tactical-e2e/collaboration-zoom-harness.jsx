import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CollaborationMap from '../../src/components/tactical/CollaborationMap'

const previewSystems = [
  { system_id: 1, name: 'Preview-A', zh_name: '预览甲', region_id: 7, x: 0, z: 0, security_status: -0.7 },
  { system_id: 2, name: 'Preview-B', zh_name: '预览乙', region_id: 7, x: 100, z: 0, security_status: -0.2 },
  { system_id: 3, name: 'Preview-C', zh_name: '预览丙', region_id: 7, x: 0, z: 100, security_status: 0.6 },
]
const incomingSystem = { system_id: 4, name: 'Preview-D', zh_name: '预览丁', region_id: 7, x: 100, z: 100, security_status: 0.1 }

const denseSystems = Array.from({ length: 900 }, (_, index) => {
  const column = index % 30
  const row = Math.floor(index / 30)
  return {
    system_id: index + 1,
    name: `Dense-${index + 1}`,
    zh_name: `密集${index + 1}`,
    region_id: 7,
    x: column * 100,
    z: row * 100,
    security_status: -0.7,
  }
})
const denseGates = denseSystems.slice(1).map((system, index) => ({
  system_id: denseSystems[index].system_id,
  destination_system_id: system.system_id,
}))
const denseReports = denseSystems.map(system => ({
  id: system.system_id,
  system_id: system.system_id,
  report_kind: 'system_count',
  status: 'pending',
  people: 1,
  observed_at: '2026-09-26T00:00:00Z',
}))

function Harness() {
  const [revision, setRevision] = useState(0)
  window.__collabTriggerRerender = () => setRevision(value => value + 1)
  const dense = new URLSearchParams(window.location.search).get('dense') === '1'
  const denseIntel = new URLSearchParams(window.location.search).get('intel') === '1'
  const systems = dense ? denseSystems : previewSystems
  const renderedSystems = revision && !dense ? [...systems, incomingSystem] : systems
  return <div style={{ width: 1200, height: 700 }}>
    <CollaborationMap systems={renderedSystems} stargates={dense ? denseGates : [
      { system_id: 1, destination_system_id: 2 },
      { system_id: 1, destination_system_id: 3 },
    ]} reports={dense && denseIntel ? denseReports : []} scope={{ region_ids: [7], version: 1 }} selectedSystemId={1}
      onSelectSystem={() => {}} />
    <output data-harness-revision={revision} hidden>{revision}</output>
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
