import { useCallback, useEffect, useRef, useState } from "react";
import { canAcceptSnapshot } from "../utils/tacticalSocket";
import { nextTacticalPollDelay, TACTICAL_POLL_MIN_MS } from "../utils/tacticalPolling";
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
export default function useTacticalSession(organizationId, boardId = null) {
  const REQUEST_TIMEOUT_MS = 15000;
  const [snapshot, setSnapshot] = useState(null);
  const [status, setStatus] = useState("connecting");
  const [error, setError] = useState("");
  const connection = useRef(null);
  const generation = useRef(0);
  const refreshRef = useRef(async () => {});
  const invalidateRef = useRef(() => {});
  const requestRef = useRef(async operation => operation());
  useEffect(() => {
    let cancelled = false;
    let heartbeatAt = 0;
    let stopStream = null;
    let streamLive = false;
    let streamSequence = 0;
    let retryStreamAt = 0;
    let reconnectAttempt = 0;
    let lastAccepted = null;
    let pollTimer = null;
    let pollDelay = TACTICAL_POLL_MIN_MS;
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
          organizationId, boardId, connectionId,
          onSnapshot: (data) => {
            if (cancelled) return;
            streamLive = true;
            streamSequence += 1;
            accept(data);
          },
          onOpen: () => { reconnectAttempt = 0; },
          onClose: (code) => {
            stopStream = null;
            streamLive = false;
            if (cancelled) return;
            reconnectAttempt += 1;
            const backoff = Math.min(30000, 1000 * 2 ** (reconnectAttempt - 1));
            retryStreamAt = Date.now() + backoff * (0.75 + Math.random() * 0.5);
            heartbeatAt = 0;
            if (code === 4403) invalidate();
            else if (lastAccepted) {
              // HTTP snapshot polling remains an authenticated write-capable
              // fallback; a proxy without WebSocket support must not disable
              // quick reports while the current snapshot is still usable.
              setStatus("live");
              setError("实时连接暂时不可用，已切换 HTTP 同步。");
            } else {
              setStatus("offline");
              setError("实时连接正在恢复；暂时保留只读上报记录。");
            }
            clearPoll();
            schedulePoll(0);
          },
        });
      } catch {
        reconnectAttempt += 1;
        retryStreamAt = Date.now() + Math.min(30000, 1000 * 2 ** (reconnectAttempt - 1)) * (0.75 + Math.random() * 0.5);
      }
    };
    const isVisible = () => typeof document === "undefined" || document.visibilityState !== "hidden";
    const clearPoll = () => {
      if (pollTimer !== null) {
        window.clearTimeout(pollTimer);
        pollTimer = null;
      }
    };
    const schedulePoll = (delay = pollDelay) => {
      if (cancelled || pollTimer !== null || !isVisible()) return;
      pollTimer = window.setTimeout(async () => {
        pollTimer = null;
        const succeeded = await refresh();
        const nextDelay = nextTacticalPollDelay({
          visible: isVisible(),
          streamLive,
          requestSucceeded: succeeded,
          previousDelay: pollDelay,
        });
        if (nextDelay === null) return;
        pollDelay = nextDelay;
        schedulePoll(nextDelay);
      }, Math.max(0, delay));
    };
    const handleVisibilityChange = () => {
      if (!isVisible()) {
        clearPoll();
        return;
      }
      pollDelay = TACTICAL_POLL_MIN_MS;
      schedulePoll(0);
    };
    const request = (operation) => {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const deadline = new Promise((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          const failure = new Error("战术请求超时；请检查网络后重试。");
          failure.name = "RequestTimeoutError";
          reject(failure);
        }, { once: true });
      });
      return Promise.race([Promise.resolve().then(() => operation(controller.signal)), deadline]).finally(() => window.clearTimeout(timeout));
    };
    requestRef.current = request;
    const refresh = async (force = false) => {
      if (cancelled || busy) return null;
      if (!force && streamLive && Date.now() - heartbeatAt < 20000) return null;
      busy = true;
      const sequence = streamSequence;
      let admissionAttempted = false;
      try {
        if (Date.now() - heartbeatAt >= 20000) {
          admissionAttempted = true;
          await request((signal) => enterTacticalBoard(organizationId, connectionId, { signal }));
          heartbeatAt = Date.now();
        }
        // Cleanup may have released this lease while admission was in flight.
        if (cancelled) return null;
        const data = await request((signal) => getTacticalSnapshot(organizationId, connectionId, { signal, boardId }));
        if (cancelled) return null;
        // A delayed HTTP snapshot must not resurrect state superseded by WS.
        if (sequence === streamSequence) accept(data);
        connectStream();
        return true;
      } catch (failure) {
        if (cancelled) return null;
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
        return false;
      } finally {
        busy = false;
        // An admission can commit AFTER effect cleanup's DELETE. Release its
        // exact connection again once the request settles (including a lost
        // response), without affecting the replacement board's lease.
        if (cancelled && admissionAttempted) {
          request((signal) => leaveTacticalBoard(organizationId, connectionId, { signal })).catch(() => {});
        }
      }
    };
    refreshRef.current = () => refresh(true);
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", handleVisibilityChange);
    refresh().then((succeeded) => {
      if (cancelled) return;
      const nextDelay = nextTacticalPollDelay({ visible: isVisible(), streamLive, requestSucceeded: succeeded, previousDelay: pollDelay });
      if (nextDelay !== null) {
        pollDelay = nextDelay;
        schedulePoll(nextDelay);
      }
    });
    return () => {
      cancelled = true;
      stopStream?.();
      generation.current = epoch + 1;
      clearPoll();
      if (typeof document !== "undefined") document.removeEventListener("visibilitychange", handleVisibilityChange);
      connection.current = null;
      // Cleanup is best-effort; the server expires abandoned leases after 60s.
      request((signal) => leaveTacticalBoard(organizationId, connectionId, { signal })).catch(() => {});
    };
  }, [organizationId, boardId]);
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
      const result = await requestRef.current((signal) => sendTacticalCommand(organizationId, {
          action,
          ...payload,
          request_id: requestId,
          ...(requireLease ? { connection_id: connection.current } : {}),
          ...(requireLease && boardId != null ? { board_id: boardId } : {}),
        }, { signal }));
      if (epoch !== generation.current)
        throw new Error("已切换战术板，旧请求结果已忽略。");
      if (requireLease) await refreshRef.current();
      return result.result;
    },
    [organizationId, boardId, status],
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
