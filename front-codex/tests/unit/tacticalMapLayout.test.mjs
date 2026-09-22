import test from "node:test";
import assert from "node:assert/strict";
import {
  boundaryPortals,
  buildConstellationOverview,
  fitCamera,
  labelStepForZoom,
  layoutTopology,
  nearestSystemAt,
  nearestVisibleSystemAt,
  projectReportMarkers,
  projectSystemsScoped,
  systemDisplayName,
  summarizeOverviewForces,
  validateMoveDrop,
  visibleGateExits,
  zoomAroundPoint,
} from "../../src/utils/tacticalMapLayout.js";

test('drag drop rejects off-screen pointers and off-screen stars even within hit radius', () => {
  const nodes=[{system_id:1,px:200,py:100},{system_id:2,px:505,py:100}];
  const view={x:0,y:0,scale:1}, viewport={width:500,height:400};
  assert.equal(nearestVisibleSystemAt(nodes,{x:505,y:100},view,viewport),null);
  assert.equal(nearestVisibleSystemAt(nodes,{x:499,y:100},view,viewport),null);
  assert.equal(nearestVisibleSystemAt(nodes,{x:205,y:100},view,viewport).system_id,1);
  assert.equal(nearestVisibleSystemAt(nodes,{x:400,y:200},{x:0,y:0,scale:2},viewport).system_id,1);
});

test("report markers stay independent from force summaries and preserve reporter evidence", () => {
  const reports = [
    {
      id: 7,
      status: "pending",
      system_id: 1,
      system_name: "德里克一",
      author_name: "前沿斥候",
      people: 68,
      ships: { cruiser: 12 },
      notes: "西侧星门",
    },
    { id: 8, status: "confirmed", system_id: 1, author_name: "旧情报" },
    { id: 9, status: "corrected", system_id: 1, author_name: "前沿斥候" },
    { id: 10, status: "pending", system_id: 404, author_name: "范围外" },
  ];
  const systems = [{ system_id: 1, px: 120, py: 240 }];
  const markers = projectReportMarkers(reports, systems);
  assert.deepEqual(markers.map((marker) => marker.id), [7, 9]);
  assert.deepEqual(markers[0], {
    id: 7,
    report_id: 7,
    system_id: 1,
    system_name: "德里克一",
    author_name: "前沿斥候",
    people: 68,
    ships: { cruiser: 12 },
    notes: "西侧星门",
    status: "pending",
    px: 120,
    py: 240,
  });
  const forces = [{ side: "enemy", people: 20, system_id: 1 }];
  assert.deepEqual(
    summarizeOverviewForces(forces, systems),
    summarizeOverviewForces(forces, systems, reports),
  );
});

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

test("system labels always have a readable fallback", () => {
  assert.equal(systemDisplayName({ system_id: 7, zh_name: "  德里克  " }), "德里克");
  assert.equal(systemDisplayName({ system_id: 7, zh_name: "", name: "Derelik" }), "Derelik");
  assert.equal(systemDisplayName({ system_id: 7 }), "星系 7");
});

test("label density increases with zoom instead of hiding most local systems", () => {
  assert.equal(labelStepForZoom(128, 1), 8);
  assert.equal(labelStepForZoom(128, 2), 2);
  assert.equal(labelStepForZoom(128, 3), 1);
});

