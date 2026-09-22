import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../../src/utils/tacticalOverview.js').catch(() => ({}));
const now = Date.parse('2026-09-22T10:10:00Z');
const fresh = '2026-09-22T10:09:00Z';
const old = '2026-09-22T10:00:00Z';
const force = (id, system_id, people, extra = {}) => ({ id, system_id, people, side: 'enemy', name: `舰队 ${id}`, system_name: `星系 ${system_id}`, observed_at: fresh, version: 1, in_scope: true, ...extra });
const report = (id, system_id, people, extra = {}) => ({ id, system_id, people, report_kind: 'system_count', system_name: `星系 ${system_id}`, observed_at: fresh, version: 1, in_scope: true, ...extra });
const overview = args => {
  assert.equal(typeof module.buildTacticalOverview, 'function', 'tactical overview aggregation is not implemented');
  return module.buildTacticalOverview({ now, ...args });
};

test('latest enemy system count replaces fleet totals without adding historical or named reports', () => {
  const latest = report(2, 10, 120, { author_name: '斥候甲' });
  const result = overview({
    forces: [force(1, 10, 100), force(2, 10, 50), force(3, 20, 30)],
    reports: [report(1, 10, 200, { observed_at: old }), latest, report(3, 10, 500, { report_kind: 'fleet_intel' }), report(4, 10, 600, { report_kind: 'fleet' })],
  }).enemy;
  assert.equal(result.knownPeople, 150);
  assert.equal(result.fleetCount, 3);
  assert.equal(result.systemCount, 2);
  assert.equal(result.systems[0].source, 'system_report');
  assert.equal(result.systems[0].report, latest);
  assert.equal(result.systems[0].forces.length, 2);
  assert.equal(result.systems[1].source, 'fleets');
});

test('count-only observations produce a system row without manufacturing a fleet', () => {
  const result = overview({ reports: [report(1, 10, 80)] }).enemy;
  assert.equal(result.knownPeople, 80);
  assert.equal(result.fleetCount, 0);
  assert.equal(result.systemCount, 1);
  assert.equal(result.systems[0].forces.length, 0);
});

test('explicit zero is known and unknown latest count never falls back to fleets or older counts', () => {
  const result = overview({ forces: [force(1, 10, 60), force(2, 20, 90)], reports: [report(1, 10, 0), report(2, 20, 120, { observed_at: old }), report(3, 20, null)] }).enemy;
  assert.equal(result.knownPeople, 0);
  assert.equal(result.unknownSystems, 1);
  assert.equal(result.systems[0].people, 0);
  assert.equal(result.systems[1].people, null);
  assert.equal(result.systems[1].knownPeople, 0);
});

test('fleet-only system keeps a partial known sum and explicitly counts unknown fleets', () => {
  const result = overview({ forces: [force(1, 10, 30), force(2, 10, null), force(3, 20, 0)] }).enemy;
  assert.equal(result.knownPeople, 30);
  assert.equal(result.unknownForces, 1);
  assert.equal(result.unknownSystems, 1);
  assert.equal(result.systems[0].people, null);
  assert.equal(result.systems[0].knownPeople, 30);
  assert.equal(result.systems[0].unknownForces, 1);
  assert.equal(result.systems[1].people, 0);
});

test('force IDs are stable deduplication keys and newest version wins over old location', () => {
  const newest = force(1, 20, 45, { version: 3 });
  const other = force(2, 20, 55, { name: newest.name });
  const result = overview({ forces: [newest, force(1, 10, 99, { version: 1 }), other] }).enemy;
  assert.equal(result.knownPeople, 100);
  assert.equal(result.fleetCount, 2);
  assert.deepEqual(result.systems.map(row => row.systemId), [20]);
  assert.equal(result.forces[0], newest);
});

test('equal-version force duplicates use newest updated time regardless of input order', () => {
  const older = force(1, 10, 99, { version: 3, updated_at: old });
  const newer = force(1, 20, 45, { version: 3, updated_at: fresh });
  for (const forces of [[older, newer], [newer, older]]) {
    const result = overview({ forces }).enemy;
    assert.equal(result.knownPeople, 45);
    assert.equal(result.fleetCount, 1);
    assert.equal(result.forces[0], newer);
    assert.deepEqual(result.systems.map(row => row.systemId), [20]);
  }
});

test('archived latest force version removes the whole force instead of resurrecting an older copy', () => {
  const result = overview({ forces: [force(1, 10, 50), force(1, 10, 50, { version: 2, archived: true }), force(2, 20, 8, { archived: true })] }).enemy;
  assert.equal(result.knownPeople, 0);
  assert.equal(result.fleetCount, 0);
  assert.equal(result.systemCount, 0);
});

