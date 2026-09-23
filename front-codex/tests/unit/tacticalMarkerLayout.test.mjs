import test from "node:test";
import assert from "node:assert/strict";
import * as markerLayout from "../../src/utils/tacticalMarkerLayout.js";

const { layoutForceMarkers, markerWidth, rememberVisibleMarkerSlots, translateMarkerGroups } = markerLayout;

const group = (id, rows = 1) => ({ system_id: id, visible: Array.from({ length: rows }, (_, index) => ({ id: `${id}-${index}` })), hiddenCount: 0 });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

test("marker width follows label length while staying within safe bounds", () => {
  const short = markerWidth("敌 · 68 人");
  const long = markerWidth("前沿斥候上报 · 德里克一 · 68 人");
  const huge = markerWidth("前沿斥候上报 · ".padEnd(200, "很长"));
  assert.ok(short >= 76);
  assert.ok(long > short);
  assert.ok(huge <= 180);
});

test("report marker width can be supplied per group without changing force layout shape", () => {
  const [badge] = layoutForceMarkers([
    { ...group(1), markerWidth: markerWidth("前沿斥候上报 · 德里克一") },
  ], [{ system_id: 1, px: 500, py: 285 }]);
  assert.ok(badge.width > 104);
  assert.equal(badge.rows, 1);
  assert.ok("leader" in badge);
});

test("a single force badge stays close above its star at laptop scale", () => {
  const [badge] = layoutForceMarkers([group(1)], [{ system_id: 1, px: 500, py: 285 }], 1.4);
  assert.equal(badge.rows, 1);
  assert.ok(badge.width <= 110 * 1.4);
  assert.ok(Math.abs(badge.y + badge.height - 285) <= 12 * 1.4);
  assert.ok(285 - badge.y <= 42 * 1.4, "one row must not reserve three-row stack space");
});

test("actual rows determine stack height and its leader ends at the associated star", () => {
  const [badge] = layoutForceMarkers([{ ...group(1, 2), hiddenCount: 8 }], [{ system_id: 1, px: 500, py: 285 }], 1);
  assert.equal(badge.rows, 3);
  assert.equal(badge.height, 3 * badge.rowHeight + 2 * badge.rowGap);
  assert.deepEqual(badge.leader.to, { x: 500, y: 285 });
  assert.ok(Math.hypot(badge.leader.from.x - 500, badge.leader.from.y - 285) <= 12);
});

test("neighboring groups avoid each other and unrelated star centers", () => {
  const nodes = [{ system_id: 1, px: 490, py: 300 }, { system_id: 2, px: 540, py: 300 }, { system_id: 3, px: 440, py: 267 }];
  const badges = layoutForceMarkers([group(1), group(2)], nodes, 1.4);
  assert.equal(badges.length, 2);
  assert.equal(overlaps(badges[0], badges[1]), false);
  for (const badge of badges) for (const node of nodes.filter((node) => node.system_id !== badge.system_id)) {
    assert.equal(overlaps(badge, { x: node.px - 5, y: node.py - 5, width: 10, height: 10 }), false);
  }
});

test("edge badges remain within the map and missing stars produce no phantom marker", () => {
  const badges = layoutForceMarkers([group(1), group(2, 2), group(404)], [{ system_id: 1, px: 910, py: 80 }, { system_id: 2, px: 90, py: 490 }], 1.4);
  assert.equal(badges.length, 2);
  assert.ok(badges.every((badge) => badge.x >= 12 && badge.x + badge.width <= 988 && badge.y >= 65 && badge.y + badge.height <= 540));
});

test("wide viewport edge badges stay near their star instead of the old fixed right edge", () => {
  const [badge] = layoutForceMarkers([group(1)], [{ system_id: 1, px: 1570, py: 100 }], 1,
    { width: 1600, height: 700 });
  assert.ok(badge.x > 1400);
  assert.ok(badge.x + badge.width <= 1588);
  assert.ok(Math.hypot(badge.leader.from.x - 1570, badge.leader.from.y - 100) <= 12);
});

test("tall viewport bottom badges are clamped to its actual boundaries", () => {
  const [badge] = layoutForceMarkers([group(1, 2)], [{ system_id: 1, px: 570, py: 1150 }], 1,
    { width: 600, height: 1200 });
  assert.ok(badge.y > 1000);
  assert.ok(badge.x >= 12 && badge.x + badge.width <= 588);
  assert.ok(badge.y >= 65 && badge.y + badge.height <= 1170);
});

test("marker padding keeps edge stacks outside fixed toolbar and drawer safe areas", () => {
  const viewport = { width: 1400, height: 900, padding: { left: 50, right: 300, top: 120, bottom: 80 } };
  const badges = layoutForceMarkers([group(1, 2), group(2, 2)], [
    { system_id: 1, px: 50, py: 120 },
    { system_id: 2, px: 1100, py: 820 },
  ], 1, viewport);
  assert.equal(badges.length, 2);
  assert.ok(badges.every((badge) => badge.x >= 50 && badge.x + badge.width <= 1100 && badge.y >= 120 && badge.y + badge.height <= 820));
});

