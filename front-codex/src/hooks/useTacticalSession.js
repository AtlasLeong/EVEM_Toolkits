import { useCallback, useEffect, useRef, useState } from "react";
import { canAcceptSnapshot } from "../utils/tacticalSocket";
import {
  enterTacticalBoard,
  getTacticalSnapshot,
  leaveTacticalBoard,
  newRequestId,
  openTacticalStream,
  sendTacticalCommand,
} from "../services/apiTacticalCollaboration";

// Commands stay HTTP, versioned and non-optimistic. WebSocket snapshots are
// authoritative; HTTP fallback recovers if a proxy does not support upgrades.
export default function useTacticalSession(organizationId) {
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  const connection = useRef(null);
  const generation = useRef(0);
  const refreshRef = useRef(async () => {});
  const invalidateRef = useRef(() => {});
  useEffect(() => {
    let cancelled = false;
    let timer;
    let heartbeatAt = 0;
    let stopStream = null;
    let streamLive = false;
    let streamSequence = 0;
    let retryStreamAt = 0;
    let lastAccepted = null;
    const epoch = ++generation.current;
    const connectionId = newRequestId();
    connection.current = connectionId;
    setSnapshot(null);
    setStatus("connecting");
    setError("");
    let busy = false;
    const accept = (data) => {
      if (cancelled || !canAcceptSnapshot(lastAccepted, data)) return;
      lastAccepted = data;
      setSnapshot(data);
      setStatus("live");
      setError("");
    };
    const invalidate = () => {
      if (cancelled) return;
      cancelled = true;
      generation.current += 1;
      stopStream?.();
      setSnapshot(null);
      setStatus("revoked");
      setError("访问权限已变化，请重新选择组织或登录。");
    };
    invalidateRef.current = invalidate;
    const connectStream = () => {
      if (cancelled || stopStream || Date.now() < retryStreamAt) return;
      try {
        stopStream = openTacticalStream({
          organizationId, connectionId,
          onSnapshot: (data) => {
            if (cancelled) return;
            streamLive = true;
            streamSequence += 1;
            accept(data);
          },
          onClose: (code) => {
            stopStream = null;
            streamLive = false;
            if (cancelled) return;
            retryStreamAt = Date.now() + 10000;
            heartbeatAt = 0;
            if (code === 4403) invalidate();
            else { setStatus("offline"); setError("实时连接正在恢复；暂时保留只读情报。"); }
          },
        });
      } catch {
        retryStreamAt = Date.now() + 10000;
      }
    };
    const refresh = async (force = false) => {
      if (cancelled || busy) return;
      if (!force && streamLive && Date.now() - heartbeatAt < 20000) return;
      busy = true;
      const sequence = streamSequence;
      try {
        if (Date.now() - heartbeatAt >= 20000) {
          await enterTacticalBoard(organizationId, connectionId);
          heartbeatAt = Date.now();
        }
        const data = await getTacticalSnapshot(organizationId, connectionId);
        if (cancelled) return;
        // A delayed HTTP snapshot must not resurrect state superseded by WS.
        if (sequence === streamSequence) accept(data);
        connectStream();
      } catch (failure) {
        if (cancelled) return;
        if (
          [401, 403, 404].includes(failure.status) ||
          failure.name === "AuthSessionChangedError"
        ) {
          invalidate();
        } else if (failure.code === "board_full") {
          setSnapshot(null);
          setStatus("full");
          setError(failure.message);
        } else {
          setStatus("offline");
          setError(failure.message || "连接暂时中断；未提交的内容仍保留。");
          heartbeatAt = 0;
        }
      } finally {
        busy = false;
      }
    };
    refreshRef.current = () => refresh(true);
    refresh();
    timer = window.setInterval(refresh, 2000);
    return () => {
      cancelled = true;
      stopStream?.();
      generation.current = epoch + 1;
      window.clearInterval(timer);
      connection.current = null;
      // Cleanup is best-effort; the server expires abandoned leases after 60s.
      leaveTacticalBoard(organizationId, connectionId).catch(() => {});
    };
  }, [organizationId]);
  const refresh = useCallback(() => refreshRef.current(), []);
  const invalidateAccess = useCallback(() => invalidateRef.current(), []);
  const execute = useCallback(
    async (
      action,
      payload = {},
      { requireLease = true, requestId = newRequestId() } = {},
    ) => {
      const epoch = generation.current;
      if (requireLease && (status !== "live" || !connection.current))
        throw new Error("当前未连接到战术板，请恢复连接后手动提交。");
      const result = await sendTacticalCommand(organizationId, {
        action,
        ...payload,
        request_id: requestId,
        ...(requireLease ? { connection_id: connection.current } : {}),
      });
      if (epoch !== generation.current)
        throw new Error("已切换战术板，旧请求结果已忽略。");
      if (requireLease) await refreshRef.current();
      return result.result;
    },
    [organizationId, status],
  );
  return {
    snapshot,
    status,
    error,
    refresh,
    execute,
    invalidateAccess,
    connectionId: connection.current,
  };
}
