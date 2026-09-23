const DEFAULT_PADDING = { left: 90, right: 90, top: 80, bottom: 80 };

const numberOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const idNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : String(value);
};

const compareIds = (left, right) => {
  const a = idNumber(left);
  const b = idNumber(right);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en");
};

/** Return the best available human-readable name for a system marker. */
export function systemDisplayName(system = {}) {
  const localized = String(system?.zh_name ?? "").trim();
  if (localized) return localized;
  const canonical = String(system?.name ?? "").trim();
  if (canonical) return canonical;
  const id = idNumber(system?.system_id ?? system?.id);
  return id === null || id === undefined || id === "" ? "未命名星系" : `星系 ${id}`;
}

/**
 * Keep the overview readable while revealing more names as the user zooms in.
 * The quadratic budget reaches every loaded system around 3x zoom, which is
 * useful for a local combat area without turning the overview into a text wall.
 */
export function labelStepForZoom(systemCount, zoom = 1) {
  const count = Math.max(0, Number(systemCount) || 0);
  if (!count) return 1;
  const scale = Math.max(0.5, Number(zoom) || 1);
  const budget = Math.max(1, Math.floor(18 * scale * scale));
  return Math.max(1, Math.ceil(count / budget));
}

/** Validate a drag destination without weakening the one-jump movement rule. */
export function validateMoveDrop(gates = [], sourceId, targetId) {
  const source = idNumber(sourceId);
  const target = idNumber(targetId);
  if (target === null || target === undefined || target === "") {
    return { ok: false, reason: "请将部队拖到相邻星系。" };
  }
  const adjacent = (gates || []).some((gate) => {
    const left = idNumber(gate?.system_id ?? gate?.source_system_id);
    const right = idNumber(gate?.destination_system_id ?? gate?.target_system_id);
    return (left === source && right === target) || (left === target && right === source);
  });
  if (!adjacent) {
    return { ok: false, reason: "只能拖到相邻星门连接的星系；远程纠正请使用“移动部队”。" };
  }
  return { ok: true, destination_system_id: target };
}

const mergePadding = (padding = {}) => ({
  ...DEFAULT_PADDING,
  ...padding,
});

