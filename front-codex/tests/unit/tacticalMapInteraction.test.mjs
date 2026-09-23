import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../../src/utils/tacticalMapInteraction.js').catch(() => ({}));
const use = (name,...args) => { assert.equal(typeof module[name],'function',`${name} is not implemented`); return module[name](...args); };
const viewport={width:800,height:600}, view={x:0,y:0,scale:1};
const nodes=[{system_id:1,px:100,py:100,name:'甲'},{system_id:2,px:112,py:100,name:'乙'},{system_id:3,px:500,py:400,name:'丙'}];

test('a near-tie exposes named candidates instead of silently choosing a star',()=>{
  const hit=use('resolveSystemHit',nodes,{x:106,y:100},view,viewport);
  assert.equal(hit.target,null);
  assert.deepEqual(hit.candidates.map(n=>n.system_id),[1,2]);
  assert.equal(hit.ambiguous,true);
  assert.equal(use('resolveSystemHit',nodes,{x:100,y:100},view,viewport).target.system_id,1);
});
test('map leaders stay hidden except for the focused or hovered system',()=>{
  assert.equal(use('shouldShowMapLeader', 42, {}), false);
  assert.equal(use('shouldShowMapLeader', 42, { selectedSystemId: 42 }), true);
  assert.equal(use('shouldShowMapLeader', 42, { hoveredSystemId: 42 }), true);
  assert.equal(use('shouldShowMapLeader', 42, { selectedSystemId: 7, hoveredSystemId: 8 }), false);
  assert.equal(use('shouldShowMapLeader', 'bad', { selectedSystemId: 'bad' }), false);
});
test('focused callouts share at most one nearby leader and do not mutate layout inputs',()=>{
  const groups=[
    {system_id:42,node:{px:400,py:300},leader:{from:{x:400,y:360},to:{x:400,y:300}}},
    {system_id:42,node:{px:400,py:300},leader:{from:{x:500,y:300},to:{x:400,y:300}}},
    {system_id:99,node:{px:250,py:250},leader:{from:{x:250,y:300},to:{x:250,y:250}}},
  ];
  const labels=[{system_id:42,leader:{from:{x:400,y:300},to:{x:430,y:300}}}];
  const before=JSON.stringify({groups,labels});
  const leaders=use('leaderSegmentsForFocus',groups,labels,{selectedSystemId:42,width:800,height:600});
  assert.equal(leaders.length,1);
  assert.equal(leaders[0].system_id,42);
  assert.equal(Math.hypot(leaders[0].to.x-leaders[0].from.x,leaders[0].to.y-leaders[0].from.y),30);
  assert.equal(JSON.stringify({groups,labels}),before);
});
test('focus leaders vanish for a short gap, an offscreen star, or an unrelated system',()=>{
  const short=[{system_id:42,node:{px:400,py:300},leader:{from:{x:400,y:313},to:{x:400,y:300}}}];
  assert.deepEqual(use('leaderSegmentsForFocus',short,[],{selectedSystemId:42,width:800,height:600}),[]);
  assert.deepEqual(use('leaderSegmentsForFocus',short,[],{selectedSystemId:7,width:800,height:600}),[]);
  const offscreen=[{system_id:42,node:{px:-5,py:300},leader:{from:{x:20,y:300},to:{x:-5,y:300}}}];
  assert.deepEqual(use('leaderSegmentsForFocus',offscreen,[],{selectedSystemId:42,width:800,height:600}),[]);
});
test('a close star name does not suppress the one useful leader to a displaced fleet',()=>{
  const [label]=use('layoutIntelLabels',[{system_id:42,px:400,py:300,name:'甲'}],{width:800,height:600});
  const group={system_id:42,node:{px:400,py:300},leader:{from:{x:400,y:240},to:{x:400,y:300}}};
  const leaders=use('leaderSegmentsForFocus',[group],[label],{selectedSystemId:42,width:800,height:600});
  assert.equal(Math.hypot(label.leader.from.x-label.leader.to.x,label.leader.from.y-label.leader.to.y),13);
  assert.equal(leaders.length,1);
  assert.deepEqual(leaders[0].from,group.leader.from);
  assert.deepEqual(leaders[0].to,group.leader.to);
});
test('blank space, offscreen stars and pointer outside the map are not drop targets',()=>{
  for (const p of [{x:300,y:300},{x:-1,y:100},{x:801,y:100}]) assert.equal(use('resolveSystemHit',nodes,p,view,viewport).target,null);
  assert.equal(use('resolveSystemHit',[{system_id:4,px:-5,py:100}],{x:1,y:100},view,viewport).target,null);
});
test('hit testing uses current screen transform and does not mutate real positions',()=>{
  const before=JSON.stringify(nodes);
  assert.equal(use('resolveSystemHit',nodes,{x:220,y:210},{x:20,y:10,scale:2},viewport).target.system_id,1);
  assert.equal(JSON.stringify(nodes),before);
});
test('dense focus enlarges real-coordinate separation and fits target neighborhood',()=>{
  const before=JSON.stringify(nodes);
  const next=use('focusDenseArea',nodes.slice(0,2),view,viewport);
  assert.ok(next.scale>=4 && next.scale<=16);
  assert.equal((100+112)/2*next.scale+next.x,400);
  assert.equal(100*next.scale+next.y,300);
  assert.equal(JSON.stringify(nodes),before);
});
test('coincident systems remain at exact same coordinates with bounded zoom for candidate picking',()=>{
  const same=[{system_id:1,px:5,py:5},{system_id:2,px:5,py:5}];
  const next=use('focusDenseArea',same,view,viewport);
  assert.equal(next.scale,16);
  assert.ok(Number.isFinite(next.x)&&Number.isFinite(next.y));
  assert.equal(use('resolveSystemHit',same,{x:400,y:300},next,viewport).ambiguous,true);
});
test('manual drag allows loaded non-neighbor but rejects stale source or permission changes',()=>{
  const force={id:9,system_id:1,version:3};
  assert.equal(use('validateDirectMove',force,[force],3,nodes,true).ok,true);
  for(const [live,target,allowed] of [[[force],1,true],[[force],999,true],[[{...force,version:4}],3,true],[[{...force,system_id:2}],3,true],[[force],3,false],[[],3,true]]) {
    assert.equal(use('validateDirectMove',force,live,target,nodes,allowed).ok,false);
  }
});
test('labels prioritize system intelligence and selection, avoid collisions without moving stars',()=>{
  const crowded=Array.from({length:12},(_,i)=>({system_id:i+1,px:200+i*3,py:240,name:`星系${i+1}`}));
  const before=JSON.stringify(crowded);
  const labels=use('layoutIntelLabels',crowded,{width:800,height:600,selectedId:5,intelById:new Map([[8,{people:68}]]),zoom:1});
  assert.ok(labels.some(l=>l.system_id===5));
  assert.ok(labels.some(l=>l.system_id===8&&l.intel.people===68));
  for(let i=0;i<labels.length;i++) for(let j=i+1;j<labels.length;j++) {
    const a=labels[i],b=labels[j];
    assert.ok(!(a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y));
  }
  assert.equal(JSON.stringify(crowded),before);
  assert.ok(labels.every(l=>l.leader && l.width>=50));
});
test('map wheel listener explicitly cancels native scrolling and is fully detached',()=>{
  const target=new EventTarget();
  let count=0, options;
  const add=target.addEventListener.bind(target);
  target.addEventListener=(type,handler,config)=>{options=config;add(type,handler,config);};
  const cleanup=use('subscribeMapWheel',target,()=>count++);
  const event=new Event('wheel',{cancelable:true});
  target.dispatchEvent(event);
  assert.equal(options.passive,false);
  assert.equal(event.defaultPrevented,true);
  assert.equal(count,1);
  cleanup();
  target.dispatchEvent(new Event('wheel',{cancelable:true}));
  assert.equal(count,1);
});
test('wheel labels follow their own star without resolving a new layout',()=>{
  const settled=[{system_id:1,x:180,y:212,width:60,height:34,name:'甲',leader:{from:{x:200,y:200},to:{x:210,y:212}}},
    {system_id:2,x:500,y:400,width:60,height:34,name:'乙'}];
  const before=JSON.stringify(settled);
  const moved=use('translateWheelLabels',settled,
    [{system_id:1,px:200,py:200},{system_id:2,px:520,py:390}],
    [{system_id:1,px:260,py:230}]);
  assert.equal(moved.length,1,'a star that left the loaded map must not keep a detached label');
  assert.deepEqual({x:moved[0].x,y:moved[0].y,width:moved[0].width,height:moved[0].height},
    {x:240,y:242,width:60,height:34});
  assert.deepEqual(moved[0].leader,{from:{x:260,y:230},to:{x:270,y:242}});
  assert.equal(JSON.stringify(settled),before,'the settled layout is not mutated');
});
test('wheel frames reuse the settled name choice and resolve changes once when idle',()=>{
  const before=[{system_id:1,px:400,py:300,name:'旧名'}];
  const options={width:800,height:600};
  const labels=use('layoutIntelLabels',before,options);
  const settled={labels,nodes:before};
  const current=[{system_id:1,px:440,py:330,name:'新名'}];
  const frame=use('labelsForWheelFrame',{zooming:true,settled,nodes:current,options});
  assert.equal(frame[0].name,'旧名');
  assert.equal(frame[0].x,labels[0].x+40);
  assert.equal(frame[0].y,labels[0].y+30);
  const idle=use('labelsForWheelFrame',{zooming:false,settled,nodes:current,options});
  assert.equal(idle[0].name,'新名');
});
test('wheel labels keep tactical stars prominent and only dim secondary names',()=>{
  const forceIds=new Set([3]);
  assert.deepEqual(use('wheelLabelState',{system_id:1},{zooming:true,selectedSystemId:1,forceIds}),
    {priority:true,dimmed:false});
  assert.deepEqual(use('wheelLabelState',{system_id:2,intel:{people:68}},{zooming:true,selectedSystemId:1,forceIds}),
    {priority:true,dimmed:false});
  assert.deepEqual(use('wheelLabelState',{system_id:3},{zooming:true,selectedSystemId:1,forceIds}),
    {priority:true,dimmed:false});
  assert.deepEqual(use('wheelLabelState',{system_id:4},{zooming:true,selectedSystemId:1,forceIds}),
    {priority:false,dimmed:true});
  assert.deepEqual(use('wheelLabelState',{system_id:4},{zooming:false,selectedSystemId:1,forceIds}),
    {priority:false,dimmed:false});
});

