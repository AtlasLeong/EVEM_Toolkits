import { textWidth } from './tacticalMapPresentation.js';
import { rectanglesOverlap } from './tacticalMapScreen.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const inside = (point, {width, height}) => point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;

/**
 * Callout leaders are an aid for the focused system, not part of the map
 * topology. Rendering one for every marker makes a busy battle area look like
 * a second (fake) network and causes visual noise when the live snapshot is
 * refreshed. Keep the line only while the related system is focused/hovered.
 * The decision is pure so the SVG tree stays deterministic across snapshots.
 */
export function shouldShowMapLeader(systemId, { selectedSystemId = null, hoveredSystemId = null } = {}) {
  const id = Number(systemId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return id === Number(selectedSystemId) || id === Number(hoveredSystemId);
}

export function resolveSystemHit(nodes, point, view, viewport, radius = 23) {
  if (!inside(point, viewport)) return {target:null, candidates:[], ambiguous:false};
  const ranked = nodes.map(node => ({node, point:{x:node.px * view.scale + view.x, y:node.py * view.scale + view.y}}))
    .filter(row => inside(row.point, viewport))
    .map(row => ({...row, distance:Math.hypot(row.point.x - point.x, row.point.y - point.y)}))
    .filter(row => row.distance <= radius)
    .sort((a, b) => a.distance - b.distance || Number(a.node.system_id) - Number(b.node.system_id));
  const ambiguous = ranked.length > 1 && ranked[1].distance - ranked[0].distance < 7;
  return {target:ranked.length && !ambiguous ? ranked[0].node : null, candidates:ranked.map(row => row.node), ambiguous};
}

export function focusDenseArea(nodes, view, {width, height}, maxScale = 16) {
  const valid = nodes.filter(node => Number.isFinite(node.px) && Number.isFinite(node.py));
  if (!valid.length) return {...view};
  const xs = valid.map(node => node.px), ys = valid.map(node => node.py);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  let closest = Infinity;
  for (let i = 0; i < valid.length; i++) for (let j = i + 1; j < valid.length; j++) {
    closest = Math.min(closest, Math.hypot(valid[i].px - valid[j].px, valid[i].py - valid[j].py));
  }
  const fit = Math.min(width * .68 / Math.max(1, maxX - minX), height * .62 / Math.max(1, maxY - minY));
  const requested = closest === 0 ? maxScale : Math.max(view.scale * 1.8, 50 / closest);
  const scale = clamp(Math.max(view.scale, Math.min(requested, fit)), .5, maxScale);
  return {scale, x:width / 2 - (minX + maxX) / 2 * scale, y:height / 2 - (minY + maxY) / 2 * scale};
}

export function validateDirectMove(snapshot, forces, destination, nodes, canMove) {
  if (!canMove) return {ok:false, reason:'当前没有移动部署的权限或连接不可用。'};
  const live = forces.find(force => Number(force.id) === Number(snapshot?.id));
  if (!live || live.version !== snapshot.version || Number(live.system_id) !== Number(snapshot.system_id)) {
    return {ok:false, reason:'这支部署已被其他人更新，请重新拖动。'};
  }
  const id = Number(destination);
  if (!nodes.some(node => Number(node.system_id) === id)) return {ok:false, reason:'请拖到已加载的星系上。'};
  if (id === Number(snapshot.system_id)) return {ok:false, reason:''};
  return {ok:true, destination_system_id:id};
}

export function subscribeMapWheel(node, onWheel) {
  const handler = event => { event.preventDefault(); onWheel(event); };
  node.addEventListener('wheel', handler, {passive:false});
  return () => node.removeEventListener('wheel', handler);
}

// Labels are screen-space annotations only. Neither decluttering nor focus
// changes any real system coordinates or gate topology.
export function layoutIntelLabels(nodes, {
  width, height, selectedId, hoveredId, intelById = new Map(), forceIds = new Set(),
  zoom = 1, showAll = false, occupied = [], padding = {left:14, right:14, top:110, bottom:18},
} = {}) {
  const priority = node => Number(node.system_id) === Number(selectedId) ? 0 : Number(node.system_id) === Number(hoveredId) ? 1 : intelById.has(Number(node.system_id)) ? 2 : forceIds.has(Number(node.system_id)) ? 3 : 4;
  const ordered = nodes.filter(node => inside({x:node.px, y:node.py}, {width, height}))
    .filter(node => showAll || priority(node) < 4 || zoom >= 1.7 || !nodes.some(other => other !== node && Math.hypot(other.px-node.px, other.py-node.py) < 52))
    .sort((a,b) => priority(a)-priority(b) || Number(a.system_id)-Number(b.system_id));
  const placed = [];
  for (const node of ordered) {
    const intel = intelById.get(Number(node.system_id));
    const name = node.zh_name || node.name || String(node.system_id);
    const w = Math.max(56, Math.ceil(textWidth(name, 13) + 8));
    const h = 34;
    const positions = [];
    for (const distance of [13, 34, 60, 92]) positions.push(
      [node.px-w/2, node.py+distance], [node.px-w/2, node.py-distance-h],
      [node.px+distance, node.py-h/2], [node.px-distance-w, node.py-h/2],
      [node.px+distance, node.py+distance], [node.px-distance-w, node.py-distance-h],
      [node.px+distance, node.py-distance-h], [node.px-distance-w, node.py+distance],
    );
    for (const [x,y] of positions) {
      const rect = {x,y,width:w,height:h};
      if (x < padding.left || y < padding.top || x+w > width-padding.right || y+h > height-padding.bottom) continue;
      if ([...occupied,...placed].some(other => rectanglesOverlap(rect, {x:other.x-4,y:other.y-3,width:other.width+8,height:other.height+6}))) continue;
      if (nodes.some(other => other !== node && rectanglesOverlap(rect, {x:other.px-6,y:other.py-6,width:12,height:12}))) continue;
      placed.push({...rect, system_id:node.system_id, name, intel,
        leader:{from:{x:node.px,y:node.py},to:{x:clamp(node.px,x,x+w),y:clamp(node.py,y,y+h)}}});
      break;
    }
  }
  return placed;
}
