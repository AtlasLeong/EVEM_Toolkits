export function boundsOf(nodes) {
  if (!nodes.length) return {minX:0,maxX:1,minY:0,maxY:1};
  return {minX:Math.min(...nodes.map(n=>n.px)),maxX:Math.max(...nodes.map(n=>n.px)),minY:Math.min(...nodes.map(n=>n.py)),maxY:Math.max(...nodes.map(n=>n.py))};
}

export const screenNodes = (nodes, view) => nodes.map(node=>({...node,px:node.px*view.zoom+view.panX,py:node.py*view.zoom+view.panY}));

// Compact a stable graph traversal, not a report-dependent force simulation.
// The grid is schematic; only explicitly supplied gates become connections.
export function compactTopology(nodes, spacingX=220, spacingY=135) {
  const columns=Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  return nodes.map((node,index)=>{
    const row=Math.floor(index/columns), col=index%columns;
    return {...node,px:(row%2 ? columns-1-col : col)*spacingX,py:row*spacingY};
  });
}

export const rectanglesOverlap = (a,b) => a.x<b.x+b.width && a.x+a.width>b.x && a.y<b.y+b.height && a.y+a.height>b.y;

export function layoutSystemLabels(nodes, {selectedId, forceIds=new Set(), targetIds=new Set(), width, height, padding={left:0,right:0,top:0,bottom:0}, occupied=[]}={}) {
  const priority = node => Number(node.system_id)===Number(selectedId) ? 0 : targetIds.has(Number(node.system_id)) ? 1 : forceIds.has(Number(node.system_id)) ? 2 : 3;
  const ordered=[...nodes].sort((a,b)=>priority(a)-priority(b)||Number(a.system_id)-Number(b.system_id));
  const placed=[];
  for(const node of ordered) {
    const name=node.zh_name||node.name||String(node.system_id);
    const w=Math.max(50,Array.from(name).reduce((sum,c)=>sum+(c.charCodeAt(0)>255?13:8),0)+8), h=35;
    const candidates=[
      [node.px-w/2,node.py+16],[node.px-w/2,node.py-16-h],
      [node.px+16,node.py-h/2],[node.px-16-w,node.py-h/2],
    ];
    for(const [x,y] of candidates) {
      const rect={x,y,width:w,height:h};
      if(x<(padding.left||0)||y<(padding.top||0)||x+w>width-(padding.right||0)||y+h>height-(padding.bottom||0)) continue;
      if([...occupied,...placed].some(other=>rectanglesOverlap(rect,other))) continue;
      // Keep labels off unrelated star centres as well as other text.
      if(nodes.some(other=>other!==node && rectanglesOverlap(rect,{x:other.px-6,y:other.py-6,width:12,height:12}))) continue;
      placed.push({...rect,system_id:node.system_id,name});
      break;
    }
  }
  return placed;
}

export function moveTarget(nodes, point, allowed, radius=30) {
  const candidates=nodes.filter(n=>allowed.has(Number(n.system_id))).map(node=>({node,d:Math.hypot(node.px-point.x,node.py-point.y)})).filter(n=>n.d<=radius).sort((a,b)=>a.d-b.d||Number(a.node.system_id)-Number(b.node.system_id));
  if(!candidates.length || (candidates.length>1 && candidates[1].d-candidates[0].d<6)) return null;
  return candidates[0].node;
}
