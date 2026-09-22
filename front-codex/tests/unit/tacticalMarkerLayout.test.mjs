import test from "node:test";
import assert from "node:assert/strict";
import { layoutForceMarkers, markerWidth } from "../../src/utils/tacticalMarkerLayout.js";

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
