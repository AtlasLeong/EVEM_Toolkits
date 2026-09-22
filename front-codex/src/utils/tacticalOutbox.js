const PREFIX = "evem:tactical-report-outbox";
const MAX_ENTRIES = 30;
const MAX_AGE = 24 * 60 * 60 * 1000;

export function outboxStorageKey(userId, organizationId) {
  if (!Number.isSafeInteger(Number(userId)) || Number(userId) <= 0 ||
      !Number.isSafeInteger(Number(organizationId)) || Number(organizationId) <= 0) {
    throw new Error("无法确认当前账号与组织，未保存本地草稿。");
  }
  return `${PREFIX}:${Number(userId)}:${Number(organizationId)}`;
}

export function readReportOutbox({ userId, organizationId, storage = localStorage }) {
  const key = outboxStorageKey(userId, organizationId);
  const raw = storage.getItem(key);
  if (!raw) return [];
  let entries;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries)) return [];
  return entries.filter(entry => entry?.action === "report.create" && entry?.payload &&
    typeof entry.payload === "object" && typeof entry.requestId === "string" && entry.id === entry.requestId &&
    entry.userId === Number(userId) && entry.organizationId === Number(organizationId) &&
    Number.isFinite(entry.createdAt) && Date.now() - entry.createdAt < MAX_AGE).slice(-MAX_ENTRIES);
}

export function queueReportOutbox(scope, command) {
  if (command.action !== "report.create" || !command.requestId || !command.payload) {
    throw new Error("只有新增上报可存入待发送草稿；修改与冲突需要重新核对。");
  }
  const entries = readReportOutbox(scope);
  const existing = entries.find(entry => entry.id === command.requestId);
  if (existing) return existing;
  if (entries.length >= MAX_ENTRIES) throw new Error("待发送草稿已达 30 条，请先处理现有草稿。");
  const entry = {
    ...JSON.parse(JSON.stringify(command)),
    id: command.requestId,
    userId: Number(scope.userId), organizationId: Number(scope.organizationId),
    createdAt: Date.now(), attempts: 0, status: "queued",
  };
  write(scope, [...entries, entry]);
  return entry;
}

function write(scope, entries) {
  const storage = scope.storage || localStorage;
  const key = outboxStorageKey(scope.userId, scope.organizationId);
  if (entries.length) storage.setItem(key, JSON.stringify(entries));
  else storage.removeItem(key);
}

export function discardReportOutbox(scope, id) {
  write(scope, readReportOutbox(scope).filter(entry => entry.id !== id));
}

export function updateReportOutbox(scope, id, changes) {
  let updated = null;
  const entries = readReportOutbox(scope).map(entry => {
    if (entry.id !== id) return entry;
    // Retry metadata may change; identity and exact idempotent content may not.
    updated = { ...entry, status: changes.status ?? entry.status,
      attempts: changes.attempts ?? entry.attempts, error: changes.error ?? entry.error };
    return updated;
  });
  write(scope, entries);
  return updated;
}

export async function retryReportOutbox(scope, entry, execute) {
  if (entry.userId !== Number(scope.userId) || entry.organizationId !== Number(scope.organizationId)) {
    throw new Error("草稿不属于当前账号或组织，已阻止发送。");
  }
  const saved = readReportOutbox(scope).find(item => item.id === entry.id);
  if (!saved || saved.status === "conflict" || saved.status === "blocked") {
    throw new Error("请先核对草稿，再决定修改或丢弃；不会自动覆盖服务器数据。");
  }
  updateReportOutbox(scope, saved.id, { attempts: saved.attempts + 1, status: "sending", error: "" });
  try {
    const result = await execute(saved.action, saved.payload, { requestId: saved.requestId });
    discardReportOutbox(scope, saved.id);
    return result;
  } catch (failure) {
    const conflict = Number(failure?.status) === 409;
    const retryable = failure?.status == null || Number(failure?.status) >= 500;
    updateReportOutbox(scope, saved.id, { status: conflict ? "conflict" : retryable ? "queued" : "blocked", error: failure?.message || "发送失败" });
    throw new Error(failure?.message || "发送失败，草稿已保留。");
  }
}

export function paginateTacticalRows(rows, requestedPage = 1, size = 20) {
  const pageCount = Math.max(1, Math.ceil(rows.length / size));
  const page = Math.min(pageCount, Math.max(1, requestedPage));
  return { items: rows.slice((page - 1) * size, page * size), page, pageCount, total: rows.length };
}
