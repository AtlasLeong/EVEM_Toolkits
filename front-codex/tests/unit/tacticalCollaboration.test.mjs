import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  outboxStorageKey,
  readReportOutbox,
  queueReportOutbox,
  discardReportOutbox,
  updateReportOutbox,
  retryReportOutbox,
  paginateTacticalRows,
} from "../../src/utils/tacticalOutbox.js";
import {
  parseCount,
  reportPayload,
  permissions,
  summarizeForces,
  ageLabel,
  localDateTime,
  projectSystems,
  adjacentSystems,
  groupMapForces,
  createReportOutboxEntry,
  reportConflictDiff,
  isRetryableReportFailure,
} from "../../src/utils/tacticalCollaboration.js";

const here = dirname(fileURLToPath(import.meta.url));

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
  assert.equal(group.visible.length, 3);
  assert.equal(group.hiddenCount, 17);
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
test("system count payload is explicit while force-compatible content remains untyped", () => {
  const draft = { system_id: 12, people: '0', observed_at: '2026-09-21T10:00' };
  assert.equal(reportPayload({ ...draft, report_kind: 'system_count' }).report_kind, 'system_count');
  assert.equal(reportPayload({ ...draft, report_kind: 'fleet' }).report_kind, 'fleet');
  assert.equal('report_kind' in reportPayload(draft), false);
  assert.throws(() => reportPayload({ ...draft, report_kind: 'total_local' }));
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
test('named fleet payload trims custom names and uses explicit reviewed identity for updates', () => {
  const draft = {system_id:12, people:'100', observed_at:'2026-09-22T10:00', report_kind:'fleet_intel'};
  const fresh = reportPayload({...draft, fleet_name:' 大航队 '});
  assert.equal(fresh.fleet_name, '大航队');
  assert.equal(fresh.report_kind, 'fleet_intel');
  assert.equal('force_id' in fresh, false);
  const update = reportPayload({...draft, force_id:44, force_expected_version:7});
  assert.equal(update.force_id, 44);
  assert.equal(update.force_expected_version, 7);
  assert.equal('fleet_name' in update, false);
});
test('named fleet payload rejects missing identity, stale-shaped versions and mixed targets', () => {
  const draft = {system_id:12, observed_at:'2026-09-22T10:00', report_kind:'fleet_intel'};
  for (const fields of [{}, {fleet_name:' '}, {fleet_name:'x'.repeat(81)}, {force_id:1},
    {force_id:1,force_expected_version:0}, {force_id:1,force_expected_version:2,fleet_name:'混合'}]) {
    assert.throws(()=>reportPayload({...draft,...fields}));
  }
});
test('report outbox entries preserve an idempotent command and retry state', () => {
  const entry = createReportOutboxEntry('report.create', { system_id: 12, people: 3 }, 'req-1');
  assert.deepEqual(entry, { action: 'report.create', payload: { system_id: 12, people: 3 }, requestId: 'req-1', attempts: 0, status: 'queued' });
});
test('conflict diff exposes local and server values without mutating either draft', () => {
  const local = { system_id: 12, people: 80, notes: 'east', ships: { cruiser: 2 } };
  const server = { system_id: 13, people: 90, notes: 'west', ships: { cruiser: 3 } };
  assert.deepEqual(reportConflictDiff(local, server), [
    { field: 'notes', local: 'east', server: 'west' },
    { field: 'people', local: 80, server: 90 },
    { field: 'ships.cruiser', local: 2, server: 3 },
    { field: 'system_id', local: 12, server: 13 },
  ]);
  assert.equal(local.notes, 'east');
});
test('only transient transport failures are retryable; conflicts require review', () => {
  assert.equal(isRetryableReportFailure({ status: 503 }), true);
  assert.equal(isRetryableReportFailure({ code: 'NETWORK_ERROR' }), true);
  assert.equal(isRetryableReportFailure({ code: 'VERSION_CONFLICT', status: 409 }), false);
});

test("confirm report dialog does not reference parent-form-only state", () => {
  const source = readFileSync(resolve(here, "../../src/components/tactical/TacticalReportForm.jsx"), "utf8");
  const confirm = source.slice(source.indexOf("export function ConfirmReport"));
  assert.doesNotMatch(confirm, /setConflict\(|\bkind\.\b|\binitial\.\b|\bpayload\b|\brequest\.current\b|setQueued\(|\bdraft\b/);
});

test("report form wires retryable failures into the scoped outbox", () => {
  const formSource = readFileSync(resolve(here, "../../src/components/tactical/TacticalReportForm.jsx"), "utf8");
  const pageSource = readFileSync(resolve(here, "../../src/pages/TacticalCollaboration.jsx"), "utf8");
  assert.match(formSource, /isRetryableReportFailure/);
  assert.match(formSource, /onQueue\(/);
  assert.match(pageSource, /queueReportOutbox/);
  assert.match(pageSource, /onQueue=/);
});

test("report outbox is isolated by user and organization and supports discard/update", () => {
  const memory = new Map();
  const storage = {
    getItem: (key) => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const scope = { userId: 7, organizationId: 12, storage };
  assert.equal(outboxStorageKey(7, 12), "evem:tactical-report-outbox:7:12");
  const entry = queueReportOutbox(scope, {
    action: "report.create",
    payload: { system_id: 100, people: 8 },
    requestId: "req-1",
  });
  assert.equal(entry.userId, 7);
  assert.equal(entry.organizationId, 12);
  assert.equal(readReportOutbox(scope).length, 1);
  assert.equal(readReportOutbox({ ...scope, organizationId: 13 }).length, 0);
  const updated = updateReportOutbox(scope, entry.id, { status: "conflict", attempts: 1 });
  assert.equal(updated.status, "conflict");
  discardReportOutbox(scope, entry.id);
  assert.deepEqual(readReportOutbox(scope), []);
});

test("outbox replay keeps the original request id and refuses mismatched scope or conflicts", async () => {
  const memory = new Map();
  const scope = { userId: 7, organizationId: 12, storage: {
    getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key),
  }};
  const entry = queueReportOutbox(scope, { action: "report.create", payload: { system_id: 100, people: 8 }, requestId: "req-original" });
  const calls = [];
  await assert.rejects(retryReportOutbox({ ...scope, userId: 8 }, entry, () => calls.push(1)), /账号|组织/);
  assert.equal(calls.length, 0);
  await assert.rejects(retryReportOutbox(scope, entry, async () => { throw { status: 409, message: "changed" }; }), /changed/);
  assert.equal(readReportOutbox(scope)[0].status, "conflict");
  await assert.rejects(retryReportOutbox(scope, readReportOutbox(scope)[0], () => calls.push(2)), /核对/);
  assert.equal(calls.length, 0);
  discardReportOutbox(scope, entry.id);
  const next = queueReportOutbox(scope, { action: "report.create", payload: { people: 8 }, requestId: "req-2" });
  await retryReportOutbox(scope, next, async (action, payload, options) => { calls.push([action, payload, options]); });
  assert.deepEqual(calls, [["report.create", { people: 8 }, { requestId: "req-2" }]]);
  assert.equal(readReportOutbox(scope).length, 0);
});

test("tactical pagination bounds rendering and clamps page after filtering", () => {
  const rows = Array.from({ length: 55 }, (_, id) => ({ id }));
  assert.deepEqual(paginateTacticalRows(rows, 2, 20), { items: rows.slice(20, 40), page: 2, pageCount: 3, total: 55 });
  assert.equal(paginateTacticalRows(rows.slice(0, 3), 3, 20).page, 1);
});
test("staleness uses observation instead of modification time", () => {
  assert.match(
    ageLabel("2026-09-21T10:00:00Z", Date.parse("2026-09-21T10:08:00Z")),
    /8 分钟/,
  );
  assert.match(ageLabel(null), /未知/);
});
test("editing observation times preserves seconds for latest-snapshot ordering", () => {
  const original = new Date('2026-09-22T10:08:43Z');
  assert.equal(new Date(localDateTime(original)).getTime(), original.getTime());
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
