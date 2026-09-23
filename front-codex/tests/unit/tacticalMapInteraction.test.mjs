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
test('reported dense stars keep distinct count labels using diagonal callouts',()=>{
  const cloud=Array.from({length:70},(_,i)=>({system_id:i+1,px:300+(i%10)*18,py:200+Math.floor(i/10)*22,name:`星系${i+1}`}));
  const intelById=new Map([24,25,34,35].map(id=>[id,{people:id}]));
  const labels=use('layoutIntelLabels',cloud,{width:1000,height:800,intelById,zoom:1});
  assert.equal(labels.filter(label=>label.intel).length,4);
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