test("invalid drag targets return a user-facing movement reason", () => {
  const gates = [{ system_id: 1, destination_system_id: 2 }];
  assert.deepEqual(validateMoveDrop(gates, 1, 2), { ok: true, destination_system_id: 2 });
  assert.deepEqual(validateMoveDrop(gates, 1, 9), {
    ok: false,
    reason: "只能拖到相邻星门连接的星系；远程纠正请使用“移动部队”。",
  });
  assert.deepEqual(validateMoveDrop(gates, 1, null), {
    ok: false,
    reason: "请将部队拖到相邻星系。",
  });
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

test("topology layout is a deterministic non-overlapping BFS grid", () => {
  const nodes = [
    { system_id: 30, zh_name: "Gamma", side: "enemy" },
    { system_id: 10, zh_name: "Alpha", side: "friendly" },
    { system_id: 20, zh_name: "Beta", side: "enemy" },
    { system_id: 40, zh_name: "Delta", side: "friendly" },
  ];
  const edges = [
    { source_id: 20, destination_id: 40 },
    { source_id: 10, destination_id: 20 },
    { source_id: 20, destination_id: 30 },
  ];
  const first = layoutTopology(nodes, edges, { spacingX: 220, spacingY: 120 });
  const second = layoutTopology([...nodes].reverse(), [...edges].reverse(), { spacingX: 220, spacingY: 120 });
  assert.deepEqual(second, first);
  assert.deepEqual(first.map(({ system_id }) => system_id), [10, 20, 30, 40]);
  assert.deepEqual(first.map(({ system_id, px, py }) => ({ system_id, px, py })), [
    { system_id: 10, px: 0, py: 0 },
    { system_id: 20, px: 220, py: 0 },
    { system_id: 30, px: 440, py: 0 },
    { system_id: 40, px: 440, py: 120 },
  ]);
  assert.equal(new Set(first.map(({ px, py }) => `${px}:${py}`)).size, first.length);
  assert.equal(first[0].side, "friendly");
});

test("visible gate exits include loaded cross-constellation systems and external boundary exits", () => {
  const systems = [
    { system_id: 1, zh_name: "Alpha" },
    { system_id: 2, zh_name: "Beta" },
    { system_id: 3, zh_name: "Gamma" },
  ];
  const gates = [
    { id: 301, system_id: 1, destination_system_id: 2 },
    { id: 302, source_id: 1, destination_id: 3, destination_name: "Gamma" },
    { id: 303, source_id: 1, destination_id: 3, destination_name: "Gamma" },
    { id: 304, source_id: 2, destination_id: 1 },
  ];
  const boundaryExits = [
    { id: "portal-9", source_system_id: 1, destination_system_id: 99, destination_name: "范围外星系" },
  ];
  assert.deepEqual(visibleGateExits(systems, gates, boundaryExits, [1]), [
    { id: 301, source_system_id: 1, destination_system_id: 2, destination_name: "Beta", loaded: true },
    { id: 302, source_system_id: 1, destination_system_id: 3, destination_name: "Gamma", loaded: true },
    { id: "portal-9", source_system_id: 1, destination_system_id: 99, destination_name: "范围外星系", loaded: false },
  ]);
});

test("constellation overview filters empty constellations, sums in sorted order, and orients reverse gates consistently", () => {
  const unordered = [
    { system_id: 3, constellation_id: 10, x: 1e16 + 4, z: 0 },
    { system_id: 1, constellation_id: 10, x: 1e16, z: 0 },
    { system_id: 2, constellation_id: 10, x: -(1e16), z: 0 },
    { system_id: 9, constellation_id: 20, x: 100, z: 100 },
  ];
  const overview = buildConstellationOverview(unordered, [
    { system_id: 9, destination_system_id: 1 },
    { system_id: 1, destination_system_id: 9 },
  ], [
    { constellation_id: 99, region_id: 1, zh_name: "空星座" },
    { constellation_id: 10, region_id: 1, zh_name: "核心" },
    { constellation_id: 20, region_id: 1, zh_name: "边缘" },
    { constellation_id: null, region_id: 1, zh_name: "无效" },
  ]);
  assert.deepEqual(overview.nodes.map(({ id }) => id), [10, 20]);
  assert.equal(overview.nodes.find(({ id }) => id === 10).x, (1e16 + 4) / 3);
  assert.deepEqual(overview.edges, [{
    id: "10:20",
    source_id: 10,
    destination_id: 20,
    gate_pairs: [{ source_system_id: 1, destination_system_id: 9 }],
  }]);
});

test('topology never uses force side or intel fields for ordering', () => {
  const nodes = [1, 2, 3].map(system_id => ({ system_id }));
  const edges = [{ system_id: 1, destination_system_id: 2 }, { system_id: 1, destination_system_id: 3 }];
  const xy = rows => rows.map(({system_id, px, py}) => [system_id, px, py]);
  assert.deepEqual(xy(layoutTopology(nodes, edges)), xy(layoutTopology(nodes.map(n => ({...n, side: n.system_id === 3 ? 'friendly' : 'enemy'})), edges)));
});

test('visible exits exclude internal gates and accept the real backend boundary schema', () => {
  assert.deepEqual(visibleGateExits([{system_id:1}, {system_id:2}], [{system_id:1,destination_system_id:2}], [
    {system_id:1,destination_system_id:99,destination_name:'Outside'},
  ], [1,2]), [{id:'1:99',source_system_id:1,destination_system_id:99,destination_name:'Outside',loaded:false}]);
});

test('constellation centroids preserve fractional positions for small integer coordinates', () => {
  const {nodes} = buildConstellationOverview([{system_id:1,constellation_id:1,x:0,z:0}, {system_id:2,constellation_id:1,x:1,z:1}], [], []);
  assert.equal(nodes[0].x, .5);
});
