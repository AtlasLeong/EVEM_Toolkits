export function tacticalSocketUrl(apiUrl, organizationId) {
  const url = new URL(apiUrl);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !Number.isSafeInteger(Number(organizationId))) {
    throw new Error('Invalid tactical WebSocket endpoint');
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `/ws/tactical/${organizationId}/`;
  url.search = ''; url.hash = '';
  return url.toString();
}

function snapshotTime(value) {
  const milliseconds = Date.parse(value);
  const fraction = String(value).match(/\.(\d+)(?:Z|[+-]\d\d:\d\d)$/)?.[1] || '';
  return milliseconds * 1000 + Number(fraction.padEnd(6, '0').slice(3, 6));
}

// server_time is generated inside the organization-locked read, not a global
// event cursor. Preserve microseconds so mixed HTTP/WS delivery cannot roll back
// a newer view without disclosing counts of hidden friendly events.
export function canAcceptSnapshot(current, incoming) {
  if (!current) return true;
  if (incoming.permission_version !== current.permission_version)
    return incoming.permission_version > current.permission_version;
  const before = snapshotTime(current.server_time), after = snapshotTime(incoming.server_time);
  return !Number.isFinite(before) || !Number.isFinite(after) || after >= before;
}

// One socket lifetime only. The owner handles authenticated HTTP recovery, never
// retries user commands, and fences old lifetimes when account/board changes.
export function openTacticalSocket({ apiUrl, organizationId, connectionId, token, onSnapshot, onClose, WebSocketImpl = WebSocket }) {
  let stopped = false;
  const socket = new WebSocketImpl(tacticalSocketUrl(apiUrl, organizationId));
  const stop = () => { stopped = true; socket.close(); };
  socket.onopen = () => {
    if (!stopped) socket.send(JSON.stringify({ type: 'authenticate', token, connection_id: connectionId }));
  };
  socket.onmessage = event => {
    if (stopped) return;
    try {
      const message = JSON.parse(event.data);
      const data = message.data;
      if (message.type !== 'snapshot' || Number(data?.organization?.id) !== Number(organizationId) ||
          !['founder', 'commander', 'scout'].includes(data.role) || !Array.isArray(data.forces) || !Array.isArray(data.reports)) {
        throw new Error('Malformed tactical snapshot');
      }
      onSnapshot(data);
    } catch {
      stop(); onClose(4400);
    }
  };
  socket.onclose = event => { if (!stopped) { stopped = true; onClose(event.code); } };
  // onclose follows transport errors; intentionally do not log URLs or tokens.
  socket.onerror = () => {};
  return stop;
}