test('scouts never receive friendly rows or counts, including scope metadata', () => {
  const result = overview({ forces: [force(1, 10, 30), force(2, 20, 1000, { side: 'friendly', in_scope: false }), force(3, 30, 2000, { side: 'friendly', in_scope: undefined })], reports: [report(1, 40, 9000, { side: 'friendly' })] });
  assert.equal(result.friendly, null);
  assert.equal(result.enemy.knownPeople, 30);
  assert.equal(result.outsideCount, 0);
  assert.equal(result.scopeUnknown, 0);
  assert.equal(JSON.stringify(result).includes('1000'), false);
});

test('founder and commander receive separate friendly fleet totals but never enemy system reports', () => {
  for (const role of ['founder', 'commander']) {
    const result = overview({ role, forces: [force(1, 10, 30), force(2, 10, 70, { side: 'friendly' })], reports: [report(1, 10, 90)] });
    assert.equal(result.enemy.knownPeople, 90);
    assert.equal(result.friendly.knownPeople, 70);
    assert.equal(result.friendly.systems[0].source, 'fleets');
  }
});

test('explicit server scope annotation takes precedence over fallback map system IDs', () => {
  const result = overview({ systemIds: new Set([10]), forces: [force(1, 10, 100, { in_scope: false }), force(2, 20, 40, { in_scope: true })], reports: [report(1, 10, 500, { in_scope: false }), report(2, 30, 60, { in_scope: true })] });
  assert.equal(result.enemy.knownPeople, 100);
  assert.deepEqual(result.enemy.systems.map(row => row.systemId), [20, 30]);
  assert.equal(result.outsideCount, 2);
  assert.equal(result.scopeUnknown, 0);
});

test('missing annotations use fallback systems and unknown scope is excluded from current totals', () => {
  const forces = [force(1, 10, 40, { in_scope: undefined }), force(2, 20, 60, { in_scope: undefined })];
  const scoped = overview({ forces, systemIds: new Set([10]) });
  assert.equal(scoped.enemy.knownPeople, 40);
  assert.equal(scoped.outsideCount, 1);
  const unknown = overview({ forces });
  assert.equal(unknown.enemy.knownPeople, 0);
  assert.equal(unknown.scopeUnknown, 2);
  const all = overview({ forces, scope: 'all' });
  assert.equal(all.enemy.knownPeople, 100);
  assert.equal(all.scopeUnknown, 2);
});

test('switching current/all scope changes inclusion without depending on map viewport', () => {
  const forces = [force(1, 10, 40), force(2, 20, 60, { in_scope: false })];
  assert.equal(overview({ forces }).enemy.knownPeople, 40);
  assert.equal(overview({ forces, scope: 'all' }).enemy.knownPeople, 100);
  assert.equal(overview({ forces, scope: 'all' }).outsideCount, 1);
});

test('latest report is selected before scope filtering so an older in-scope report cannot replace it', () => {
  const result = overview({ reports: [report(1, 10, 50, { observed_at: old, in_scope: true }), report(2, 10, 80, { in_scope: false })] });
  assert.equal(result.enemy.knownPeople, 0);
  assert.equal(result.enemy.systemCount, 0);
  assert.equal(result.outsideCount, 1);
});

test('stale totals are subsets of effective estimates and stale fleet fallback sums each force only', () => {
  const result = overview({ forces: [force(1, 10, 100, { observed_at: old }), force(2, 20, 20, { observed_at: old }), force(3, 20, 30), force(4, 30, 40)], reports: [report(1, 10, 80), report(2, 30, 35, { observed_at: old })] }).enemy;
  assert.equal(result.knownPeople, 165);
  assert.equal(result.stalePeople, 55);
  assert.equal(result.staleSystems, 2);
  assert.equal(result.systems[0].stale, false);
  assert.equal(result.systems[1].stale, true);
  assert.equal(result.systems[1].observedAt, old);
});

test('staleness changes with now without editing or receiving another snapshot', () => {
  const forces = [force(1, 10, 50)];
  assert.equal(overview({ forces }).enemy.stalePeople, 0);
  assert.equal(overview({ forces, now: now + 4 * 60000 }).enemy.stalePeople, 50);
});

test('invalid observations are stale and unknown people values are not silently coerced into zero', () => {
  const result = overview({ forces: [force(1, 10, '', { observed_at: 'invalid' }), force(2, 20, 5, { observed_at: null })] }).enemy;
  assert.equal(result.unknownForces, 1);
  assert.equal(result.unknownSystems, 1);
  assert.equal(result.stalePeople, 5);
  assert.equal(result.staleSystems, 2);
});

test('aggregation preserves original data and source author references', () => {
  const member = Object.freeze(force(1, 10, 25, { source_author_name: '斥候甲' }));
  const observation = Object.freeze(report(1, 20, 50, { author_name: '斥候乙' }));
  const forces = Object.freeze([member]);
  const reports = Object.freeze([observation]);
  const result = overview({ forces, reports }).enemy;
  assert.equal(result.forces[0], member);
  assert.equal(result.systems[0].forces[0].source_author_name, '斥候甲');
  assert.equal(result.systems[1].report, observation);
});
