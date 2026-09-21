import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCount,
  reportPayload,
  permissions,
  summarizeForces,
  ageLabel,
  projectSystems,
  adjacentSystems,
  groupMapForces,
} from "../../src/utils/tacticalCollaboration.js";

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} must be close to ${expected}`);

test("unknown counts stay null, explicit zero is valid, fractions and negatives reject", () => {
  assert.equal(parseCount(""), null);
  assert.equal(parseCount("0"), 0);
  assert.equal(parseCount("42"), 42);
  for (const value of ["-1", "1.2", "NaN", "1000000000000"])
    assert.throws(() => parseCount(value));
});

test("dense deployments have bounded per-system markers and keep selected force visible", () => {
  const forces = Array.from({ length: 20 }, (_, index) => ({
    id: index + 1,
    system_id: 101,
  }));
  const [group] = groupMapForces(forces, 19);
  assert.equal(group.visible.length, 2);
  assert.equal(group.hiddenCount, 18);
  assert.equal(group.total, 20);
  assert.ok(group.visible.some((force) => force.id === 19));
});
test("reports validate location and observation while preserving eight nullable ship fields", () => {
  const result = reportPayload({
    system_id: 12,
    people: "",
    ships: { cruiser: "0", battleship: "2" },
    notes: " x ",
    observed_at: "2026-09-21T10:00",
  });
  assert.equal(result.people, null);
  assert.equal(result.ships.cruiser, 0);
  assert.equal(result.ships.titan, null);
  assert.equal(Object.keys(result.ships).length, 8);
  assert.equal(result.notes, "x");
  assert.throws(() =>
    reportPayload({ system_id: null, observed_at: "2026-09-21" }),
  );
});
test("roles separate command and membership privileges", () => {
  assert.equal(permissions("scout").manageForces, false);
  assert.equal(permissions("commander").manageForces, true);
  assert.equal(permissions("commander").assignRoles, false);
  assert.equal(permissions("founder").assignRoles, true);
  assert.equal(permissions(undefined).manageForces, false);
});
test("enemy summaries never sum overlapping reports or include friendly numbers", () => {
  assert.deepEqual(
    summarizeForces([
      { side: "enemy", people: 20 },
      { side: "enemy", people: null },
      { side: "friendly", people: 80 },
    ]),
    { forces: 2, knownPeople: 20, unknownForces: 1 },
  );
});
test("staleness uses observation instead of modification time", () => {
  assert.match(
    ageLabel("2026-09-21T10:00:00Z", Date.parse("2026-09-21T10:08:00Z")),
    /8 分钟/,
  );
  assert.match(ageLabel(null), /未知/);
});
test("local graph projection is finite, fits viewport, and adjacency works in either gate direction", () => {
  const points = projectSystems([
    { system_id: 1, x: 0, z: 0 },
    { system_id: 2, x: 100, z: 100 },
  ]);
  assert.equal(points.length, 2);
  assert.ok(
    points.every(
      (point) => Number.isFinite(point.px) && point.px >= 40 && point.px <= 960,
    ),
  );
  assert.deepEqual(
    [
      ...adjacentSystems(
        [
          { system_id: 1, destination_system_id: 2 },
          { system_id: 3, destination_system_id: 1 },
        ],
        1,
      ),
    ].sort(),
    [2, 3],
  );
  assert.deepEqual(projectSystems([]), []);
  assert.deepEqual(
    projectSystems([
      { system_id: 5, x: null, z: null },
      { system_id: 6, x: "", z: 4 },
    ]),
    [],
  );
});

test("wide viewport projection uses its available width without distorting x/z geometry", () => {
  const [left, right, upper] = projectSystems([
    { system_id: 1, x: -200, z: -50 },
    { system_id: 2, x: 200, z: -50 },
    { system_id: 3, x: -200, z: 50 },
  ], { width: 1600, height: 600 });
  near(left.px, 90);
  near(right.px, 1510);
  near(left.py, upper.py + (right.px - left.px) / 4);
  near((left.py + upper.py) / 2, 300);
});

test("tall viewport projection uses its height while preserving north-up and proportions", () => {
  const [lower, upper, right] = projectSystems([
    { system_id: 1, x: -50, z: -200 },
    { system_id: 2, x: -50, z: 200 },
    { system_id: 3, x: 50, z: -200 },
  ], { width: 600, height: 1200 });
  near(lower.py, 1120);
  near(upper.py, 80);
  near(right.px - lower.px, (lower.py - upper.py) / 4);
  near((lower.px + right.px) / 2, 300);
});

test("asymmetric safe padding centers systems in the unobscured area", () => {
  const systems = [{ system_id: 1, x: -1000, z: 0 }, { system_id: 2, x: 1000, z: 0 }];
  const points = projectSystems(systems, {
    width: 1400, height: 900,
    padding: { left: 80, right: 420, top: 120, bottom: 60 },
  });
  assert.deepEqual(points.map(({ px, py }) => [px, py]), [[80, 480], [980, 480]]);
  assert.equal(systems[0].px, undefined, "projection must not mutate game coordinates");
});

test("projection keeps its legacy default geometry and rejects incomplete coordinates", () => {
  const systems = [{ system_id: 1, x: 0, z: 0 }, { system_id: 2, x: 100, z: 100 }];
  projectSystems(systems).forEach(({ px, py }, index) => {
    near(px, [295, 705][index]);
    near(py, [490, 80][index]);
  });
  assert.deepEqual(projectSystems([
    { system_id: 3, x: null, z: 1 },
    { system_id: 4, x: 1, z: undefined },
    { system_id: 5, x: " ", z: 1 },
    { system_id: 6, x: 1, z: Infinity },
  ], { width: 1600, height: 900 }), []);
});
