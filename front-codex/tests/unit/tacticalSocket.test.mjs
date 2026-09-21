import test from 'node:test';
import assert from 'node:assert/strict';
import { openTacticalSocket, tacticalSocketUrl, canAcceptSnapshot } from '../../src/utils/tacticalSocket.js';

class FakeSocket {
  static OPEN = 1;
  constructor(url) { this.url = url; this.readyState = 0; this.sent = []; FakeSocket.latest = this; }
  send(value) { this.sent.push(JSON.parse(value)); }
  close() { this.closed = true; }
  open() { this.readyState = 1; this.onopen?.(); }
  message(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
}
const state = { organization: { id: 7 }, role: 'scout', permission_version: 1, forces: [], reports: [] };
function setup() {
  const snapshots = [], closed = [];
  const stop = openTacticalSocket({ apiUrl: 'http://127.0.0.1:8001/api', organizationId: 7, connectionId: 'tab', token: 'private-token',
    WebSocketImpl: FakeSocket, onSnapshot: data => snapshots.push(data), onClose: code => closed.push(code) });
  return { socket: FakeSocket.latest, stop, snapshots, closed };
}
test('WebSocket credentials appear only in first authentication frame, never URL', () => {
  const { socket, stop } = setup();
  assert.equal(socket.url, 'ws://127.0.0.1:8001/ws/tactical/7/');
  assert.equal(socket.sent.length, 0);
  socket.open();
  assert.deepEqual(socket.sent, [{ type: 'authenticate', token: 'private-token', connection_id: 'tab' }]);
  stop();
});
test('only matching organization snapshots are delivered; malformed state closes channel', () => {
  const { socket, snapshots, closed } = setup();
  socket.open(); socket.message({ type: 'snapshot', data: state });
  assert.deepEqual(snapshots, [state]);
  socket.message({ type: 'snapshot', data: { ...state, organization: { id: 8 } } });
  assert.equal(snapshots.length, 1); assert.equal(socket.closed, true); assert.deepEqual(closed, [4400]);
});
test('cleanup fences delayed open, messages, and old close callbacks', () => {
  const { socket, stop, snapshots, closed } = setup();
  stop(); socket.open(); socket.message({ type: 'snapshot', data: state }); socket.onclose?.({ code: 4403 });
  assert.equal(socket.sent.length, 0); assert.equal(snapshots.length, 0); assert.equal(closed.length, 0);
});
test('secure API selects wss and rejects URL credentials/non-HTTP schemes', () => {
  assert.equal(tacticalSocketUrl('https://example.com/api', 9), 'wss://example.com/ws/tactical/9/');
  for (const url of ['ftp://example.com/api', 'https://user:secret@example.com/api']) assert.throws(() => tacticalSocketUrl(url, 9));
});
test('cross-transport delayed state cannot undo newer state, including sub-millisecond changes', () => {
  const latest = { ...state, server_time: '2026-09-21T01:00:00.000900+00:00', forces: [] };
  const delayed = { ...state, server_time: '2026-09-21T01:00:00.000100+00:00', forces: [{ id: 3 }] };
  assert.equal(canAcceptSnapshot(latest, delayed), false);
  assert.equal(canAcceptSnapshot(delayed, latest), true);
  assert.equal(canAcceptSnapshot({ ...latest, permission_version: 2 }, delayed), false);
  // A new permission generation is authoritative even across a wall-clock correction.
  assert.equal(canAcceptSnapshot(latest, { ...delayed, permission_version: 2 }), true);
});
