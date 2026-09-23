import { groupMapForces, SHIP_TYPES } from './tacticalCollaboration.js';
import { latestSystemIntel } from './tacticalSystemIntel.js';

export function textWidth(value, fontSize = 12) {
  return Array.from(String(value)).reduce((width, char) => width + fontSize *
    (/\s/.test(char) ? .28 : char.codePointAt(0) > 255 ? 1 : .62), 0);
}

export function fitMarkerText(value, availableWidth, fontSize = 12) {
  const text = String(value);
  if (textWidth(text, fontSize) <= availableWidth) return text;
  const chars = Array.from(text);
  while (chars.length && textWidth(chars.join('') + '…', fontSize) > availableWidth) chars.pop();
  return chars.join('') + '…';
}

export const countLabel = count => count == null ? '未知' : count >= 10000 ? `${(count / 10000).toFixed(1)}万` : String(count);
const widthFor = (lines, fontSize, min, max) => Math.max(min, Math.min(max, Math.ceil(Math.max(...lines.map(line => textWidth(line, fontSize))) + 18)));

// Reserve the number before shortening the name so a long fleet title can never
// hide the tactical information. Full names remain in the accessible label/title.
export function fleetMarkerLabel(force, markerWidth = 220) {
  const name = String(force.name || (force.side === 'friendly' ? '己方' : '敌方')).trim();
  const count = force.people == null ? '未知' : `${countLabel(force.people)}人`;
  const availableNameWidth = Math.max(0, markerWidth - 18 - textWidth(` ${count}`));
  return `${fitMarkerText(name, availableNameWidth)} ${count}`;
}

// Count-only observations stay distinct from fleets even when their system
// position is corrected. Keep one current snapshot per star on the map.
export function buildSystemCountMarkerGroups(reports = []) {
  return latestSystemIntel(reports).map(report => {
    const label = `人数上报 ${report.people == null ? '未知' : `${countLabel(report.people)}人`}`;
    const markerWidth = Math.min(220, widthFor([label], 12, 76, 198) + 22);
    return {
      kind:'system_count', key:`system-count-${report.system_id}`, system_id:Number(report.system_id),
      visible:[{...report, label, markerWidth}], total:1, hiddenCount:0, markerWidth, rowHeight:26,
    };
  });
}

// Reports remain observations, never force rows. Each layer has its own bounded
// stack and overflow link, so repeated sightings are not silently added up.
export function buildMarkerGroups(forces = [], reports = [], selectedForceId) {
  const forceGroups = groupMapForces(forces, selectedForceId).map(group => {
    const visible = group.visible.map(force => {
      const label = fleetMarkerLabel(force, Infinity);
      return {...force, label, markerWidth: widthFor([label],12,76,220)};
    });
    const overflowWidth = group.hiddenCount ? widthFor([`+ ${group.hiddenCount} 支部署`],12,76,180) : 0;
    return {...group, kind:'force', key:`force-${group.system_id}`, visible, overflowWidth,
      markerWidth: Math.max(...visible.map(item=>item.markerWidth),overflowWidth)};
  });
  const groupedReports = new Map();
  for (const report of reports) {
    if (!report || report.status === 'confirmed' || report.status === 'withdrawn') continue;
    const systemId = Number(report.system_id);
    if (!groupedReports.has(systemId)) groupedReports.set(systemId, []);
    const label = `报 · ${countLabel(report.people)} 人`;
    const authorLabel = `上报：${report.author_name || '未知斥候'}`;
    const shipLabel = Object.entries(SHIP_TYPES).filter(([type])=>report.ships?.[type] != null)
      .map(([type,name])=>`${name} ${report.ships[type]}`).join(' · ') || '船型未知';
    groupedReports.get(systemId).push({...report,label,authorLabel,shipLabel,
      markerWidth:widthFor([label,authorLabel,shipLabel],11,110,210)});
  }
  return [...forceGroups,...Array.from(groupedReports,([system_id,rows])=>{
    rows.sort((a,b)=>(Date.parse(b.observed_at)||0)-(Date.parse(a.observed_at)||0) || Number(a.id)-Number(b.id));
    const visible = rows.slice(0,2);
    return {kind:'report',key:`report-${system_id}`,system_id,visible,total:rows.length,
      hiddenCount:Math.max(0,rows.length-2),markerWidth:Math.max(...visible.map(item=>item.markerWidth)),rowHeight:58};
  })];
}

// Avoid laying out off-viewport callouts on dense maps. Selected systems remain
// eligible so keyboard/list selection can still reveal their report marker.
export function markerGroupsForViewport(groups = [], nodes = [], viewport = {}, {selectedSystemId = null, margin = 80, view = null, showReports = false} = {}) {
  const width = Number(viewport.width) || 0;
  const height = Number(viewport.height) || 0;
  const byId = new Map(nodes.map(node => [Number(node.system_id), node]));
  return groups.filter(group => {
    // Historical reports remain available from the side panel and the
    // selected-system detail, but do not compete with current deployments on
    // the overview map unless the operator explicitly expands them.
    if (group.kind === 'report' && !showReports && Number(group.system_id) !== Number(selectedSystemId)) return false;
    const node = byId.get(Number(group.system_id));
    if (!node) return false;
    if (selectedSystemId != null && Number(group.system_id) === Number(selectedSystemId)) return true;
    const scale = Number(view?.scale) || 1;
    const panX = Number(view?.x) || 0;
    const panY = Number(view?.y) || 0;
    const screenX = node.px * scale + panX;
    const screenY = node.py * scale + panY;
    return screenX >= -margin && screenX <= width + margin && screenY >= -margin && screenY <= height + margin;
  });
}
