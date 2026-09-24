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
  const currentVersion = Number(current.state_version);
  const incomingVersion = Number(incoming.state_version);
  if (Number.isSafeInteger(currentVersion) && Number.isSafeInteger(incomingVersion) &&
      currentVersion !== incomingVersion)
    return incomingVersion > currentVersion;
  const before = snapshotTime(current.server_time), after = snapshotTime(incoming.server_time);
  return !Number.isFinite(before) || !Number.isFinite(after) || after >= before;
}

// One socket lifetime only. The owner handles authenticated HTTP recovery, never
// retries user commands, and fences old lifetimes when account/board changes.
export function openTacticalSocket({ apiUrl, organizationId, boardId = null, connectionId, token, onSnapshot, onOpen, onClose,
  WebSocketImpl = WebSocket, setIntervalImpl = setInterval, clearIntervalImpl = clearInterval,
  heartbeatMs = 20000 }) {
  let stopped = false;
  let heartbeatTimer = null;
  const socket = new WebSocketImpl(tacticalSocketUrl(apiUrl, organizationId));
  const stop = () => {
    stopped = true;
    if (heartbeatTimer !== null) clearIntervalImpl(heartbeatTimer);
    heartbeatTimer = null;
    socket.close();
  };
  socket.onopen = () => {
    if (!stopped) {
      socket.send(JSON.stringify({ type: 'authenticate', token, connection_id: connectionId,
        ...(boardId == null ? {} : { board_id: boardId }) }));
      heartbeatTimer = setIntervalImpl(() => {
        if (!stopped && socket.readyState === (WebSocketImpl.OPEN ?? 1))
          socket.send(JSON.stringify({ type: 'ping' }));
      }, heartbeatMs);
      onOpen?.();
    }
  };
  socket.onmessage = event => {
    if (stopped) return;
    try {
      const message = JSON.parse(event.data);
      const data = message.data;
      if (message.type !== 'snapshot' || Number(data?.organization?.id) !== Number(organizationId) ||
          (boardId != null && Number(data?.board?.id) !== Number(boardId)) ||
          !['founder', 'commander', 'scout'].includes(data.role) || !Array.isArray(data.forces) || !Array.isArray(data.reports)) {
        throw new Error('Malformed tactical snapshot');
      }
      onSnapshot(data);
    } catch {
      stop(); onClose(4400);
    }
  };
  socket.onclose = event => {
    if (heartbeatTimer !== null) clearIntervalImpl(heartbeatTimer);
    heartbeatTimer = null;
    if (!stopped) { stopped = true; onClose(event.code); }
  };
  // onclose follows transport errors; intentionally do not log URLs or tokens.
  socket.onerror = () => {};
  return stop;
}
