const DEFAULT_PADDING = { left: 90, right: 90, top: 80, bottom: 80 };

const numberOrNull = (value) => {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const idNumber = (value) => {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : value;
};

const compareIds = (left, right) => {
  const a = idNumber(left);
  const b = idNumber(right);
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), "en");
};

const mergePadding = (padding = {}) => ({
  ...DEFAULT_PADDING,
  ...padding,
});

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
    if (members.length) {
      node.x = members.reduce((sum, member) => sum + Number(member.x), 0) / members.length;
      node.z = members.reduce((sum, member) => sum + Number(member.z), 0) / members.length;
    }
    node.systems.sort(compareIds);
    node.system_count = node.systems.length;
    node.system_ids = [...node.systems];
    delete node.systems;
  }

  const edgesMap = new Map();
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
    const pair = {
      source_system_id: idNumber(sourceSystem.system_id),
      destination_system_id: idNumber(destinationSystem.system_id),
    };
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