test('wheel camera consumes one coalesced frame without mutating the settled view',()=>{
  const settled={x:12,y:-8,scale:1};
  const next=use('wheelCameraFrame',{
    view:settled,
    delta:-240,
    anchor:{x:320,y:240},
    viewport:{width:800,height:600},
  });
  assert.notEqual(next.view,settled);
  assert.ok(next.view.scale>settled.scale);
  assert.equal(next.consumedDelta,-240);
  assert.deepEqual(settled,{x:12,y:-8,scale:1});
});

test('label visibility uses hysteresis so a zoom near the threshold does not flicker',()=>{
  assert.deepEqual(use('labelVisibilityState',{visible:false,zoom:1.69}),{visible:false,changed:false});
  assert.deepEqual(use('labelVisibilityState',{visible:false,zoom:1.72}),{visible:true,changed:true});
  assert.deepEqual(use('labelVisibilityState',{visible:true,zoom:1.61}),{visible:true,changed:false});
  assert.deepEqual(use('labelVisibilityState',{visible:true,zoom:1.49}),{visible:false,changed:true});
});

test('label motion phase separates active wheel movement from the short settle fade',()=>{
  assert.equal(use('labelMotionPhase',{zooming:true,settling:false}),'moving');
  assert.equal(use('labelMotionPhase',{zooming:false,settling:true}),'settling');
  assert.equal(use('labelMotionPhase',{zooming:false,settling:false}),'idle');
});
test('label density can stay closed just below the hysteresis entry threshold',()=>{
  const cloud=Array.from({length:12},(_,i)=>({system_id:i+1,px:300+(i%4)*20,py:200+Math.floor(i/4)*20,name:`星系${i+1}`}));
  const legacy=use('layoutIntelLabels',cloud,{width:800,height:600,zoom:1.7});
  const held=use('layoutIntelLabels',cloud,{width:800,height:600,zoom:1.7,showDense:false});
  assert.ok(legacy.length>held.length);
});
test('reported dense stars keep distinct count labels using diagonal callouts',()=>{
  const cloud=Array.from({length:70},(_,i)=>({system_id:i+1,px:300+(i%10)*18,py:200+Math.floor(i/10)*22,name:`星系${i+1}`}));
  const intelById=new Map([24,25,34,35].map(id=>[id,{people:id}]));
  const labels=use('layoutIntelLabels',cloud,{width:1000,height:800,intelById,zoom:1});
  assert.equal(labels.filter(label=>label.intel).length,4);
});
test('system names find nearby clear space when a floating search panel covers the closest slots',()=>{
  const controls={x:20,y:190,width:300,height:82};
  const star={system_id:1,px:190,py:218,name:'拉什希亚'};
  const [label]=use('layoutIntelLabels',[star],{
    width:1100,height:720,occupied:[controls],padding:{left:14,right:14,top:175,bottom:60},
  });
  assert.ok(label,'do not drop a star name if a nearby clear slot exists');
  assert.ok(!(label.x<controls.x+controls.width && label.x+label.width>controls.x &&
    label.y<controls.y+controls.height && label.y+label.height>controls.y));
  assert.ok(Math.hypot(label.leader.to.x-star.px,label.leader.to.y-star.py)<=100);
});
test('a selected system keeps label priority beside the floating search panel',()=>{
  const controls={x:20,y:190,width:300,height:82};
  const stars=[{system_id:1,px:190,py:218,name:'目标星系'},
    {system_id:2,px:220,py:250,name:'邻近星系'}];
  const labels=use('layoutIntelLabels',stars,{
    width:1100,height:720,selectedId:1,occupied:[controls],
    padding:{left:14,right:14,top:175,bottom:60},
  });
  const selected=labels.find(label=>label.system_id===1);
  assert.ok(selected,'selected star is not silently lost behind the controls');
  assert.ok(!(selected.x<controls.x+controls.width && selected.x+selected.width>controls.x &&
    selected.y<controls.y+controls.height && selected.y+selected.height>controls.y));
});
test('labels choose a nearby gate-free slot before one crossed by a real vertical gate',()=>{
  const stars=[{system_id:1,px:400,py:300,name:'甲'}];
  const gateSegments=[{x1:400,y1:300,x2:400,y2:500}];
  const before=JSON.stringify({stars,gateSegments});
  const [label]=use('layoutIntelLabels',stars,{width:800,height:600,gateSegments});
  assert.ok(label.y+label.height<300);
  assert.equal(label.gateBackdrop,false);
  assert.equal(JSON.stringify({stars,gateSegments}),before);
});
test('spatial gate index keeps an unrelated crossing line away from a star label',()=>{
  const stars=[{system_id:1,px:400,py:300,name:'甲'}];
  const gates=[{system_id:2,destination_system_id:3,x1:350,y1:330,x2:450,y2:330}];
  const before=JSON.stringify({stars,gates});
  const gateSegments=use('indexGateSegments',gates,{width:800,height:600});
  const [label]=use('layoutIntelLabels',stars,{width:800,height:600,gateSegments});
  assert.ok(label.y+label.height<300);
  assert.equal(label.gateBackdrop,false);
  assert.equal(JSON.stringify({stars,gates}),before);
});
test('gate crossing recognizes finite horizontal, vertical, and diagonal segments',()=>{
  const rect={x:10,y:10,width:20,height:20};
  for(const segment of [
    {x1:20,y1:0,x2:20,y2:40},
    {x1:0,y1:20,x2:40,y2:20},
    {x1:0,y1:0,x2:40,y2:40},
  ]) assert.equal(use('segmentIntersectsRect',segment,rect),true);
  for(const segment of [
    {x1:31,y1:0,x2:31,y2:40},
    {x1:Infinity,y1:0,x2:20,y2:40},
  ]) assert.equal(use('segmentIntersectsRect',segment,rect),false);
});
test('a label gets a compact backdrop when every legal position crosses a gate',()=>{
  const center={x:400,y:300};
  const gateSegments=[
    [400,0],[400,600],[0,300],[800,300],
    [0,-100],[800,-100],[0,700],[800,700],
  ].map(([x2,y2])=>({x1:center.x,y1:center.y,x2,y2}));
  const [label]=use('layoutIntelLabels',[{system_id:1,px:center.x,py:center.y,name:'甲'}],{
    width:800,height:600,gateSegments,
  });
  assert.equal(label.gateBackdrop,true);
  assert.ok(Math.hypot(label.x+label.width/2-center.x,label.y+label.height/2-center.y)<100);
});
test('near crossed label with backdrop beats a clear label more than 90px away',()=>{
  const occupied=[
    {x:0,y:0,width:800,height:300},
    {x:0,y:300,width:365,height:300},
    {x:435,y:300,width:365,height:300},
  ];
  const [label]=use('layoutIntelLabels',[{system_id:1,px:400,py:300,name:'甲'}],{
    width:800,height:600,occupied,gateSegments:[{x1:400,y1:310,x2:400,y2:391}],
  });
  assert.equal(label.y,313);
  assert.equal(label.gateBackdrop,true);
});
test('a reported label uses free upper-right space when cardinal and opposite-diagonal positions are blocked',()=>{
  const occupied=[{x:0,y:0,width:1000,height:235},{x:0,y:235,width:409,height:565},
    {x:493,y:235,width:507,height:565},{x:409,y:291,width:84,height:509}];
  const labels=use('layoutIntelLabels',[{system_id:1,px:400,py:300,name:'甲'}],{
    width:1000,height:800,intelById:new Map([[1,{people:1}]]),occupied,zoom:1,
  });
  assert.equal(labels.length,1);
  assert.ok(labels[0].x>400 && labels[0].y+labels[0].height<300);
});

test('reported star labels reserve only uniform name and security lines, not a duplicated large enemy count',()=>{
  const [ordinary]=use('layoutIntelLabels',[{system_id:1,px:400,py:300,name:'甲'}],{width:800,height:600});
  const [reported]=use('layoutIntelLabels',[{system_id:1,px:400,py:300,name:'甲'}],{
    width:800,height:600,intelById:new Map([[1,{people:999999}]]),
  });
  assert.equal(reported.height,ordinary.height);
  assert.equal(reported.width,ordinary.width);
  assert.equal(reported.intel.people,999999);
});
