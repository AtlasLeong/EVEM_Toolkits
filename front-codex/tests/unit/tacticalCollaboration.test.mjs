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
