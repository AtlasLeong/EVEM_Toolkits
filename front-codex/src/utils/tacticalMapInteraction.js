import { textWidth } from './tacticalMapPresentation.js';
import { rectanglesOverlap } from './tacticalMapScreen.js';
import { zoomAroundPoint } from './tacticalMapLayout.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const inside = (point, {width, height}) => point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;

/**
 * Focus leaders are an aid for the selected system, not part of the map
 * topology. Tactical cards have their own quiet, always-visible leaders;
 * this helper keeps the extra name/focus leader limited to one connection.
 */
export function shouldShowMapLeader(systemId, { selectedSystemId = null, hoveredSystemId = null } = {}) {
  const id = Number(systemId);
  if (!Number.isSafeInteger(id) || id <= 0) return false;
  return id === Number(selectedSystemId) || id === Number(hoveredSystemId);
}

// A focused system may have several fleet/count groups plus a name label.
// Prefer the shortest useful link, and leave nearby callouts unconnected.
export function leaderSegmentsForFocus(groups = [], labels = [], {
  selectedSystemId = null, hoveredSystemId = null, width = Infinity, height = Infinity,
} = {}) {
  const focusId = Number(hoveredSystemId ?? selectedSystemId);
  if (!Number.isSafeInteger(focusId) || focusId <= 0) return [];
  const candidates = [...groups, ...labels].filter(row => Number(row.system_id) === focusId)
    .map(row => {
      const {from, to} = row.leader || {};
      if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return null;
      if (![from, to].every(point => inside(point, {width, height}))) return null;
      if (row.node && !inside({x:row.node.px, y:row.node.py}, {width, height})) return null;
      return {system_id:focusId, from, to, distance:Math.hypot(from.x-to.x, from.y-to.y)};
    }).filter(candidate => candidate && candidate.distance > 22 && candidate.distance <= 96)
    .sort((a,b) => a.distance-b.distance || a.from.x-b.from.x || a.from.y-b.from.y || a.to.x-b.to.x || a.to.y-b.to.y);
  const nearest = candidates[0];
  return nearest
    ? [{system_id:nearest.system_id, from:nearest.from, to:nearest.to}] : [];
}

// Every visible tactical card keeps a low-contrast connection to its owning
// star. Selection or hover promotes the line without inventing a second
// network on top of the real stargate topology.
export function markerLeaderSegments(groups = [], {
  selectedSystemId = null, hoveredSystemId = null, selectedForceId = null,
} = {}) {
  const focusId = Number(hoveredSystemId ?? selectedSystemId);
  return groups.flatMap((group, index) => {
    const {from, to} = group.leader || {};
    if (![from?.x, from?.y, to?.x, to?.y].every(Number.isFinite)) return [];
    const distance = Math.hypot(from.x - to.x, from.y - to.y);
    if (distance < 10) return [];
    const forceSelected = group.kind === 'force' &&
      (group.visible || []).some(force => Number(force.id) === Number(selectedForceId));
    return [{
      key: group.key ?? `${group.kind || 'marker'}-${index}`,
      system_id: Number(group.system_id),
      from, to,
      active: Number(group.system_id) === focusId || forceSelected,
    }];
  });
}

// Liang-Barsky clipping also handles horizontal and vertical gates without
// division by zero. Reject invalid geometry before it can influence layout.
export function segmentIntersectsRect(segment, rect) {
  const {x1,y1,x2,y2} = segment || {};
  const {x,y,width,height} = rect || {};
  if (![x1,y1,x2,y2,x,y,width,height].every(Number.isFinite) || width <= 0 || height <= 0) return false;
  const dx=x2-x1, dy=y2-y1;
  const p=[-dx,dx,-dy,dy], q=[x1-x,x+width-x1,y1-y,y+height-y1];
  let enter=0, exit=1;
  for (let i=0;i<4;i++) {
    if (p[i]===0) { if (q[i]<0) return false; continue; }
    const bound=q[i]/p[i];
    if (p[i]<0) enter=Math.max(enter,bound);
    else exit=Math.min(exit,bound);
    if (enter>exit) return false;
  }
  return true;
}

// Build once for the current screen transform. Querying a name slot then
// examines only gates whose bounding boxes occupy its nearby grid cells,
// including gates whose endpoints belong to entirely different systems.
export function indexGateSegments(segments = [], {width, height, cellSize = 128} = {}) {
  const size = Number.isFinite(cellSize) && cellSize > 0 ? cellSize : 128;
  const columns = Math.max(1, Math.ceil(width / size));
  const rows = Math.max(1, Math.ceil(height / size));
  const cells = new Map();
  for (const segment of segments) {
    const {x1,y1,x2,y2} = segment;
    if (![x1,y1,x2,y2].every(Number.isFinite)) continue;
    const left=Math.max(0,Math.min(x1,x2)), right=Math.min(width,Math.max(x1,x2));
    const top=Math.max(0,Math.min(y1,y2)), bottom=Math.min(height,Math.max(y1,y2));
    if (left>right || top>bottom) continue;
    const x0=Math.min(columns-1,Math.floor(left/size)), x1Cell=Math.min(columns-1,Math.floor(right/size));
    const y0=Math.min(rows-1,Math.floor(top/size)), y1Cell=Math.min(rows-1,Math.floor(bottom/size));
    for (let cy=y0;cy<=y1Cell;cy++) for (let cx=x0;cx<=x1Cell;cx++) {
      const key=cy*columns+cx;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(segment);
    }
  }
  return {cells,cellSize:size,columns,rows};
}