const stableAverage = (values) => {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

export function validSystems(systems = []) {
  return systems.filter((system) => numberOrNull(system?.x) !== null && numberOrNull(system?.z) !== null);
}

/**
 * Project loaded systems into a stable screen-space layout. `fitIds` controls
 * the bounds used for fitting, so a far-away boundary system cannot compress
 * the active battle area. All valid systems are returned, including those
 * outside the fitted viewport.
 */
export function projectSystemsScoped(systems = [], {
  fitIds,
  width = 1000,
  height = 570,
  padding = DEFAULT_PADDING,
} = {}) {
  const valid = validSystems(systems);
  if (!valid.length) return [];

  const fitSet = Array.isArray(fitIds) && fitIds.length
    ? new Set(fitIds.map((id) => idNumber(id)))
    : null;
  const fit = valid.filter((system) => fitSet?.has(idNumber(system.system_id)) ?? true);
  const fitSystems = fit.length ? fit : valid;
  const xs = fitSystems.map((system) => numberOrNull(system.x));
  const zs = fitSystems.map((system) => numberOrNull(system.z));
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const { left = 90, right = 90, top = 80, bottom = 80 } = mergePadding(padding);
  const availableWidth = Math.max(0, Number(width) - left - right);
  const availableHeight = Math.max(0, Number(height) - top - bottom);
  const scale = Math.min(
    availableWidth / Math.max(maxX - minX, 1),
    availableHeight / Math.max(maxZ - minZ, 1),
  );
  const centerX = left + availableWidth / 2;
  const centerY = top + availableHeight / 2;
  const fitCenterX = (minX + maxX) / 2;
  const fitCenterZ = (minZ + maxZ) / 2;

  return valid.map((system) => ({
    ...system,
    px: centerX + (Number(system.x) - fitCenterX) * scale,
    py: centerY - (Number(system.z) - fitCenterZ) * scale,
    isFitSystem: fitSet ? fitSet.has(idNumber(system.system_id)) : true,
  }));
}

const constellationIdForSystem = (system) => idNumber(
  system?.constellation_id ?? system?.constellationId ?? system?.constellation,
);

/**
 * Build deterministic constellation nodes and deduplicated inter-constellation
 * edges. Edges retain the concrete gate endpoints so an overview connection
 * can be expanded without losing the underlying route information.
 */
export function buildConstellationOverview(systems = [], stargates = [], constellations = []) {
  const valid = validSystems(systems);
  const systemMap = new Map(valid.map((system) => [idNumber(system.system_id), system]));
  const constellationMap = new Map();

  const ensure = (id) => {
    const key = idNumber(id);
    if (key === null || key === undefined || key === "") return null;
    if (!constellationMap.has(key)) constellationMap.set(key, {
      id: key,
      system_id: key,
      constellation_id: key,
      label: String(key),
      region_id: null,
      systems: [],
      x: null,
      z: null,
    });
    return constellationMap.get(key);
  };

  for (const descriptor of constellations) {
    const node = ensure(descriptor?.constellation_id ?? descriptor?.id);
    if (!node) continue;
    node.label = descriptor.zh_name ?? descriptor.name ?? node.label;
    node.region_id = idNumber(descriptor.region_id ?? descriptor.regionId);
    const x = numberOrNull(descriptor.x);
    const z = numberOrNull(descriptor.z);
    if (x !== null) node.x = x;
    if (z !== null) node.z = z;
  }

  for (const system of valid) {
    const node = ensure(constellationIdForSystem(system));
    if (!node) continue;
    node.systems.push(idNumber(system.system_id));
  }

  for (const node of constellationMap.values()) {
    const members = node.systems.map((id) => systemMap.get(id)).filter(Boolean);
    members.sort((left, right) => compareIds(left.system_id, right.system_id));
    if (!members.length) {
      constellationMap.delete(node.id);
      continue;
    }
    if (members.length) {
      node.x = stableAverage(members.map((member) => Number(member.x)));
      node.z = stableAverage(members.map((member) => Number(member.z)));
    }
    node.systems.sort(compareIds);
    node.system_count = node.systems.length;
    node.system_ids = [...node.systems];
    delete node.systems;
  }

  const edgesMap = new Map();
  const gateKeys = new Set();
  for (const gate of stargates) {
    const sourceSystem = systemMap.get(idNumber(gate?.system_id ?? gate?.source_system_id));
    const destinationSystem = systemMap.get(idNumber(gate?.destination_system_id ?? gate?.target_system_id));
    if (!sourceSystem || !destinationSystem) continue;
    const sourceId = constellationIdForSystem(sourceSystem);
    const destinationId = constellationIdForSystem(destinationSystem);
    if (sourceId === null || destinationId === null || String(sourceId) === String(destinationId)) continue;
    const [left, right] = [sourceId, destinationId].sort(compareIds);
    const key = `${left}:${right}`;
    if (!edgesMap.has(key)) edgesMap.set(key, {
      id: key,
      source_id: left,
      destination_id: right,
      gate_pairs: [],
    });
    const edge = edgesMap.get(key);
    const [sourceSystemId, destinationSystemId] = [sourceSystem.system_id, destinationSystem.system_id].sort(compareIds);
    const gateKey = `${left}:${right}:${sourceSystemId}:${destinationSystemId}`;
    if (gateKeys.has(gateKey)) continue;
    gateKeys.add(gateKey);
    const pair = { source_system_id: idNumber(sourceId === left ? sourceSystem.system_id : destinationSystem.system_id),
      destination_system_id: idNumber(sourceId === left ? destinationSystem.system_id : sourceSystem.system_id) };
    if (!edge.gate_pairs.some((item) => item.source_system_id === pair.source_system_id && item.destination_system_id === pair.destination_system_id)) {
      edge.gate_pairs.push(pair);
      edge.gate_pairs.sort((a, b) => compareIds(a.source_system_id, b.source_system_id) || compareIds(a.destination_system_id, b.destination_system_id));
    }
  }

  const nodes = [...constellationMap.values()]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((node) => ({ ...node }));
  return {
    nodes,
    edges: [...edgesMap.values()].sort((a, b) => compareIds(a.source_id, b.source_id) || compareIds(a.destination_id, b.destination_id)),
  };
}

export function summarizeOverviewForces(forces = [], systems = []) {
  const systemConstellations = new Map(
    systems.map((system) => [idNumber(system?.system_id), constellationIdForSystem(system)]),
  );
  const result = {};
  const ensureSummary = (id) => {
    if (id === null || id === undefined || id === "") return null;
    const key = String(id);
    if (!result[key]) result[key] = { forces: 0, knownPeople: 0, enemyForces: 0, friendlyForces: 0 };
    return result[key];
  };

  for (const force of forces) {
    const constellationId = systemConstellations.get(idNumber(force?.system_id));
    const summary = ensureSummary(constellationId);
    if (!summary) continue;
    if (force.side === "enemy") {
      summary.forces += 1;
      summary.enemyForces += 1;
      const people = numberOrNull(force.people);
      if (people !== null && people >= 0) summary.knownPeople += people;
    } else if (force.side === "friendly") {
      summary.friendlyForces += 1;
    }
  }
  return result;
}

/**
 * Project live intelligence separately from deployments. A report is a
 * transient map marker until a commander adopts its revision into a Force;
 * keeping this projection independent prevents report observations from
 * inflating force counts or being mistaken for confirmed deployments.
 */
export function projectReportMarkers(reports = [], systems = []) {
  const projected = new Map(
    systems
      .filter((system) => numberOrNull(system?.px) !== null && numberOrNull(system?.py) !== null)
      .map((system) => [idNumber(system?.system_id ?? system?.id), system]),
  );
  return reports
    .filter((report) => report?.status !== "confirmed")
    .map((report) => {
      const reportId = report?.id ?? report?.report_id;
      const systemId = idNumber(report?.system_id);
      const system = projected.get(systemId);
      if (reportId == null || system == null) return null;
      const marker = {
        id: reportId,
        report_id: reportId,
        system_id: systemId,
        system_name: report.system_name ?? system.zh_name ?? system.name ?? String(systemId),
        author_name: report.author_name ?? "未知斥候",
        people: report.people ?? null,
        ships: report.ships ?? {},
        notes: report.notes ?? "",
        status: report.status ?? "pending",
        px: Number(system.px),
        py: Number(system.py),
      };
      if (Object.prototype.hasOwnProperty.call(report, "author_id")) marker.author_id = report.author_id;
      if (Object.prototype.hasOwnProperty.call(report, "observed_at")) marker.observed_at = report.observed_at;
      return marker;
    })
    .filter(Boolean);
}

export function nearestSystemAt(nodes = [], point = {}, maxDistance = 20) {
  const x = numberOrNull(point.x);
  const y = numberOrNull(point.y);
  const limit = Math.max(0, numberOrNull(maxDistance) ?? 20);
  if (x === null || y === null) return null;
  let nearest = null;
  let distance = limit;
  for (const node of nodes) {
    if (node?.valid === false || node?.system_id === null || node?.system_id === undefined) continue;
    const px = numberOrNull(node.px ?? node.x);
    const py = numberOrNull(node.py ?? node.y);
    if (px === null || py === null) continue;
    const nextDistance = Math.hypot(x - px, y - py);
    if (nextDistance > distance) continue;
    if (
      nearest === null ||
      nextDistance < distance ||
      (nextDistance === distance && compareIds(node.system_id, nearest.system_id) < 0)
    ) {
      nearest = node;
      distance = nextDistance;
    }
  }
  return nearest;
}

export function nearestVisibleSystemAt(nodes, point, view, viewport, radius = 38) {
  const inside = ({x,y}) => Number.isFinite(x) && Number.isFinite(y) && x>=0 && y>=0 && x<=viewport.width && y<=viewport.height;
  if (!inside(point) || !Number.isFinite(view.scale) || view.scale<=0) return null;
  const world = {x:(point.x-view.x)/view.scale,y:(point.y-view.y)/view.scale};
  return nearestSystemAt(nodes.filter(node=>inside({x:node.px*view.scale+view.x,y:node.py*view.scale+view.y})), world, radius/view.scale);
}

export function fitCamera(bounds, viewport = {}, padding = DEFAULT_PADDING) {
  const width = Math.max(0, Number(viewport.width) || 0);
  const height = Math.max(0, Number(viewport.height) || 0);
  const { left = 0, right = 0, top = 0, bottom = 0 } = mergePadding(padding);
  const safeWidth = Math.max(0, width - left - right);
  const safeHeight = Math.max(0, height - top - bottom);
  const minX = numberOrNull(bounds?.minX) ?? 0;
  const maxX = numberOrNull(bounds?.maxX) ?? minX;
  const minY = numberOrNull(bounds?.minY) ?? 0;
  const maxY = numberOrNull(bounds?.maxY) ?? minY;
  const spanX = Math.max(Math.abs(maxX - minX), 1);
  const spanY = Math.max(Math.abs(maxY - minY), 1);
  const zoom = Math.min(safeWidth / spanX, safeHeight / spanY) || 1;
  return {
    zoom,
    panX: left + (safeWidth - spanX * zoom) / 2 - minX * zoom,
    panY: top + (safeHeight - spanY * zoom) / 2 - minY * zoom,
  };
}

export function zoomAroundPoint(view = {}, point = {}, multiplier = 1, limits = {}) {
  const zoom = numberOrNull(view.zoom) ?? 1;
  const panX = numberOrNull(view.panX) ?? 0;
  const panY = numberOrNull(view.panY) ?? 0;
  const pointerX = numberOrNull(point.x) ?? 0;
  const pointerY = numberOrNull(point.y) ?? 0;
  const factor = numberOrNull(multiplier) ?? 1;
  const min = numberOrNull(limits.min) ?? 0.1;
  const max = numberOrNull(limits.max) ?? 10;
  const nextZoom = Math.min(max, Math.max(min, zoom * factor));
  const worldX = (pointerX - panX) / zoom;
  const worldY = (pointerY - panY) / zoom;
  return {
    zoom: nextZoom,
    panX: pointerX - worldX * nextZoom,
    panY: pointerY - worldY * nextZoom,
  };
}

export function boundaryPortals(boundaryExits = []) {
  return boundaryExits
    .map((exit) => {
      const sourceId = idNumber(exit?.source_system_id ?? exit?.source_id ?? exit?.system_id);
      const destinationId = idNumber(exit?.destination_system_id ?? exit?.destination_id ?? exit?.target_system_id);
      const destinationName = exit?.destination_name ?? exit?.target_name ?? exit?.destination_system_name ?? "范围外星系";
      return {
        id: `${sourceId}:${destinationId}`,
        source_system_id: sourceId,
        source_name: exit?.source_name ?? exit?.system_name ?? "当前星系",
        destination_system_id: destinationId,
        destination_name: destinationName,
        ...(exit?.destination_constellation_id == null ? {} : { destination_constellation_id: idNumber(exit.destination_constellation_id) }),
        label: destinationName,
        outside: true,
      };
    })
    .filter((portal) => portal.source_system_id !== null && portal.destination_system_id !== null)
    .sort((a, b) => compareIds(a.source_system_id, b.source_system_id) || compareIds(a.destination_system_id, b.destination_system_id));
}

const topologyId = (node) => idNumber(node?.system_id ?? node?.id);
const topologyEdge = (edge) => [
  idNumber(edge?.source_id ?? edge?.system_id),
  idNumber(edge?.destination_id ?? edge?.destination_system_id),
];

/**
 * Lay out a small tactical topology in stable breadth-first columns. This is
 * intentionally schematic: positions depend only on static node/edge data,
 * never on current reports or force counts.
 */
export function layoutTopology(nodes = [], edges = [], { spacingX = 220, spacingY = 120 } = {}) {
  const byId = new Map();
  for (const node of nodes) {
    const id = topologyId(node);
    if (id !== null) byId.set(id, node);
  }
  const adjacency = new Map([...byId.keys()].map((id) => [id, new Set()]));
  for (const edge of edges) {
    const [source, destination] = topologyEdge(edge);
    if (source === null || destination === null || !byId.has(source) || !byId.has(destination) || String(source) === String(destination)) continue;
    adjacency.get(source).add(destination);
    adjacency.get(destination).add(source);
  }
  const compareNodes = compareIds;
  const roots = [...byId.keys()].sort(compareNodes);
  const visited = new Set();
  const positions = new Map();
  const ordered = [];
  const levelRows = new Map();
  const visit = (root) => {
    const queue = [{ id: root, depth: 0 }];
    while (queue.length) {
      const current = queue.shift();
      if (visited.has(current.id)) continue;
      visited.add(current.id);
      const row = levelRows.get(current.depth) || 0;
      levelRows.set(current.depth, row + 1);
      positions.set(current.id, { px: current.depth * spacingX, py: row * spacingY });
      ordered.push(current.id);
      const neighbors = [...(adjacency.get(current.id) || [])].filter((id) => !visited.has(id)).sort(compareNodes);
      queue.push(...neighbors.map((id) => ({ id, depth: current.depth + 1 })));
    }
  };
  for (const root of roots) if (!visited.has(root)) visit(root);
  return ordered.map((id) => ({ ...byId.get(id), px: positions.get(id).px, py: positions.get(id).py }));
}

/** Return gate exits from visible systems, retaining loaded and external targets. */
export function visibleGateExits(systems = [], gates = [], boundaryExits = [], visibleIds = []) {
  const visible = new Set(visibleIds.map(idNumber));
  const names = new Map(systems.map((system) => [idNumber(system?.system_id ?? system?.id), system?.zh_name || system?.name || String(system?.system_id ?? system?.id)]));
  const result = new Map();
  const add = ({ id, source, destination, destinationName, loaded }) => {
    if (source === null || destination === null || !visible.has(source) || visible.has(destination) || String(source) === String(destination)) return;
    const key = `${source}:${destination}`;
    if (!result.has(key)) result.set(key, { id, source_system_id: source, destination_system_id: destination, destination_name: destinationName || names.get(destination) || "范围外星系", loaded });
  };
  for (const gate of gates) {
    const source = idNumber(gate?.system_id ?? gate?.source_id);
    const destination = idNumber(gate?.destination_system_id ?? gate?.destination_id);
    if (source === null || destination === null) continue;
    if (visible.has(source)) add({ id: gate?.id ?? gate?.stargate_id ?? `${source}:${destination}`, source, destination, destinationName: gate?.destination_name, loaded: names.has(destination) });
    else if (visible.has(destination)) add({ id: gate?.id ?? gate?.stargate_id ?? `${destination}:${source}`, source: destination, destination: source, destinationName: names.get(source), loaded: names.has(source) });
  }
  for (const portal of boundaryExits) {
    const source = idNumber(portal?.source_system_id ?? portal?.source_id ?? portal?.system_id);
    const destination = idNumber(portal?.destination_system_id ?? portal?.destination_id);
    add({id: portal?.id ?? `${source}:${destination}`, source, destination, destinationName:portal?.destination_name, loaded:names.has(destination)});
  }
  return [...result.values()].sort((left, right) => compareIds(left.source_system_id, right.source_system_id) || compareIds(left.destination_system_id, right.destination_system_id));
}
