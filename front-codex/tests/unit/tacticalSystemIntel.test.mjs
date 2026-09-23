import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../../src/utils/tacticalSystemIntel.js').catch(() => ({}));
const latest = rows => { assert.equal(typeof module.latestSystemIntel, 'function', 'latest system-intel reducer is not implemented'); return module.latestSystemIntel(rows); };
const report = (id, system_id, people, extra = {}) => ({id, system_id, people, report_kind:'system_count', observed_at:'2026-09-22T10:00:00Z', updated_at:'2026-09-22T10:00:00Z', version:1, ...extra});

test('system counts use latest observed snapshot, never sum scouts or fleet reports', () => {
  const rows = [report(1,10,68), report(2,10,42,{observed_at:'2026-09-22T10:01:00Z'}), report(3,10,900,{report_kind:'fleet'}), {id:4,system_id:10,people:800}, report(5,20,18)];
  assert.deepEqual(latest(rows).map(r=>[r.system_id,r.people]),[[10,42],[20,18]]);
  assert.equal(rows.length,5);
});
test('unknown and explicit zero counts remain distinct', () => {
  assert.deepEqual(latest([report(1,1,null),report(2,2,0)]).map(r=>r.people),[null,0]);
});
test('equal observation times resolve deterministically by update, version and id', () => {
  const rows=[report(1,1,10),report(2,1,20,{updated_at:'2026-09-22T10:05:00Z'}),report(3,1,30,{updated_at:'2026-09-22T10:05:00Z',version:2}),report(4,1,40,{updated_at:'2026-09-22T10:05:00Z',version:2})];
  assert.equal(latest(rows)[0].id,4);
  assert.equal(latest([...rows].reverse())[0].id,4);
});
test('invalid ids and confirmed legacy observations cannot become system totals', () => {
  assert.deepEqual(latest([null,report(1,null,5),report(2,'bad',8),report(3,2,19,{report_kind:'fleet',status:'confirmed'})]),[]);
});
test('withdrawing latest count hides the system card instead of reviving stale intel', () => {
  const rows = [report(1, 10, 68), report(2, 10, 42, {observed_at:'2026-09-22T10:01:00Z', status:'withdrawn'})];
  assert.deepEqual(latest(rows).map(row => row.id), []);
});