function indexedGateCrossesRect(index, rect) {
  const {cells,cellSize,columns,rows} = index;
  const x0=Math.max(0,Math.min(columns-1,Math.floor(rect.x/cellSize)));
  const x1=Math.max(0,Math.min(columns-1,Math.floor((rect.x+rect.width)/cellSize)));
  const y0=Math.max(0,Math.min(rows-1,Math.floor(rect.y/cellSize)));
  const y1=Math.max(0,Math.min(rows-1,Math.floor((rect.y+rect.height)/cellSize)));
  const seen=new Set();
  for (let cy=y0;cy<=y1;cy++) for (let cx=x0;cx<=x1;cx++) {
    for (const segment of cells.get(cy*columns+cx) || []) {
      if (seen.has(segment)) continue;
      seen.add(segment);
      if (segmentIntersectsRect(segment,rect)) return true;
    }
  }
  return false;
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

/**
 * Convert browser wheel units into one stable logical delta. Browsers may
 * report the same gesture as pixels, lines, or pages; keeping the conversion
 * here means both tactical boards feed the camera the same numbers.
 */
export function normalizeWheelDelta(event = {}, {
  lineHeight = 16,
  pageHeight = 800,
  max = 1200,
} = {}) {
  const raw = Number(event?.deltaY);
  if (!Number.isFinite(raw) || raw === 0) return 0;
  const mode = Number(event?.deltaMode) || 0;
  const unit = mode === 1 ? Math.max(1, Number(lineHeight) || 16)
    : mode === 2 ? Math.max(1, Number(pageHeight) || 800) : 1;
  const bound = Math.max(1, Number(max) || 1200);
  return clamp(raw * unit, -bound, bound);
}

/**
 * Small mutable camera contract used by DOM-only wheel previews. React owns
 * the committed snapshot; the preview can advance independently until the
 * gesture settles without mutating that snapshot or forcing a full render.
 */
export function createLiveCameraPreview(initial = {}) {
  const normalize = value => ({
    x: Number.isFinite(Number(value?.x)) ? Number(value.x) : 0,
    y: Number.isFinite(Number(value?.y)) ? Number(value.y) : 0,
    scale: Number.isFinite(Number(value?.scale)) && Number(value.scale) > 0 ? Number(value.scale) : 1,
  });
  let settled = normalize(initial);
  let live = {...settled};
  return {
    get: () => ({...live}),
    committed: () => ({...settled}),
    set: next => {
      live = normalize(typeof next === 'function' ? next({...live}) : next);
      return {...live};
    },
    commit: next => {
      settled = normalize(next === undefined ? live : typeof next === 'function' ? next({...live}) : next);
      live = {...settled};
      return {...settled};
    },
    reset: next => {
      settled = normalize(next === undefined ? settled : next);
      live = {...settled};
      return {...settled};
    },
  };
}

// Consume one accumulated wheel frame. Keeping this reducer pure lets the
// component move a single camera layer without rebuilding label and marker
// layouts for every native wheel event.
export function wheelCameraFrame({view = {}, delta = 0, anchor = {}, limits = {min:.5, max:16}} = {}) {
  const amount = Number(delta);
  if (!Number.isFinite(amount) || amount === 0) return {view:{...view}, consumedDelta:0};
  const factor = Math.exp(-Math.max(-120, Math.min(120, amount)) * .001);
  const next = zoomAroundPoint({zoom:view.scale, panX:view.x, panY:view.y}, anchor, factor, limits);
  return {
    view:{x:next.panX, y:next.panY, scale:next.zoom},
    consumedDelta:amount,
  };
}

// Enter and exit thresholds are intentionally different. This prevents the
// full name layer from flickering when a wheel gesture hovers near one zoom
// boundary.
export function labelVisibilityState({visible = false, zoom = 1, enter = 1.72, exit = 1.5} = {}) {
  const previous = Boolean(visible);
  const next = previous ? Number(zoom) >= exit : Number(zoom) >= enter;
  return {visible:next, changed:next !== previous};
}

export function labelMotionPhase({zooming = false, settling = false} = {}) {
  if (zooming) return 'moving';
  if (settling) return 'settling';
  return 'idle';
}

// Between wheel frames, keep each settled name at its chosen screen-space
// offset from its own real star. This is linear in visible labels and avoids
// rerunning the collision solver until the gesture has ended.
export function translateWheelLabels(labels = [], settledNodes = [], currentNodes = []) {
  const previous = new Map(settledNodes.map(node => [Number(node.system_id), node]));
  const current = new Map(currentNodes.map(node => [Number(node.system_id), node]));
  return labels.flatMap(label => {
    const before = previous.get(Number(label.system_id)), after = current.get(Number(label.system_id));
    if (!before || !after) return [];
    const dx = after.px - before.px, dy = after.py - before.py;
    const movePoint = point => ({x:point.x + dx, y:point.y + dy});
    return [{...label, x:label.x + dx, y:label.y + dy,
      ...(label.leader ? {leader:{from:movePoint(label.leader.from),to:movePoint(label.leader.to)}} : {})}];
  });
}

export function wheelLabelState(label, {zooming = false, selectedSystemId = null, forceIds = new Set()} = {}) {
  const id = Number(label.system_id);
  const priority = id === Number(selectedSystemId) || Boolean(label.intel) || forceIds.has(id);
  return {priority, dimmed:zooming && !priority};
}

export function labelsForWheelFrame({zooming = false, settled = null, nodes = [], options = {}} = {}) {
  return zooming && settled
    ? translateWheelLabels(settled.labels, settled.nodes, nodes)
    : layoutIntelLabels(nodes, options);
}

// Labels are screen-space annotations only. Neither decluttering nor focus
// changes any real system coordinates or gate topology.
export function layoutIntelLabels(nodes, {
  width, height, selectedId, hoveredId, intelById = new Map(), forceIds = new Set(),
  zoom = 1, showAll = false, showDense = null, occupied = [], gateSegments = [], padding = {left:14, right:14, top:110, bottom:18},
} = {}) {
  const gateIndex = Array.isArray(gateSegments) ? indexGateSegments(gateSegments,{width,height}) : gateSegments;
  const priority = node => Number(node.system_id) === Number(selectedId) ? 0 : Number(node.system_id) === Number(hoveredId) ? 1 : intelById.has(Number(node.system_id)) ? 2 : forceIds.has(Number(node.system_id)) ? 3 : 4;
  // Callers that maintain a zoom hysteresis state can override the legacy
  // threshold. Keeping null as the default preserves the standalone helper's
  // existing behavior for consumers outside the tactical map component.
  const revealDense = showDense == null ? zoom >= 1.7 : Boolean(showDense);
  const ordered = nodes.filter(node => inside({x:node.px, y:node.py}, {width, height}))
    .filter(node => showAll || priority(node) < 4 || revealDense || !nodes.some(other => other !== node && Math.hypot(other.px-node.px, other.py-node.py) < 52))
    .sort((a,b) => priority(a)-priority(b) || Number(a.system_id)-Number(b.system_id));
  const placed = [];
  for (const node of ordered) {
    const intel = intelById.get(Number(node.system_id));
    const name = node.zh_name || node.name || String(node.system_id);
    const w = Math.max(56, Math.ceil(textWidth(name, 13) + 8));
    const h = 34;
    const positions = [];
    const distances=[13,34,60,92];
    for (const distance of distances) positions.push(
      [node.px-w/2, node.py+distance], [node.px-w/2, node.py-distance-h],
      [node.px+distance, node.py-h/2], [node.px-distance-w, node.py-h/2],
      [node.px+distance, node.py+distance], [node.px-distance-w, node.py-distance-h],
      [node.px+distance, node.py-distance-h], [node.px-distance-w, node.py+distance],
    );
    let best = null;
    for (const [index,[x,y]] of positions.entries()) {
      const distance = distances[Math.floor(index/8)];
      // Later candidates cannot beat this score even if no gate crosses them.
      if (best && distance+index/100 >= best.score) break;
      const rect = {x,y,width:w,height:h};
      if (x < padding.left || y < padding.top || x+w > width-padding.right || y+h > height-padding.bottom) continue;
      if ([...occupied,...placed].some(other => rectanglesOverlap(rect, {x:other.x-4,y:other.y-3,width:other.width+8,height:other.height+6}))) continue;
      if (nodes.some(other => other !== node && rectanglesOverlap(rect, {x:other.px-6,y:other.py-6,width:12,height:12}))) continue;
      const crossed = indexedGateCrossesRect(gateIndex,rect);
      // Crossing a gate costs roughly one near-distance ring. A clear 34/60px
      // slot wins, but a tiny backed label stays preferable to a 92px jump.
      const score = distance + (crossed ? 50 : 0) + index/100;
      if (!best || score<best.score) best={rect,crossed,score};
    }
    if (best) {
      const {rect,crossed} = best;
      placed.push({...rect, system_id:node.system_id, name, intel, gateBackdrop:crossed,
      leader:{from:{x:node.px,y:node.py},to:{x:clamp(node.px,rect.x,rect.x+w),y:clamp(node.py,rect.y,rect.y+h)}}});
    }
  }
  return placed;
}