test('fleet badges avoid a floating search and side-filter panel when a nearby clear position exists', () => {
  const controls = { x: 20, y: 190, width: 300, height: 82 };
  const [badge] = layoutForceMarkers([{ ...group(1), markerWidth: 160 }],
    [{ system_id: 1, px: 190, py: 218 }], 1,
    { width: 1100, height: 720, reservedRects: [controls], padding: { left: 16, right: 16, top: 175, bottom: 60 } });
  assert.equal(overlaps(badge, controls), false, 'the visible force badge must not sit beneath the search/filter controls');
  assert.ok(Math.hypot(badge.leader.from.x - 190, badge.leader.from.y - 218) <= 150,
    'the badge still belongs visually to its real star');
});

test('floating UI reservations do not reorder or mutate source systems across repeated layouts', () => {
  const nodes = [{ system_id: 1, px: 190, py: 218 }, { system_id: 2, px: 420, py: 238 }];
  const controls = { x: 20, y: 190, width: 300, height: 82 };
  const options = { width: 1100, height: 720, reservedRects: [controls], padding: { left: 16, right: 16, top: 175, bottom: 60 } };
  const first = layoutForceMarkers([group(1), group(2)], nodes, 1, options);
  const second = layoutForceMarkers([group(1), group(2)], nodes, 1, options);
  assert.deepEqual(first, second);
  assert.deepEqual(nodes, [{ system_id: 1, px: 190, py: 218 }, { system_id: 2, px: 420, py: 238 }]);
  assert.deepEqual(controls, { x: 20, y: 190, width: 300, height: 82 });
});

test('reserved map controls do not trade UI overlap for force-on-force overlap in a dense flank', () => {
  const controls = { x: 20, y: 190, width: 300, height: 82 };
  const nodes = [
    {system_id:1,px:190,py:218}, {system_id:2,px:260,py:246},
    {system_id:3,px:340,py:260}, {system_id:4,px:420,py:275},
  ];
  const badges = layoutForceMarkers(nodes.map(node => ({...group(node.system_id),markerWidth:136})),nodes,1,
    {width:1100,height:720,reservedRects:[controls],padding:{left:16,right:16,top:175,bottom:60}});
  assert.equal(badges.length,4);
  for(const [index,badge] of badges.entries()) {
    assert.equal(overlaps(badge,controls),false,`fleet ${badge.system_id} avoids the search panel`);
    for(const other of badges.slice(index+1))
      assert.equal(overlaps(badge,other),false,`fleets ${badge.system_id}/${other.system_id} stay separate`);
    assert.ok(Math.hypot(badge.leader.from.x-badge.node.px,badge.leader.from.y-badge.node.py)<=170,
      `fleet ${badge.system_id} stays visually near its star`);
  }
});

test('short fleet rows are centered within their stack instead of left aligned', () => {
  const [stack] = layoutForceMarkers([{...group(1,2),markerWidth:180,
    visible:[{id:1,markerWidth:90},{id:2,markerWidth:180}],hiddenCount:2}],
    [{system_id:1,px:500,py:350}],1,{width:1000,height:800});
  assert.deepEqual(stack.rowOffsets,[45,0]);
  stack.rowWidths.forEach((width,index)=>assert.equal(stack.rowOffsets[index]+width/2,stack.width/2));
  assert.equal(stack.x+stack.width/2,500);
  assert.ok(stack.y+stack.height<350);
});

test('overflow entry has its own centered content width', () => {
  const [stack] = layoutForceMarkers([{...group(1,2),markerWidth:200,
    visible:[{id:1,markerWidth:90},{id:2,markerWidth:200}],hiddenCount:8,overflowWidth:92}],
    [{system_id:1,px:500,py:350}],1,{width:1000,height:800});
  assert.equal(stack.overflowWidth,92);
  assert.equal(stack.overflowOffset,54);
  assert.equal(stack.overflowOffset+stack.overflowWidth/2,stack.width/2);
});

test('dense nearby fleet groups prefer bounded clear callouts over overlapping another fleet', () => {
  // Similar to the central real-map cluster: many adjacent stars compete for
  // the same eight local positions, but clear label space remains nearby.
  const nodes=Array.from({length:40},(_,index)=>({
    system_id:index+1,px:450+(index*17%80),py:320+(index*29%110),
  }));
  const originals=nodes.map(node=>({...node}));
  const groups=nodes.slice(0,8).map((node,index)=>({...group(node.system_id,index===2?2:1),markerWidth:130}));
  const badges=layoutForceMarkers(groups,nodes,1,{width:1000,height:800});
  assert.equal(badges.length,8,'crowding must not silently hide deployments');
  for(const [index,badge] of badges.entries()) {
    for(const other of badges.slice(index+1)) {
      assert.equal(overlaps(badge,other),false,`fleets at ${badge.system_id} and ${other.system_id} overlap`);
    }
    assert.ok(Math.hypot(badge.leader.from.x-badge.node.px,badge.leader.from.y-badge.node.py)<=170,
      'callouts remain bounded near their real star');
  }
  assert.deepEqual(nodes,originals,'decluttering must never move star coordinates');
});

