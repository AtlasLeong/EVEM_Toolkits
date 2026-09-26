import {createRoot} from 'react-dom/client';
import CollaborationMap from '../../src/components/tactical/CollaborationMap';

const systems = [
  {system_id:1,name:'Bounds-A',region_id:7,x:0,z:0},
  {system_id:2,name:'Fleet-Star',region_id:7,x:45,z:45},
  {system_id:3,name:'Count-Star',region_id:7,x:85,z:60},
  {system_id:4,name:'Bounds-B',region_id:7,x:120,z:100},
  {system_id:5,name:'Count-Upper-Clearance',region_id:7,x:85,z:65},
];
const observed_at='2026-09-27T00:00:00Z';
createRoot(document.getElementById('root')).render(<div style={{width:1200,height:800}}>
  <CollaborationMap systems={systems} scope={{region_ids:[7],version:1}}
    forces={[{id:11,system_id:2,name:'远炮战列队',system_name:'Fleet-Star',side:'hostile',people:120,observed_at}]}
    reports={[{id:22,system_id:3,report_kind:'system_count',status:'pending',people:30,observed_at}]}
    canArchiveForce canWithdrawCount={()=>true} onArchiveForce={()=>{}} onWithdrawCount={()=>{}}/>
</div>);
