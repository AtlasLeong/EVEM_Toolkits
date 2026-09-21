import test from "node:test";
import assert from "node:assert/strict";
import { layoutForceMarkers } from "../../src/utils/tacticalMarkerLayout.js";

const group = (id, rows = 1) => ({ system_id: id, visible: Array.from({ length: rows }, (_, index) => ({ id: `${id}-${index}` })), hiddenCount: 0 });
const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

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
