export const SHIP_TYPES = {
  cruiser: "巡洋舰",
  battleship: "战列舰",
  light_carrier: "轻型航母",
  assault_carrier: "突击航母",
  dreadnought: "无畏舰",
  heavy_carrier: "重型航母",
  titan: "泰坦",
  other: "其他 / 未知型号",
};
export const ROLE_LABELS = {
  founder: "统帅",
  commander: "指挥",
  scout: "斥候",
};
export const REPORT_LABELS = {
  pending: "舰队线索",
  confirmed: "已采纳",
  corrected: "已修订",
};
export const FLEET_PRESETS = ['大航队', '远炮战列队', '近战战列队', '巡洋舰队', '无畏队', '后勤队'];
export function createReportOutboxEntry(action, payload, requestId) {
  return { action, payload, requestId, attempts: 0, status: 'queued' };
}
export function reportConflictDiff(local = {}, server = {}, prefix = '') {
  const keys = new Set([...Object.keys(local || {}), ...Object.keys(server || {})]);
  const changes = [];
  for (const key of [...keys].sort()) {
    const path = prefix ? `${prefix}.${key}` : key;
    const left = local?.[key]; const right = server?.[key];
    if (left && right && typeof left === 'object' && typeof right === 'object' && !Array.isArray(left) && !Array.isArray(right)) {
      changes.push(...reportConflictDiff(left, right, path));
    } else if (JSON.stringify(left) !== JSON.stringify(right)) changes.push({ field: path, local: left, server: right });
  }
  return changes;
}
export function isRetryableReportFailure(failure = {}) {
  if (failure?.code === 'VERSION_CONFLICT' || Number(failure?.status) === 409) return false;
  return failure?.code === 'NETWORK_ERROR' || Number(failure?.status) >= 500 || failure?.status == null;
}
export function permissions(role) {
  return {
    manageForces: ["founder", "commander"].includes(role),
    manageMembers: ["founder", "commander"].includes(role),
    assignRoles: role === "founder",
  };
}
export function parseCount(value) {
  if (value == null || String(value).trim() === "") return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > 1000000)
    throw new Error("人数与舰船数须为 0 至 1,000,000 的整数；未知请留空。");
  return number;
}
export function reportPayload(draft) {
  if (
    !Number.isSafeInteger(Number(draft.system_id)) ||
    Number(draft.system_id) <= 0
  )
    throw new Error("请先选择星系。");
  const observed = new Date(draft.observed_at);
  if (!Number.isFinite(observed.getTime()))
    throw new Error("请填写有效的观察时间。");
  if (draft.report_kind !== undefined && !['fleet', 'system_count', 'fleet_intel'].includes(draft.report_kind))
    throw new Error('上报类型无效。');
  let fleet = {};
  if (draft.report_kind === 'fleet_intel') {
    if (draft.force_id !== undefined) {
      if (!Number.isSafeInteger(draft.force_id) || draft.force_id < 1 ||
          !Number.isSafeInteger(draft.force_expected_version) || draft.force_expected_version < 1 || draft.fleet_name !== undefined)
        throw new Error('请重新选择要更新的舰队，不能混用新舰队名称。');
      fleet = { force_id: draft.force_id, force_expected_version: draft.force_expected_version };
    } else {
      if (typeof draft.fleet_name !== 'string' || !draft.fleet_name.trim() || draft.fleet_name.length > 80 || draft.force_expected_version !== undefined)
        throw new Error('请填写 1 至 80 字的舰队名称。');
      fleet = { fleet_name: draft.fleet_name.trim() };
    }
  }
  return {
    ...(draft.report_kind !== undefined ? { report_kind: draft.report_kind } : {}),
    ...fleet,
    system_id: Number(draft.system_id),
    people: parseCount(draft.people),
    ships: Object.fromEntries(
      Object.keys(SHIP_TYPES).map((key) => [
        key,
        parseCount(draft.ships?.[key]),
      ]),
    ),
    notes: String(draft.notes || "").trim(),
    observed_at: observed.toISOString(),
  };
}
export function summarizeForces(forces) {
  const enemy = forces.filter((force) => force.side === "enemy");
  return {
    forces: enemy.length,
    knownPeople: enemy.reduce((sum, force) => sum + (force.people ?? 0), 0),
    unknownForces: enemy.filter((force) => force.people == null).length,
  };
}
export function localDateTime(value = new Date()) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 19);
}
export function ageLabel(value, now = Date.now()) {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "观察时间未知";
  const minutes = Math.max(0, Math.floor((now - time) / 60000));
  return minutes < 1
    ? "刚刚观察"
    : minutes < 60
      ? `${minutes} 分钟前观察`
      : `${Math.floor(minutes / 60)} 小时前观察`;
}
export function isStale(value, now = Date.now()) {
  return !value || now - Date.parse(value) >= 5 * 60000;
}
export function adjacentSystems(gates, systemId) {
  const id = Number(systemId);
  const result = new Set();
  for (const gate of gates) {
    if (Number(gate.system_id) === id)
      result.add(Number(gate.destination_system_id));
    if (Number(gate.destination_system_id) === id)
      result.add(Number(gate.system_id));
  }
  return result;
}
export function groupMapForces(forces, selectedForceId) {
  const groups = new Map();
  for (const force of forces) {
    const id = Number(force.system_id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(force);
  }
  return [...groups].sort(([left], [right]) => left - right).map(([system_id, members]) => {
    const stable = [...members].sort((left, right) => Number(left.id) - Number(right.id) ||
      String(left.name || '').localeCompare(String(right.name || ''), 'zh-CN'));
    const selected = stable.find((force) => force.id === selectedForceId);
    const ordered = selected
      ? [selected, ...stable.filter((force) => force !== selected)]
      : stable;
    return {
      system_id,
      visible: ordered.slice(0, 3),
      total: members.length,
      hiddenCount: Math.max(0, members.length - 3),
    };
  });
}
export function projectSystems(systems, {
  width = 1000,
  height = 570,
  padding = { left: 90, right: 90, top: 80, bottom: 80 },
} = {}) {
  const valid = systems.filter(
    (system) =>
      system.x !== null &&
      system.x !== undefined &&
      String(system.x).trim() !== "" &&
      system.z !== null &&
      system.z !== undefined &&
      String(system.z).trim() !== "" &&
      Number.isFinite(Number(system.x)) &&
      Number.isFinite(Number(system.z)),
  );
  if (!valid.length) return [];
  const xs = valid.map((system) => Number(system.x));
  const ys = valid.map((system) => Number(system.z));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const { left = 90, right = 90, top = 80, bottom = 80 } = padding;
  const availableWidth = Math.max(0, width - left - right);
  const availableHeight = Math.max(0, height - top - bottom);
  // A single uniform scale preserves game-space distance and north-up orientation.
  // The caller supplies stable safe bounds, never transient panel visibility.
  const scale = Math.min(availableWidth / (maxX - minX || 1), availableHeight / (maxY - minY || 1));
  const centerX = left + availableWidth / 2;
  const centerY = top + availableHeight / 2;
  return valid.map((system) => ({
    ...system,
    px: centerX + (Number(system.x) - (minX + maxX) / 2) * scale,
    py: centerY - (Number(system.z) - (minY + maxY) / 2) * scale,
  }));
}
