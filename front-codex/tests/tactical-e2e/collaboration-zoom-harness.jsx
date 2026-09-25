import { createRoot } from 'react-dom/client'
import CollaborationMap from '../../src/components/tactical/CollaborationMap'

const systems = [
  { system_id: 1, name: 'Preview-A', zh_name: '预览甲', region_id: 7, x: 0, z: 0, security_status: -0.7 },
  { system_id: 2, name: 'Preview-B', zh_name: '预览乙', region_id: 7, x: 100, z: 0, security_status: -0.2 },
  { system_id: 3, name: 'Preview-C', zh_name: '预览丙', region_id: 7, x: 0, z: 100, security_status: 0.6 },
]

function Harness() {
  return <div style={{ width: 1200, height: 700 }}>
    <CollaborationMap systems={systems} stargates={[
      { system_id: 1, destination_system_id: 2 },
      { system_id: 1, destination_system_id: 3 },
    ]} scope={{ region_ids: [7], version: 1 }} selectedSystemId={1}
      onSelectSystem={() => {}} />
  </div>
}

createRoot(document.getElementById('root')).render(<Harness />)
