import test from 'node:test'
import assert from 'node:assert/strict'
const helper = await import('../../src/utils/controlCenterPresentation.js').catch(() => ({}))
test('naive Django audit timestamps are interpreted as Shanghai, explicit offsets stay explicit', () => {
  assert.equal(typeof helper.formatControlTime, 'function')
  assert.equal(helper.formatControlTime('2026-10-15T09:00:00'), '2026/10/15 09:00:00')
  assert.equal(helper.formatControlTime('2026-10-15 09:00:00.123456'), '2026/10/15 09:00:00')
  assert.equal(helper.formatControlTime('2026-10-15T01:00:00Z'), '2026/10/15 09:00:00')
  assert.equal(helper.formatControlTime('2026-10-15T09:00:00+08:00'), '2026/10/15 09:00:00')
  assert.equal(helper.formatControlTime('not a timestamp'), '暂无记录')
})
