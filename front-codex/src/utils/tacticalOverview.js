import { isStale, permissions } from './tacticalCollaboration.js';
import { latestSystemIntel } from './tacticalSystemIntel.js';

const validId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;
const knownCount = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
const timestamp = value => Date.parse(value) || 0;
const staleObservation = (value, now) => !Number.isFinite(Date.parse(value)) || isStale(value, now);

function latestForces(forces) {
  const byId = new Map();
  for (const force of forces) {
    if (!force || !validId(force.id)) continue;
    const id = Number(force.id), previous = byId.get(id);
    const newer = !previous || Number(force.version || 0) > Number(previous.version || 0) ||
      (Number(force.version || 0) === Number(previous.version || 0) && timestamp(force.updated_at) > timestamp(previous.updated_at));
    if (newer) byId.set(id, force);
  }
  // Deduplicate before filtering: an archived or moved newer copy must fence
  // its previous deployment, including its previous side and scope.
  return [...byId.values()].filter(force => !force.archived && validId(force.system_id));
}

function summarizeSide(forces, reports, now) {
  const bySystem = new Map();
  const systemFor = item => {
    const systemId = Number(item.system_id);
    if (!bySystem.has(systemId)) bySystem.set(systemId, {
      systemId, systemName: item.system_name || String(systemId), forces: [], report: null,
    });
    return bySystem.get(systemId);
  };
  for (const force of forces) systemFor(force).forces.push(force);
  for (const report of reports) {
    const system = systemFor(report);
    system.report = report;
    if (report.system_name) system.systemName = report.system_name;
  }
  const systems = [...bySystem.values()].sort((a, b) => a.systemId - b.systemId).map(system => {
    const unknownForces = system.forces.filter(force => knownCount(force.people) === null).length;
    if (system.report) {
      const people = knownCount(system.report.people);
      const stale = staleObservation(system.report.observed_at, now);
      return {
        ...system, people, knownPeople: people ?? 0, unknownForces,
        source: 'system_report', observedAt: system.report.observed_at || null,
        stale, stalePeople: stale ? people ?? 0 : 0,
      };
    }
    const knownForces = system.forces.filter(force => knownCount(force.people) !== null);
    const knownPeople = knownForces.reduce((sum, force) => sum + force.people, 0);
    const contributing = knownForces.length ? knownForces : system.forces;
    const oldest = contributing.reduce((result, force) => !result || timestamp(force.observed_at) < timestamp(result.observed_at) ? force : result, null);
    return {
      ...system, people: unknownForces ? null : knownPeople, knownPeople, unknownForces,
      source: 'fleets', observedAt: oldest?.observed_at || null,
      stale: system.forces.some(force => staleObservation(force.observed_at, now)),
      stalePeople: knownForces.reduce((sum, force) => sum + (staleObservation(force.observed_at, now) ? force.people : 0), 0),
    };
  });
  return {
    knownPeople: systems.reduce((sum, system) => sum + system.knownPeople, 0),
    unknownSystems: systems.filter(system => system.people === null).length,
    unknownForces: forces.filter(force => knownCount(force.people) === null).length,
    fleetCount: forces.length,
    systemCount: systems.length,
    stalePeople: systems.reduce((sum, system) => sum + system.stalePeople, 0),
    staleSystems: systems.filter(system => system.stale).length,
    systems, forces,
  };
}

/**
 * Known estimates, not exact game population: a latest per-system observation
 * takes precedence over that system's fleet subtotal, even when its count is
 * unknown or older than a fleet. Never add the two sources together.
 *
 * outsideCount and scopeUnknown count deduplicated accessible records, not
 * people or systems. They remain available in all-scope mode for disclosure.
 * Original records are retained so rows can display provenance and select IDs.
 */
export function buildTacticalOverview({ forces = [], reports = [], role = 'scout', scope = 'current', systemIds = null, now = Date.now() } = {}) {
  const canSeeFriendly = permissions(role).manageForces;
  const visibleForces = latestForces(forces).filter(force => force.side === 'enemy' || (canSeeFriendly && force.side === 'friendly'));
  const currentReports = latestSystemIntel(reports.filter(report => report && !report.archived && report.side !== 'friendly'));
  const fallbackIds = systemIds === null ? null : new Set([...systemIds].filter(validId).map(Number));
  let outsideCount = 0, scopeUnknown = 0;
  const include = item => {
    const inScope = typeof item.in_scope === 'boolean' ? item.in_scope : fallbackIds === null ? null : fallbackIds.has(Number(item.system_id));
    if (inScope === false) outsideCount += 1;
    if (inScope === null) scopeUnknown += 1;
    return scope === 'all' || inScope === true;
  };
  const scopedForces = visibleForces.filter(include);
  const scopedReports = currentReports.filter(include);
  return {
    enemy: summarizeSide(scopedForces.filter(force => force.side === 'enemy'), scopedReports, now),
    friendly: canSeeFriendly ? summarizeSide(scopedForces.filter(force => force.side === 'friendly'), [], now) : null,
    outsideCount, scopeUnknown,
  };
}
