import test from 'node:test';
import assert from 'node:assert/strict';
import { queueReportOutbox, readReportOutbox, retryReportOutbox } from '../../src/utils/tacticalOutbox.js';

function fixture() {
  const values = new Map();
  const scope = { userId: 7, organizationId: 12, boardId: 31, storage: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  } };
  const entry = queueReportOutbox(scope, {
    action: 'report.create', payload: { system_id: 1, people: 80 }, requestId: 'saved-report',
  });
  return { scope, entry };
}

test('an expired admission lease keeps an outbox report retryable with its original identity', async () => {
  const { scope, entry } = fixture();
  await assert.rejects(retryReportOutbox(scope, entry, async () => {
    throw { status: 403, code: 'lease_expired', message: '连接租约过期' };
  }), /租约/);
  const queued = readReportOutbox(scope)[0];
  assert.equal(queued.status, 'queued');
  assert.equal(queued.requestId, entry.requestId);
  assert.deepEqual(queued.payload, entry.payload);
  await retryReportOutbox(scope, queued, async (_action, payload, options) => {
    assert.deepEqual(payload, entry.payload);
    assert.equal(options.requestId, entry.requestId);
  });
  assert.deepEqual(readReportOutbox(scope), []);
});

test('actual permission denial still blocks an outbox report', async () => {
  const { scope, entry } = fixture();
  await assert.rejects(retryReportOutbox(scope, entry, async () => {
    throw { status: 403, code: 'permission_denied', message: '已被移出组织' };
  }), /移出/);
  assert.equal(readReportOutbox(scope)[0].status, 'blocked');
});
