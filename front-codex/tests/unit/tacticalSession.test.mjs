import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canAcceptSnapshot } from "../../src/utils/tacticalSocket.js";
const fetchWithAuthSource = readFileSync(new URL("../../src/services/fetchWithAuth.js", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../../src/services/apiTacticalCollaboration.js", import.meta.url), "utf8");
const pollingSource = readFileSync(new URL("../../src/utils/tacticalPolling.js", import.meta.url), "utf8")
  .replaceAll("export const ", "const ")
  .replaceAll("export function ", "function ");

const source = readFileSync(new URL("../../src/hooks/useTacticalSession.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\s*/gm, "")
  .replace("export default function useTacticalSession", "function useTacticalSession");
const settle = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const snapshot = organizationId => ({
  organization: { id: organizationId, name: `Board ${organizationId}` },
  role: "scout", user_id: 1, permission_version: 1,
  scope: { region_ids: [], border_hops: 0, version: 1 },
  reports: [], forces: [], online_count: 1, capacity: 100,
  server_time: "2026-09-22T00:00:00Z",
});

// Run the actual hook's effect and cleanup with controllable network promises.
// Only React's storage/scheduling boundary is replaced; session logic is not
// copied, and no browser, backend, credentials, or real timers are involved.
function sessionHarness({ enter = async () => {}, read = async id => snapshot(id), leave = async () => {}, send = async () => ({ result: {} }) } = {}) {
  const values = [], refs = [], calls = [], streams = [], timers = new Map();
  let effect, stateIndex = 0, refIndex = 0, nextId = 0, nextTimer = 0;
  const dependencies = {
    useCallback: fn => fn,
    useEffect: fn => { effect = fn; },
    useRef: initial => {
      const index = refIndex++;
      return refs[index] ??= { current: initial };
    },
    useState: initial => {
      const index = stateIndex++;
      if (!(index in values)) values[index] = initial;
      return [values[index], value => { values[index] = typeof value === "function" ? value(values[index]) : value; }];
    },
    canAcceptSnapshot,
    ...new Function(`${pollingSource}; return { nextTacticalPollDelay, TACTICAL_POLL_MIN_MS };`)(),
    enterTacticalBoard: (id, connectionId) => { calls.push({ type: "enter", id, connectionId }); return enter(id, connectionId); },
    getTacticalSnapshot: (id, connectionId, options) => { calls.push({ type: "snapshot", id, connectionId, options }); return read(id, connectionId); },
    leaveTacticalBoard: async (id, connectionId) => { calls.push({ type: "leave", id, connectionId }); return leave(id, connectionId); },
    newRequestId: () => `connection-${++nextId}`,
    openTacticalStream: options => {
      const stream = { ...options, stopped: false };
      streams.push(stream);
      return () => { stream.stopped = true; };
    },
    sendTacticalCommand: async (id, payload) => { calls.push({ type: 'command', id, payload }); return send(id, payload); },
    window: {
      setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
      clearTimeout: id => timers.delete(id),
    },
  };
  const useSession = new Function(...Object.keys(dependencies), `${source}\nreturn useTacticalSession;`)(...Object.values(dependencies));
  return {
    calls, streams,
    async runNextTimer() {
      const [id, timer] = [...timers].sort((a, b) => a[1].delay - b[1].delay)[0] || [];
      assert.ok(timer, 'expected a scheduled session recovery');
      timers.delete(id);
      await timer.callback();
      await settle();
    },
    get state() { return { snapshot: values[0], status: values[1], error: values[2] }; },
    mount(id, boardId = null) {
      stateIndex = refIndex = 0;
      const api = useSession(id, boardId);
      return { api, cleanup: effect() };
    },
    render(id, boardId = null) {
      stateIndex = refIndex = 0;
      return useSession(id, boardId);
    },
  };
}

test('war session carries board identity across snapshot, socket, and commands', async () => {
  const harness = sessionHarness();
  const mounted = harness.mount(7, 31);
  await settle();
  assert.equal(harness.calls.find(call => call.type === 'snapshot')?.options?.boardId, 31);
  assert.equal(harness.streams[0]?.boardId, 31);
  await harness.render(7, 31).execute('report.create', { system_id: 101 });
  assert.equal(harness.calls.find(call => call.type === 'command')?.payload?.board_id, 31);
  mounted.cleanup();
});

test("StrictMode cleanup suppresses a stale snapshot after delayed admission", async () => {
  const firstAdmission = deferred();
  const harness = sessionHarness({
    enter: async (_id, connectionId) => { if (connectionId === "connection-1") await firstAdmission.promise; },
  });
  const first = harness.mount(7);
  first.cleanup();
  const second = harness.mount(7);
  await settle();
  firstAdmission.resolve();
  await settle();
  assert.deepEqual(harness.calls.filter(call => call.type === "snapshot").map(call => call.connectionId), ["connection-2"]);
  assert.equal(harness.state.status, "live");
  assert.equal(harness.streams.length, 1);
  assert.equal(harness.streams[0].connectionId, "connection-2");
  second.cleanup();
});

test("cleanup releases a lease created by an admission that completes after unmount", async () => {
  const admission = deferred(), leases = new Set();
  const harness = sessionHarness({
    enter: async (_id, connectionId) => { await admission.promise; leases.add(connectionId); },
    leave: async (_id, connectionId) => { leases.delete(connectionId); },
  });
  const mounted = harness.mount(7);
  mounted.cleanup();
  await settle();
  admission.resolve();
  await settle();
  assert.equal(leases.size, 0, "late admission must not occupy an abandoned tab's connection slot for 60 seconds");
  assert.equal(harness.streams.length, 0);
});

test("late cleanup releases only the abandoned connection, not the new board lease", async () => {
  const firstAdmission = deferred(), leases = new Set();
  const harness = sessionHarness({
    enter: async (_id, connectionId) => {
      if (connectionId === "connection-1") await firstAdmission.promise;
      leases.add(connectionId);
    },
    leave: async (_id, connectionId) => { leases.delete(connectionId); },
  });
  const first = harness.mount(7);
  first.cleanup();
  const second = harness.mount(8);
  await settle();
  firstAdmission.resolve();
  await settle();
  assert.deepEqual([...leases], ["connection-2"]);
  assert.equal(harness.state.snapshot.organization.id, 8);
  second.cleanup();
});

test("active snapshot 403 still invalidates access and prevents later refresh", async () => {
  const harness = sessionHarness({ read: async () => { throw { status: 403 }; } });
  const mounted = harness.mount(7);
  await settle();
  assert.equal(harness.state.status, "revoked");
  assert.equal(harness.state.snapshot, null);
  assert.equal(harness.streams.length, 0);
  await mounted.api.refresh();
  assert.equal(harness.calls.filter(call => call.type === "snapshot").length, 1);
  mounted.cleanup();
});

test("switching organizations suppresses the previous board's delayed admission", async () => {
  const previousAdmission = deferred();
  const harness = sessionHarness({ enter: async id => { if (id === 7) await previousAdmission.promise; } });
  const previous = harness.mount(7);
  previous.cleanup();
  const current = harness.mount(8);
  await settle();
  previousAdmission.resolve();
  await settle();
  assert.deepEqual(harness.calls.filter(call => call.type === "snapshot").map(call => call.id), [8]);
  assert.equal(harness.state.snapshot.organization.id, 8);
  assert.equal(harness.state.status, "live");
  current.cleanup();
});

test("logout cleanup cannot read state or open a stream when admission finishes later", async () => {
  const admission = deferred();
  const harness = sessionHarness({ enter: async () => admission.promise });
  const mounted = harness.mount(7);
  mounted.cleanup();
  admission.resolve();
  await settle();
  assert.equal(harness.calls.filter(call => call.type === "snapshot").length, 0);
  assert.equal(harness.streams.length, 0);
  assert.equal(harness.state.snapshot, null);
  assert.notEqual(harness.state.status, "live");
});

test("cleanup fences a snapshot already in flight and late socket callbacks", async () => {
  const oldSnapshot = deferred();
  const harness = sessionHarness({ read: async id => id === 7 ? oldSnapshot.promise : snapshot(id) });
  const previous = harness.mount(7);
  await settle();
  previous.cleanup();
  const current = harness.mount(8);
  await settle();
  oldSnapshot.resolve(snapshot(7));
  await settle();
  assert.equal(harness.state.snapshot.organization.id, 8);
  assert.equal(harness.streams.length, 1);
  const stream = harness.streams[0];
  current.cleanup();
  const before = harness.state;
  stream.onSnapshot(snapshot(99));
  stream.onClose(4403);
  assert.deepEqual(harness.state, before);
  assert.equal(stream.stopped, true);
});

test("session source uses bounded request timeout and jittered reconnect backoff", () => {
  assert.match(source, /AbortController/);
  assert.match(source, /REQUEST_TIMEOUT_MS/);
  assert.match(source, /Math\.random/);
  assert.match(source, /retryStreamAt/);
});

test("HTTP fallback is visibility-aware and no longer uses a fixed two-second interval", () => {
  assert.doesNotMatch(source, /setInterval\(refresh,\s*2000\)/);
  assert.match(source, /visibilitychange/);
  assert.match(source, /schedulePoll/);
});

test("tactical commands share the abortable request deadline", () => {
  assert.match(source, /requestRef\.current\(\(signal\) => sendTacticalCommand/);
  assert.match(source, /\}, \{ signal \}\)\);/);
});

test("admission, snapshot, and cleanup requests share the abortable request deadline", () => {
  assert.match(source, /enterTacticalBoard\(organizationId, connectionId, \{ signal \}\)/);
  assert.match(source, /getTacticalSnapshot\(organizationId, connectionId, \{ signal, boardId \}\)/);
  assert.match(source, /leaveTacticalBoard\(organizationId, connectionId, \{ signal \}\)/);
  assert.match(apiSource, /enterTacticalBoard = \(id, connectionId, options = \{\}\)/);
  assert.match(apiSource, /getTacticalSnapshot = \(id, connectionId, \{ boardId = null, \.\.\.options \} = \{\}\)/);
  assert.match(apiSource, /board_id: boardId/);
  assert.match(apiSource, /leaveTacticalBoard = \(id, connectionId, options = \{\}\)/);
});

test("successful socket opens reset reconnect backoff", () => {
  assert.match(source, /onOpen: \(\) => \{ reconnectAttempt = 0; \}/);
});

test("HTTP snapshot fallback keeps reporting enabled after a WebSocket close", async () => {
  const harness = sessionHarness();
  const mounted = harness.mount(7);
  await settle();
  await settle();
  assert.equal(harness.streams.length, 1);
  harness.streams[0].onClose(1006);
  assert.equal(harness.state.status, "live");
  mounted.cleanup();
});

test('expired socket lease becomes read-only until admission and reconnect succeed', async () => {
  const harness = sessionHarness();
  const mounted = harness.mount(7, 31);
  await settle();
  harness.streams[0].onClose(4408);
  assert.equal(harness.state.status, 'connecting');
  assert.equal(harness.state.snapshot.organization.id, 7, 'keep last authorized view while recovering');
  await assert.rejects(harness.render(7, 31).execute('report.create'), /恢复连接/);
  await harness.runNextTimer();
  assert.equal(harness.calls.filter(call => call.type === 'enter').length, 2);
  assert.equal(harness.streams.length, 2, 'new transport should not wait for generic error backoff');
  assert.equal(harness.state.status, 'live');
  mounted.cleanup();
});

test('failed readmission after lease expiry still removes sensitive data', async () => {
  let admissions = 0;
  const harness = sessionHarness({ enter: async () => {
    if (++admissions > 1) throw { status: 403, code: 'permission_denied' };
  } });
  const mounted = harness.mount(7);
  await settle();
  harness.streams[0].onClose(4408);
  await harness.runNextTimer();
  assert.equal(harness.state.status, 'revoked');
  assert.equal(harness.state.snapshot, null);
  const calls = harness.calls.length;
  await mounted.api.refresh();
  assert.equal(harness.calls.length, calls);
  mounted.cleanup();
});

test('expired HTTP lease is re-admitted instead of permanently revoking the session', async () => {
  let reads = 0;
  const harness = sessionHarness({ read: async id => {
    if (++reads === 2) throw { status: 403, code: 'lease_expired', message: '连接租约过期' };
    return snapshot(id);
  } });
  const mounted = harness.mount(7);
  await settle();
  await mounted.api.refresh();
  assert.notEqual(harness.state.status, 'revoked');
  await mounted.api.refresh();
  assert.equal(harness.calls.filter(call => call.type === 'enter').length, 2);
  assert.equal(harness.state.status, 'live');
  mounted.cleanup();
});

test('actual socket permission revocation remains terminal', async () => {
  const harness = sessionHarness();
  const mounted = harness.mount(7);
  await settle();
  harness.streams[0].onClose(4403);
  assert.equal(harness.state.status, 'revoked');
  assert.equal(harness.state.snapshot, null);
  const calls = harness.calls.length;
  await mounted.api.refresh();
  assert.equal(harness.calls.length, calls);
  mounted.cleanup();
});

test('a command rejected for lease expiry recovers transport without auto-replaying the write', async () => {
  let commands = 0;
  const harness = sessionHarness({ send: async () => {
    if (++commands === 1) throw { status: 403, code: 'lease_expired', message: '连接租约过期' };
    return { result: { id: 91 } };
  } });
  const mounted = harness.mount(7);
  await settle();
  await assert.rejects(harness.render(7).execute('report.create', { people: 80 }, { requestId: 'same-report' }),
    failure => failure.code === 'lease_expired');
  assert.equal(harness.state.status, 'connecting');
  await harness.runNextTimer();
  assert.equal(harness.state.status, 'live');
  assert.equal(commands, 1, 'recovery may not silently issue the failed write again');
  const result = await harness.render(7).execute('report.create', { people: 80 }, { requestId: 'same-report' });
  assert.equal(result.id, 91);
  assert.deepEqual(harness.calls.filter(call => call.type === 'command').map(call => call.payload.request_id),
    ['same-report', 'same-report']);
  mounted.cleanup();
});

test('late lease failure from an old board cannot restart the replacement board session', async () => {
  const command = deferred();
  const harness = sessionHarness({ send: async () => {
    await command.promise;
    throw { status: 403, code: 'lease_expired' };
  } });
  const first = harness.mount(7);
  await settle();
  const submitted = harness.render(7).execute('report.create');
  const rejected = assert.rejects(submitted, failure => failure.code === 'lease_expired');
  first.cleanup();
  const second = harness.mount(8);
  await settle();
  command.resolve();
  await rejected;
  assert.equal(harness.state.status, 'live');
  assert.equal(harness.state.snapshot.organization.id, 8);
  assert.equal(harness.streams.at(-1).stopped, false);
  second.cleanup();
});

test('the actual tactical API adapter preserves the backend lease_expired code', async () => {
  const adapter = apiSource.replace(/^import[^;]+;\s*/gm, '').replace(/\bexport (const|class|function) /g, '$1 ');
  const api = new Function('fetchWithAuth', 'API_URL', 'openTacticalSocket',
    `${adapter}; return { sendTacticalCommand, getTacticalSnapshot };`)(
    async () => new Response(JSON.stringify({ detail: '连接租约已过期，请重新连接。', code: 'lease_expired' }),
      { status: 403, headers: { 'Content-Type': 'application/json' } }),
    '/api', () => {},
  );
  for (const request of [() => api.sendTacticalCommand(7, { request_id: 'same-report' }),
    () => api.getTacticalSnapshot(7, 'connection-1')]) {
    await assert.rejects(request, failure => failure.status === 403 && failure.code === 'lease_expired');
  }
});

test("snapshot acceptance prefers the monotonic state version over wall clock", () => {
  const current = snapshot(7);
  const newer = { ...current, state_version: 4, server_time: "2026-09-22T00:00:00Z" };
  const olderClock = { ...current, state_version: 3, server_time: "2026-09-22T00:00:01Z" };
  assert.equal(canAcceptSnapshot(newer, olderClock), false);
  assert.equal(canAcceptSnapshot(newer, { ...newer, state_version: 5, server_time: "2026-09-21T23:59:00Z" }), true);
});

test("auth refresh and retry preserve the tactical request abort signal", () => {
  assert.match(fetchWithAuthSource, /refreshAccessToken = async \(refreshToken, signal\)/);
  assert.match(fetchWithAuthSource, /body: JSON\.stringify\(\{ refresh: refreshToken \}\),\s*signal,/s);
  assert.match(fetchWithAuthSource, /refreshAccessToken\(refreshToken, flight\.controller\.signal\)/);
  assert.match(fetchWithAuthSource, /waitForRefresh\(refreshFlight\.promise, signal\)/);
  assert.match(fetchWithAuthSource, /ensureFreshAccessToken\(session, false, options\.signal\)/);
  assert.match(fetchWithAuthSource, /ensureFreshAccessToken\(session, true, options\.signal\)/);
  const requests = fetchWithAuthSource.match(
    /headers: buildHeaders\(options, accessToken, session\.mismatchedPair\),\s*signal: options\.signal,/gs,
  );
  assert.equal(requests?.length, 2);
});
