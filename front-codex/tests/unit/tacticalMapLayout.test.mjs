import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryPortals,
  buildConstellationOverview,
  fitCamera,
  nearestSystemAt,
  projectSystemsScoped,
  summarizeOverviewForces,
  zoomAroundPoint,
} from "../../src/utils/tacticalMapLayout.js";

const systems = [
  { system_id: 1, constellation_id: 10, zh_name: "核心一", x: 0, z: 0 },
  { system_id: 2, constellation_id: 10, zh_name: "核心二", x: 10, z: 10 },
  { system_id: 3, constellation_id: 20, zh_name: "边缘一", x: 100, z: 0 },
  // This is a loaded boundary system, but it must not decide the core fit.
  { system_id: 99, constellation_id: 99, zh_name: "范围外", x: 10000, z: 10000 },
];

test("scoped projection uses fitIds instead of boundary outliers", () => {
  const points = projectSystemsScoped(systems, {
    fitIds: [1, 2, 3],
    width: 1000,
    height: 600,
    padding: { left: 100, right: 100, top: 60, bottom: 60 },
  });
  const core = points.filter((point) => point.system_id !== 99);
  assert.ok(core.every((point) => point.px >= 100 && point.px <= 900));
  assert.ok(core.every((point) => point.py >= 60 && point.py <= 540));
  assert.ok(points.find((point) => point.system_id === 99).px > 900);
});

test("constellation overview is deterministic for shuffled inputs and keeps gate endpoints", () => {
  const constellations = [
    { constellation_id: 20, region_id: 2, zh_name: "二号星座" },
    { constellation_id: 10, region_id: 1, zh_name: "一号星座" },
  ];
  const gates = [
    { system_id: 2, destination_system_id: 3 },
    { system_id: 1, destination_system_id: 2 },
    { system_id: 3, destination_system_id: 99 },
  ];
  const first = buildConstellationOverview(systems, gates, constellations);
  const second = buildConstellationOverview([...systems].reverse(), [...gates].reverse(), [...constellations].reverse());
  assert.deepEqual(second, first);
  assert.deepEqual(first.nodes.map(({ id }) => id), [10, 20, 99]);
  assert.ok(first.edges.some((edge) => edge.source_id === 10 && edge.destination_id === 20));
  assert.ok(first.edges.some((edge) => edge.source_id === 20 && edge.destination_id === 99));
  assert.deepEqual(first.edges[0], {
    id: "10:20",
    source_id: 10,
    destination_id: 20,
    gate_pairs: [{ source_system_id: 2, destination_system_id: 3 }],
  });
});

test("force summaries do not mutate or change static overview geometry", () => {
  const overview = buildConstellationOverview(systems.slice(0, 3), [{ system_id: 2, destination_system_id: 3 }], [
    { constellation_id: 10, region_id: 1, zh_name: "一号星座" },
    { constellation_id: 20, region_id: 2, zh_name: "二号星座" },
  ]);
  const before = JSON.stringify(overview.nodes);
  const summary = summarizeOverviewForces([
    { id: 1, system_id: 1, side: "enemy", people: 4 },
    { id: 2, system_id: 3, side: "friendly", people: 9 },
  ], systems);
  assert.deepEqual(summary, {
    10: { forces: 1, knownPeople: 4, enemyForces: 1, friendlyForces: 0 },
    20: { forces: 0, knownPeople: 0, enemyForces: 0, friendlyForces: 1 },
  });
  assert.equal(JSON.stringify(overview.nodes), before);
});

test("nearest hit testing chooses the closest valid system, not the first candidate", () => {
  const nodes = [
    { system_id: 1, px: 110, py: 100 },
    { system_id: 2, px: 102, py: 100 },
    { system_id: 3, px: 300, py: 200, valid: false },
  ];
  assert.equal(nearestSystemAt(nodes, { x: 105, y: 100 }, 20).system_id, 2);
  assert.equal(nearestSystemAt(nodes, { x: 190, y: 100 }, 20), null);
});

test("camera fitting honors asymmetric safe padding and pointer anchored zoom", () => {
  const camera = fitCamera({ minX: 0, maxX: 1000, minY: 0, maxY: 500 }, { width: 1400, height: 900 }, {
    left: 80,
    right: 420,
    top: 120,
    bottom: 60,
  });
  assert.equal(camera.zoom, 0.9);
  assert.deepEqual({ x: camera.panX, y: camera.panY }, { x: 80, y: 255 });
  const zoomed = zoomAroundPoint(camera, { x: 500, y: 400 }, 2, { min: 0.45, max: 3 });
  assert.equal(zoomed.zoom, 1.8);
  assert.deepEqual({ x: zoomed.panX, y: zoomed.panY }, { x: -340, y: 110 });
});

test("boundary portals preserve both endpoints without becoming core map nodes", () => {
  assert.deepEqual(boundaryPortals([
    {
      source_system_id: 3,
      source_name: "边缘一",
      destination_system_id: 400,
      destination_name: "范围外星系",
      destination_constellation_id: 88,
    },
  ]), [{
    id: "3:400",
    source_system_id: 3,
    source_name: "边缘一",
    destination_system_id: 400,
    destination_name: "范围外星系",
    destination_constellation_id: 88,
    label: "范围外星系",
    outside: true,
  }]);
});