test('a preferred marker slot keeps its side of the star through neighboring zoom levels', () => {
  const baseNodes = [
    {system_id:1,px:450,py:300},
    {system_id:2,px:485,py:315},
    {system_id:3,px:520,py:300},
  ];
  const groups = baseNodes.map(node => ({...group(node.system_id),key:`force-${node.system_id}`,markerWidth:148}));
  const options = {width:1200,height:800};
  const preferredSlots = new Map(layoutForceMarkers(groups,baseNodes,1,options).map(marker => [marker.key,marker.slot]));
  const at = scale => layoutForceMarkers(groups,baseNodes.map(node => ({...node,px:node.px*scale,py:node.py*scale})),1,
    {...options,preferredSlots});
  const first = at(1.3456).find(marker => marker.system_id===1);
  const second = at(1.56).find(marker => marker.system_id===1);
  const side = marker => Math.sign(marker.x+marker.width/2-marker.node.px);
  assert.equal(side(first),side(second),'zoom must not flip a clear callout from the left to the star center');
  assert.equal(first.slot,second.slot,'a clear preferred slot must remain stable');
  assert.equal(typeof first.slot,'number','each placed marker exposes its selected slot');
});

test('a preferred marker slot does not flip over a nearby star clearance fringe', () => {
  const nodes = [
    {system_id:1,px:500,py:350}, {system_id:2,px:568,py:388},
    {system_id:5,px:409,py:390}, {system_id:6,px:597,py:317},
    {system_id:9,px:438,py:319}, {system_id:16,px:549,py:250},
  ];
  const marker = {...group(1),key:'force-1',markerWidth:148};
  const options = {width:1000,height:700,padding:{left:16,right:16,top:175,bottom:60}};
  const base = layoutForceMarkers([marker],nodes,1,options)[0];
  const preferredSlots = new Map([[marker.key,base.slot]]);
  const at = scale => layoutForceMarkers([marker],nodes.map(node => ({...node,
    px:500+(node.px-500)*scale,py:350+(node.py-350)*scale})),1,{...options,preferredSlots})[0];
  const first = at(1.04), second = at(1.05);
  assert.equal(first.slot,second.slot,'a soft clearance margin must not send the badge across its star');
  assert.ok(first.x>=500 && second.x>=500);
});

test('a marker first seen after panning keeps that slot on the next zoom frame', () => {
  assert.equal(typeof rememberVisibleMarkerSlots,'function');
  const nodes = [
    {system_id:1,px:1108,py:269}, {system_id:2,px:1102,py:251},
    {system_id:6,px:1076,py:338},
  ];
  const marker = {...group(1),key:'force-1',markerWidth:148};
  const options = {width:1000,height:700,padding:{left:16,right:16,top:175,bottom:60}};
  assert.equal(layoutForceMarkers([marker],nodes,1,options).length,0,'the initial view cannot choose this slot');
  const at = (scale,panX,panY,preferredSlots) => layoutForceMarkers([marker],nodes.map(node => ({...node,
    px:node.px*scale+panX,py:node.py*scale+panY})),1,{...options,preferredSlots})[0];
  const first = at(1,-458,106);
  const slots = rememberVisibleMarkerSlots(new Map(),[first]);
  const next = at(1.16,-611.28,66.96,slots);
  assert.equal(next.slot,first.slot,'newly visible badge should keep its established direction');
  assert.equal(rememberVisibleMarkerSlots(slots,[{...next,slot:5}]).get(marker.key),first.slot,
    'later layouts must not overwrite its first visible slot');
});
test('marker collision checks keep only stars near the actual candidate rectangles', () => {
  assert.equal(typeof markerLayout.nodesNearMarkerCandidates,'function');
  const own={system_id:1,px:500,py:350};
  const near={system_id:2,px:410,py:328};
  const edge={system_id:3,px:623,py:419};
  const far={system_id:4,px:950,py:650};
  const nodes=[own,near,edge,far];
  const before=JSON.stringify(nodes);
  assert.deepEqual(markerLayout.nodesNearMarkerCandidates(nodes,own,
    {x:400,y:300,width:200,height:100},1),[near,edge]);
  assert.equal(JSON.stringify(nodes),before);
});

test('wheel marker translation keeps card dimensions and follows each owning star', () => {
  const settled = layoutForceMarkers([
    { ...group(1), key: 'force-1', markerWidth: 140 },
  ], [{ system_id: 1, px: 320, py: 260 }], 1, { width: 800, height: 600 });
  const moved = translateMarkerGroups(settled,
    [{ system_id: 1, px: 320, py: 260 }],
    [{ system_id: 1, px: 370, py: 295 }]);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].width, settled[0].width);
  assert.equal(moved[0].height, settled[0].height);
  assert.equal(moved[0].x, settled[0].x + 50);
  assert.equal(moved[0].y, settled[0].y + 35);
  assert.deepEqual(moved[0].leader.to, { x: 370, y: 295 });
});
