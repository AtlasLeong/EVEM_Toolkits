import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Crosshair, Eye, EyeOff, Minus, Plus, Type, X } from 'lucide-react';
import { layoutForceMarkers, rememberVisibleMarkerSlots, translateMarkerGroups } from '../../utils/tacticalMarkerLayout';
import { adjacentSystems, isStale, ageLabel } from '../../utils/tacticalCollaboration';
import { buildMarkerGroups, buildSystemCountMarkerGroups, fitMarkerText, fleetMarkerLabel, MARKER_CLOSE_SIZE, markerGroupsForViewport } from '../../utils/tacticalMapPresentation';
import { projectSystemsScoped, systemDisplayName, visibleGateExits, zoomAroundPoint } from '../../utils/tacticalMapLayout';
import { screenNodes } from '../../utils/tacticalMapScreen';
import { latestSystemIntel } from '../../utils/tacticalSystemIntel';
import { focusDenseArea, indexGateSegments, labelMotionPhase, labelVisibilityState, labelsForWheelFrame, leaderSegmentsForFocus, markerLeaderSegments, resolveSystemHit, subscribeMapWheel, validateDirectMove, wheelCameraFrame, wheelLabelState } from '../../utils/tacticalMapInteraction';
import '../../styles/tacticalMapIntel.css';

const securityColor = value => value == null ? '#a6adb1' : Number(value) >= .5 ? '#96b8a5' : Number(value) > 0 ? '#cfb288' : '#d19b91';
const securityLabel = value => value == null ? '安等未知' : Number(value).toFixed(2);
const INITIAL_VIEW = {x:0, y:0, scale:1};
const cameraTransform = ({x = 0, y = 0, scale = 1} = {}) => `translate(${x} ${y}) scale(${scale})`;

// The screen-space layer is rendered from the last committed view. During a
// wheel burst it can follow the camera with one affine transform, so React
// does not rebuild thousands of labels and markers for every native wheel
// event. React commits the final camera once the burst settles.
const relativeCameraTransform = (base = INITIAL_VIEW, next = INITIAL_VIEW) => {
  const ratio = next.scale / Math.max(.0001, base.scale);
  return `translate(${next.x - ratio * base.x} ${next.y - ratio * base.y}) scale(${ratio})`;
};

function MarkerCloseAction({x,y,label,title,className,dataArchiveForceId,onActivate}) {
  return <g role="button" tabIndex={0} aria-label={label} data-archive-force-id={dataArchiveForceId}
    transform={`translate(${x} ${y})`} className={`tac-marker-close ${className}`}
    onPointerDown={event=>event.stopPropagation()} onPointerUp={event=>event.stopPropagation()}
    onClick={event=>{event.stopPropagation();onActivate?.();}}
    onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();event.stopPropagation();onActivate?.();}}}>
    <title>{title}</title>
    <rect width={MARKER_CLOSE_SIZE} height={MARKER_CLOSE_SIZE} rx="5" fill="transparent"/>
    <path d="M7 7L17 17M17 7L7 17" fill="none" stroke="#e3c7b3" strokeWidth="1.6" strokeLinecap="round" pointerEvents="none"/>
  </g>;
}

export default function CollaborationMap({
  systems = [], stargates = [], forces = [], reports = [], boundaryExits = [],
  selectedSystemId, onSelectSystem, selectedForceId, onSelectForce, onFocusSystem,
  children, focusSystem, scope = null, canMove = false, onMoveForce, canArchiveForce = false, onArchiveForce, canMoveCount, canWithdrawCount,
  onMoveCount, onWithdrawCount, onMoveRejected, onSelectReport, onSelectCount, onFocusReports, className = '',
  canEditScope = false, onOpenScope,
}) {
  const [viewport, setViewport] = useState({width:1000, height:800});
  const [reservedUiRects, setReservedUiRects] = useState([]);
  const [view, setView] = useState(INITIAL_VIEW);
  const [previousViews, setPreviousViews] = useState([]);
  const [drag, setDrag] = useState(null);
  const [picker, setPicker] = useState(null);
  const [showAllNames, setShowAllNames] = useState(false);
  const [showReportMarkers, setShowReportMarkers] = useState(false);
  const [hoveredSystemId, setHoveredSystemId] = useState(null);
  const [isWheelZooming, setIsWheelZooming] = useState(false);
  const [isSettlingLabels, setIsSettlingLabels] = useState(false);
  const [showZoomLabels, setShowZoomLabels] = useState(false);
  const [visibleMarkerSlots, setVisibleMarkerSlots] = useState({scopeVersion:scope?.version ?? null, slots:new Map()});
  const ref = useRef(null), worldLayerRef = useRef(null), overlayLayerRef = useRef(null), gesture = useRef(null), suppressClick = useRef(false), wheelHandler = useRef(null), pickerRef = useRef(null);
  const wheelQueue = useRef({delta:0,anchor:null,frame:null,idle:null});
  const liveViewRef = useRef(INITIAL_VIEW);
  const settledLabels = useRef(null);
  const settledMarkerLayout = useRef(null);
  const labelSettleTimer = useRef(null);
  const scopeVersion = scope?.version ?? null;
  const fitIds = useMemo(() => {
    const regions = new Set((scope?.region_ids || []).map(Number));
    const core = regions.size ? systems.filter(node => regions.has(Number(node.region_id))) : systems;
    return (core.length ? core : systems).map(node => node.system_id);
  }, [scope?.region_ids, systems]);
  const nodes = useMemo(() => projectSystemsScoped(systems, {...viewport,
    padding:{left:76, right:76, top:175, bottom:70}, fitIds}), [systems, viewport, fitIds]);
  const byId = useMemo(() => new Map(nodes.map(node => [Number(node.system_id), node])), [nodes]);
  const intel = useMemo(() => latestSystemIntel(reports), [reports]);
  const intelById = useMemo(() => new Map(intel.map(row => [Number(row.system_id), row])), [intel]);
  const screenSystems = useMemo(() => screenNodes(nodes.map(node => ({...node, zh_name:systemDisplayName(node)})),
    {panX:view.x, panY:view.y, zoom:view.scale}), [nodes, view]);
  const gateSegments = useMemo(() => {
    if (isWheelZooming && settledLabels.current?.scopeVersion === scopeVersion && settledLabels.current.gateSegments)
      return settledLabels.current.gateSegments;
    const screenById = new Map(screenSystems.map(node => [Number(node.system_id), node]));
    const segments = [];
    for (const gate of stargates) {
      const sourceId=Number(gate.system_id), destinationId=Number(gate.destination_system_id);
      const a=screenById.get(sourceId), b=screenById.get(destinationId);
      if (!a || !b) continue;
      segments.push({x1:a.px,y1:a.py,x2:b.px,y2:b.py});
    }
    return indexGateSegments(segments,viewport);
  }, [stargates, screenSystems, viewport, isWheelZooming, scopeVersion]);
  const selectedNeighbors = useMemo(() => adjacentSystems(stargates, hoveredSystemId ?? selectedSystemId), [stargates, hoveredSystemId, selectedSystemId]);
  const allMarkerGroups = useMemo(() => [
    ...buildMarkerGroups(forces, reports, selectedForceId, {canArchiveForce}), ...buildSystemCountMarkerGroups(intel,{canWithdrawCount}),
  ].filter(group => byId.has(Number(group.system_id))), [forces, reports, selectedForceId, canArchiveForce, intel, canWithdrawCount, byId]);
  const eligibleMarkerGroups = useMemo(() => allMarkerGroups.filter(group => group.kind !== 'report' ||
    showReportMarkers || Number(group.system_id) === Number(selectedSystemId)), [allMarkerGroups, showReportMarkers, selectedSystemId]);
  const markerGroups = useMemo(() => markerGroupsForViewport(eligibleMarkerGroups, nodes, viewport,
    {selectedSystemId, view, showReports:showReportMarkers}), [eligibleMarkerGroups, nodes, viewport, selectedSystemId, view, showReportMarkers]);
  const forceSystems = useMemo(() => new Set(markerGroups.filter(group=>group.kind==='force').map(group => Number(group.system_id))), [markerGroups]);
  const basePreferredSlots = useMemo(() => new Map(layoutForceMarkers(eligibleMarkerGroups, nodes, 1,
    {...viewport, padding:{left:16, right:16, top:175, bottom:60}, reservedRects:reservedUiRects})
    .map(group => [group.key, group.slot])), [eligibleMarkerGroups, nodes, viewport, reservedUiRects]);
  const rememberedSlots = visibleMarkerSlots.scopeVersion === scopeVersion ? visibleMarkerSlots.slots : null;
  const preferredSlots = useMemo(() => new Map([...basePreferredSlots, ...(rememberedSlots || [])]),
    [basePreferredSlots, rememberedSlots]);
  const positionedGroups = useMemo(() => {
    const settled = settledMarkerLayout.current;
    if (isWheelZooming && settled?.scopeVersion === scopeVersion) {
      return translateMarkerGroups(settled.groups, settled.nodes, screenSystems);
    }
    return layoutForceMarkers(markerGroups, screenSystems, 1,
      {...viewport, padding:{left:16, right:16, top:175, bottom:60}, reservedRects:reservedUiRects, preferredSlots});
  }, [isWheelZooming, markerGroups, screenSystems, viewport, reservedUiRects, preferredSlots, scopeVersion]);
  useEffect(() => {
    setVisibleMarkerSlots(current => {
      const previous = current.scopeVersion === scopeVersion ? current.slots : new Map();
      const slots = rememberVisibleMarkerSlots(previous, positionedGroups);
      return current.scopeVersion === scopeVersion && slots === previous ? current : {scopeVersion, slots};
    });
  }, [positionedGroups, scopeVersion]);
  useLayoutEffect(() => {
    if (!isWheelZooming) {
      settledMarkerLayout.current = {scopeVersion, groups:positionedGroups, nodes:screenSystems};
    }
  }, [isWheelZooming, positionedGroups, screenSystems, scopeVersion]);
  useEffect(() => () => {
    if (labelSettleTimer.current !== null) clearTimeout(labelSettleTimer.current);
  }, []);
  useEffect(() => {
    if (isWheelZooming) return;
    const next = labelVisibilityState({visible:showZoomLabels, zoom:view.scale}).visible;
    if (next !== showZoomLabels) setShowZoomLabels(next);
  }, [isWheelZooming, showZoomLabels, view.scale]);
  useLayoutEffect(() => {
    liveViewRef.current = view;
    worldLayerRef.current?.setAttribute('transform', cameraTransform(view));
    overlayLayerRef.current?.removeAttribute('transform');
  }, [view]);
  const markers = useMemo(() => positionedGroups.filter(group=>group.kind==='force').flatMap(group => group.visible.map((force,index) => ({force,
    x:group.x+group.rowOffsets[index],y:group.y+index*(group.rowHeight+group.rowGap),width:group.rowWidths[index],height:group.rowHeight}))), [positionedGroups]);
  const countMarkers = useMemo(() => positionedGroups.filter(group=>group.kind==='system_count').map(group=>({
    report:group.visible[0],x:group.x+group.rowOffsets[0],y:group.y,width:group.rowWidths[0],height:group.rowHeight,
  })), [positionedGroups]);
  const reportMarkers = useMemo(() => positionedGroups.filter(group=>group.kind==='report').flatMap(group => group.visible.map((report,index) => ({report,
    x:group.x+group.rowOffsets[index], y:group.y+index*(group.rowHeight+group.rowGap), width:group.rowWidths[index], height:group.rowHeight,
  }))), [positionedGroups]);
  const labelLayouts = useMemo(() => labelsForWheelFrame({
    zooming:isWheelZooming,
    settled:settledLabels.current?.scopeVersion === scopeVersion ? settledLabels.current : null,
    nodes:screenSystems,
    options:{...viewport,
    // Hover only highlights the star/its leader. It must not reprioritize the
    // decluttering solver or every label would jump as the pointer crosses
    // the map during a live update.
    selectedId:selectedSystemId, hoveredId:null, intelById, forceIds:forceSystems,
    zoom:view.scale, showAll:showAllNames || showZoomLabels, showDense:showAllNames || showZoomLabels, occupied:[...positionedGroups,...reservedUiRects], gateSegments,
    padding:{left:14,right:14,top:175,bottom:60}},
  }), [screenSystems, viewport, selectedSystemId, intelById, forceSystems, view.scale, showAllNames, showZoomLabels, positionedGroups, reservedUiRects, gateSegments, isWheelZooming, scopeVersion]);
  useLayoutEffect(() => {
    if (!isWheelZooming) settledLabels.current = {labels:labelLayouts, nodes:screenSystems, gateSegments, scopeVersion};
  }, [isWheelZooming, labelLayouts, screenSystems, gateSegments, scopeVersion]);
  const markerLeaders = useMemo(() => markerLeaderSegments(positionedGroups,
    {selectedSystemId, hoveredSystemId, selectedForceId}),
    [positionedGroups, selectedSystemId, hoveredSystemId, selectedForceId]);
  const focusLeaders = useMemo(() => leaderSegmentsForFocus([], labelLayouts,
    {selectedSystemId, hoveredSystemId, ...viewport}), [labelLayouts, selectedSystemId, hoveredSystemId, viewport]);
  const portals = useMemo(() => {
    const exits = visibleGateExits(systems, stargates, boundaryExits, systems.map(node => node.system_id));
    const grouped = new Map();
    for (const exit of exits.filter(row => !row.loaded)) {
      const id = Number(exit.source_system_id);
      if (!grouped.has(id)) grouped.set(id, []);
      grouped.get(id).push(exit);
    }
    return [...grouped].map(([system_id, exits]) => ({system_id, exits}));
  }, [systems, stargates, boundaryExits]);
  const point = event => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect?.width || !rect?.height) return {x:-1,y:-1};
    return {x:(event.clientX-rect.left)*viewport.width/rect.width,y:(event.clientY-rect.top)*viewport.height/rect.height};
  };
  const settleLabels = () => {
    setIsSettlingLabels(true);
    if (labelSettleTimer.current !== null) clearTimeout(labelSettleTimer.current);
    labelSettleTimer.current = setTimeout(() => {
      labelSettleTimer.current = null;
      setIsSettlingLabels(false);
    }, 320);
  };
  const stopWheelZoom = () => {
    const queue = wheelQueue.current;
    if (queue.frame !== null) cancelAnimationFrame(queue.frame);
    if (queue.idle !== null) clearTimeout(queue.idle);
    queue.delta = 0; queue.anchor = null; queue.frame = null; queue.idle = null;
    setIsWheelZooming(false);
    const settled = liveViewRef.current;
    setView(current => current.x === settled.x && current.y === settled.y && current.scale === settled.scale ? current : settled);
    settleLabels();
  };
  const fitView = () => { stopWheelZoom(); setView(INITIAL_VIEW); setPreviousViews([]); setPicker(null); };
  const zoom = (multiplier, anchor = {x:viewport.width/2,y:viewport.height/2}) => {
    if (gesture.current?.force || gesture.current?.report) return;
    stopWheelZoom();
    setPicker(null);
    setView(current => {
      const next = zoomAroundPoint({zoom:current.scale,panX:current.x,panY:current.y}, anchor, multiplier, {min:.5,max:16});
      return next.zoom === current.scale ? current : {x:next.panX,y:next.panY,scale:next.zoom};
    });
  };
  const applyWheelFrame = (accumulated, anchor) => {
    if (!anchor || !accumulated) return;
    const current = liveViewRef.current;
    const next = wheelCameraFrame({view:current, delta:accumulated, anchor, limits:{min:.5,max:16}}).view;
    if (next.scale === current.scale && next.x === current.x && next.y === current.y) return;
    liveViewRef.current = next;
    worldLayerRef.current?.setAttribute('transform', cameraTransform(next));
    overlayLayerRef.current?.setAttribute('transform', relativeCameraTransform(view, next));
  };
  wheelHandler.current = event => {
    if (gesture.current) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1);
    if (!Number.isFinite(delta) || delta === 0 || delta < 0 && view.scale >= 16 || delta > 0 && view.scale <= .5) return;
    const queue = wheelQueue.current;
    queue.delta += delta;
    queue.anchor = point(event);
    setPicker(null);
    setIsWheelZooming(true);
    if (queue.idle !== null) clearTimeout(queue.idle);
    queue.idle = setTimeout(() => {
      queue.idle = null;
      if (queue.frame !== null) {
        cancelAnimationFrame(queue.frame);
        queue.frame = null;
        const accumulated = queue.delta;
        const anchor = queue.anchor;
        queue.delta = 0;
        queue.anchor = null;
        applyWheelFrame(accumulated, anchor);
      }
      const settled = liveViewRef.current;
      setIsWheelZooming(false);
      setView(current => current.x === settled.x && current.y === settled.y && current.scale === settled.scale ? current : settled);
      settleLabels();
    }, 220);
    if (queue.frame === null) queue.frame = requestAnimationFrame(() => {
      queue.frame = null;
      const accumulated = queue.delta, anchor = queue.anchor;
      queue.delta = 0; queue.anchor = null;
      applyWheelFrame(accumulated, anchor);
    });
  };
  useEffect(() => ref.current ? subscribeMapWheel(ref.current, event => wheelHandler.current?.(event)) : undefined, []);
  useEffect(() => () => {
    const queue = wheelQueue.current;
    if (queue.frame !== null) cancelAnimationFrame(queue.frame);
    if (queue.idle !== null) clearTimeout(queue.idle);
  }, []);
  useEffect(() => {
    const node = ref.current;
    if (!node) return undefined;
    const measure = () => {
      const {width,height} = node.getBoundingClientRect();
      if (width>0 && height>0) setViewport(previous => Math.abs(previous.width-width)<1 && Math.abs(previous.height-height)<1 ? previous : {width,height});
      // The search/filter dock floats above the SVG. Reserve its *actual*
      // viewport-space box so its responsive width and height cannot hide a
      // force badge; marker placement itself never changes this measurement.
      const controls = node.parentElement?.querySelector('.tac-map-controls');
      const bounds = controls?.getBoundingClientRect();
      const mapBounds = node.getBoundingClientRect();
      const next = bounds?.width && bounds?.height && mapBounds.width && mapBounds.height
        ? [{x:bounds.left-mapBounds.left,y:bounds.top-mapBounds.top,width:bounds.width,height:bounds.height}]
        : [];
      setReservedUiRects(previous => previous.length === next.length && previous.every((rect,index) =>
        ['x','y','width','height'].every(key => Math.abs(rect[key]-next[index][key])<.5)) ? previous : next);
    };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    const controls = node.parentElement?.querySelector('.tac-map-controls');
    if(controls) observer.observe(controls);
    window.addEventListener('resize',measure);
    return () => { observer.disconnect(); window.removeEventListener('resize',measure); };
  }, []);
  const lastFocusToken = useRef(null);
  useEffect(() => {
    if (focusSystem?._focusToken == null || focusSystem._focusToken === lastFocusToken.current) return;
    const target = byId.get(Number(focusSystem.system_id));
    if (!target) return;
    lastFocusToken.current = focusSystem._focusToken;
    const currentView = liveViewRef.current;
    setPreviousViews(previous => [...previous.slice(-7), currentView]);
    setView(focusDenseArea([target], currentView, viewport));
    setPicker(null);
  }, [focusSystem, byId, viewport]); // Focus tokens represent discrete user actions.
  const lastScopeVersion = useRef(null);
  useEffect(() => {
    // Map fetches temporarily clear scope. Keep the last actual version so a
    // replacement cancels gestures, while ordinary snapshot polling never pans.
    if (scope?.version == null || !Number.isFinite(Number(scope.version))) return;
    const version = Number(scope.version);
    if (lastScopeVersion.current != null && lastScopeVersion.current !== version) {
      stopWheelZoom();
      const pointerId = gesture.current?.pointerId;
      gesture.current = null;
      if (pointerId != null && ref.current?.hasPointerCapture(pointerId)) ref.current.releasePointerCapture(pointerId);
      suppressClick.current = false;
      setDrag(null);
      setPicker(null);
      setHoveredSystemId(null);
      setPreviousViews([]);
      setView(INITIAL_VIEW);
    }
    lastScopeVersion.current = version;
  }, [scope?.version]);
  useEffect(() => { if (picker) pickerRef.current?.querySelector('button[data-system-choice]')?.focus(); }, [picker]);
  const openDenseArea = candidates => {
    const currentView = liveViewRef.current;
    setPreviousViews(previous => [...previous.slice(-7), currentView]);
    setView(focusDenseArea(candidates, currentView, viewport)); setPicker(null);
  };
  const selectStar = (event, node) => {
    if (suppressClick.current) { suppressClick.current=false; return; }
    if (!event) { onSelectSystem?.(node); return; }
    const p=point(event), liveView=liveViewRef.current, hit=resolveSystemHit(nodes,p,liveView,viewport,36), neighborhood=hit.candidates;
    if (neighborhood.length>1 && liveView.scale<15.9) {
      const maxDistance=Math.max(...neighborhood.map(other=>Math.hypot(other.px-node.px,other.py-node.py)));
      if(maxDistance>.01) {openDenseArea(neighborhood);return;}
    }
    if(hit.ambiguous) {setPicker({kind:'select',candidates:neighborhood,point:p});return;}
    onSelectSystem?.(hit.target||node);
  };
  const cancel = () => {gesture.current=null;setDrag(null);setPicker(null);};
  const submitMove = (snapshot,destination) => {
    const result=validateDirectMove(snapshot,forces,destination,nodes,canMove);
    if(result.ok) onMoveForce?.(snapshot,result.destination_system_id);
    else if(result.reason) onMoveRejected?.(result.reason,{force:snapshot,target:byId.get(Number(destination))||null});
  };
  const submitCountMove = (snapshot,destination) => {
    const current=reports.find(report=>Number(report.id)===Number(snapshot.id));
    if(!current || current.version!==snapshot.version || current.status==='withdrawn') {
      onMoveRejected?.('人数上报已被其他成员更新，请核对最新位置。');
      return;
    }
    if(!canMoveCount?.(current)) {
      onMoveRejected?.('当前无权移动这条人数上报。');
      return;
    }
    if(byId.has(Number(destination)) && Number(destination)!==Number(current.system_id))
      onMoveCount?.(current,Number(destination));
  };
  const begin = (event,force,report) => {
    if(event.button!==0) return;
    stopWheelZoom();
    if(force) {event.stopPropagation();onSelectForce?.(force);if(!canMove)return;}
    if(report) {event.stopPropagation();if(!canMoveCount?.(report))return;}
    setPicker(null);suppressClick.current=false;
    const p=point(event);
    const starElement = event.target instanceof Element ? event.target.closest('[data-system-id]') : null;
    gesture.current={start:p,last:p,force:force?{...force}:null,report:report?{...report}:null,
      node:byId.get(Number(starElement?.dataset.systemId)),view:liveViewRef.current,started:false,pointerId:event.pointerId};
    ref.current?.setPointerCapture(event.pointerId);
  };
  const move = event => {
    const current=gesture.current;
    if(!current||event.pointerId!==current.pointerId)return;
    const p=point(event);current.last=p;
    if(!current.started&&Math.hypot(p.x-current.start.x,p.y-current.start.y)<7)return;
    current.started=true;
    if(current.force||current.report)setDrag({point:p,...resolveSystemHit(nodes,p,liveViewRef.current,viewport)});
    else setView({...current.view,x:current.view.x+p.x-current.start.x,y:current.view.y+p.y-current.start.y});
  };
  const end = event => {
    const current=gesture.current;
    if(!current||event.pointerId!==current.pointerId)return;
    gesture.current=null;
    if(ref.current?.hasPointerCapture(event.pointerId))ref.current.releasePointerCapture(event.pointerId);
    suppressClick.current=current.started;
    if((current.force||current.report)&&current.started) {
      // Pointer-up is authoritative; React may not have committed the last drag frame.
      const p=point(event),hit=resolveSystemHit(nodes,p,liveViewRef.current,viewport);
      if(hit.ambiguous)setPicker({kind:current.report?'move-count':'move',force:current.force,report:current.report,candidates:hit.candidates,point:p});
      else if(hit.target) {
        if(current.report)submitCountMove(current.report,hit.target.system_id);
        else submitMove(current.force,hit.target.system_id);
      }
    }
    if(!current.force && !current.report && !current.started && current.node) selectStar(event,current.node);
    setDrag(null);
  };
  const pick = node => {
    if(picker?.kind==='move')submitMove(picker.force,node.system_id);
    else if(picker?.kind==='move-count')submitCountMove(picker.report,node.system_id);
    else if(byId.has(Number(node.system_id)))onSelectSystem?.(byId.get(Number(node.system_id)));
    setPicker(null);ref.current?.focus();
  };
  const pickerPosition=picker?{left:Math.max(12,Math.min(picker.point.x+16,viewport.width-274)),top:Math.max(175,Math.min(picker.point.y+16,viewport.height-300))}:null;

  const motionPhase = labelMotionPhase({zooming:isWheelZooming, settling:isSettlingLabels});
  return <div className={`tac-map tac-map-mode-spatial tac-system-intel-map${isWheelZooming?' is-wheel-zooming':''}${isSettlingLabels?' is-label-settling':''} is-label-${motionPhase} ${className}`}>
    <div className="tac-map-dock" aria-label="星图工具与边界星门">{children}</div>
    <div className="tac-map-toolbar tac-intel-toolbar" aria-label="星图操作">
      <div className="tac-map-mode-switch" role="toolbar" aria-label="地图视图">
        {previousViews.length>0&&<button type="button" aria-label="返回上一视野" onClick={()=>{setView(previousViews[previousViews.length-1]);setPreviousViews(previous=>previous.slice(0,-1));setPicker(null);}}><ArrowLeft size={14}/> 返回</button>}
        <button type="button" aria-label="显示全部星系名称" aria-pressed={showAllNames} onClick={()=>setShowAllNames(value=>!value)}><Type size={14}/> 名称</button>
        <button type="button" aria-label={showReportMarkers ? '隐藏上报标记' : '显示上报标记'} aria-pressed={showReportMarkers} onClick={()=>setShowReportMarkers(value=>!value)}><span aria-hidden="true">{showReportMarkers ? <EyeOff size={14}/> : <Eye size={14}/>}</span> 上报</button>
      </div>
      <span className="tac-map-legend"><i className="tac-enemy-dot"/> 敌方{forces.some(force=>force.side==='friendly')&&<><i className="tac-friendly-dot"/> 己方</>}</span>
      <div><button type="button" aria-label="缩小地图" onClick={()=>zoom(1/1.25)}><Minus size={16}/></button><button type="button" aria-label="放大地图" onClick={()=>zoom(1.25)}><Plus size={16}/></button><button type="button" aria-label="适应作战范围" onClick={fitView}><Crosshair size={16}/></button></div>
    </div>
    <svg ref={ref} viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label="局部作战星图" tabIndex={0}
      onPointerDown={event=>begin(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={cancel}
      onKeyDown={event=>{if(event.key==='Escape')cancel();if(event.target===ref.current&&['+','-'].includes(event.key)){event.preventDefault();zoom(event.key==='+'?1.25:1/1.25);}}}>
      <g ref={worldLayerRef} className="tac-map-world-layer" transform={cameraTransform(view)}>
        {stargates.map((gate,index)=>{
          const a=byId.get(Number(gate.system_id)),b=byId.get(Number(gate.destination_system_id));
          const active=Number(a?.system_id)===Number(hoveredSystemId??selectedSystemId)||Number(b?.system_id)===Number(hoveredSystemId??selectedSystemId);
          // Keep every real gate, but make the unselected topology a quiet
          // reference layer. Focused/hovered routes remain legible without
          // competing with deployment badges and system names.
          const opacity=active ? .88 : Math.min(.42, .18 + view.scale * .12);
          return a&&b?<line key={gate.id||index} className={`tac-map-gate${active?' is-active':''}`} x1={a.px} y1={a.py} x2={b.px} y2={b.py} stroke={active?'#819591':'#46565c'} strokeWidth={(active?1.8:.65)/view.scale} opacity={opacity} pointerEvents="none"/>:null;
        })}
        {nodes.map(node=>{
          const id=Number(node.system_id),name=systemDisplayName(node),selected=Number(selectedSystemId)===id,report=intelById.get(id);
          const related=selectedNeighbors.has(id),color=report?'#d49a7e':selected?'#f0e5c5':related?'#bbc9c4':'#8ca0a3';
          return <g key={id} role="button" tabIndex={0} aria-label={`选择星系 ${name}`} className="tac-map-system" data-system-id={id}
            onClick={event=>{if(event.detail===0)onSelectSystem?.(node);}} onPointerEnter={()=>setHoveredSystemId(id)} onPointerLeave={()=>setHoveredSystemId(null)} onFocus={()=>setHoveredSystemId(id)} onBlur={()=>setHoveredSystemId(null)}
            onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();onSelectSystem?.(node);}}}>
            <title>{`${name} · 安全系数 ${securityLabel(node.security_status)}${report?` · 敌方 ${report.people??'未知'} 人 · ${report.author_name||'未知上报者'} · ${ageLabel(report.observed_at)}`:''}`}</title>
            {(selected||report)&&<circle className="tac-star-ring" cx={node.px} cy={node.py} r={(selected?12:9)/view.scale} fill="none" stroke={color} strokeWidth={1/view.scale} opacity={selected?.8:.4}/>}
            <circle className="tac-star-dot" cx={node.px} cy={node.py} r={(selected?5:report?4:3)/view.scale} fill={color}/><circle className="tac-star-hit" cx={node.px} cy={node.py} r={19/view.scale} fill="transparent"/>
          </g>;
        })}
      </g>
      <g ref={overlayLayerRef} className="tac-map-overlay-layer">
      {markerLeaders.map(leader=><line key={`marker-leader-${leader.key}`} className={`tac-map-marker-leader${leader.active?' is-active':''}`} x1={leader.from.x} y1={leader.from.y} x2={leader.to.x} y2={leader.to.y} stroke={leader.active?'#a9c0b4':'#718681'} strokeWidth={leader.active?1.45:.85} opacity={leader.active?.88:.46} pointerEvents="none"/>)}
      {focusLeaders.map(leader=><line key={`focus-leader-${leader.system_id}`} className="tac-map-focus-leader" x1={leader.from.x} y1={leader.from.y} x2={leader.to.x} y2={leader.to.y} stroke="#8ca79d" strokeWidth=".8" opacity=".45" pointerEvents="none"/>)}
      {labelLayouts.map(label=>{
        const node=byId.get(Number(label.system_id));if(!node)return null;
        const report=label.intel,selected=Number(selectedSystemId)===Number(node.system_id);
        const labelState=wheelLabelState(label,{zooming:isWheelZooming,selectedSystemId,forceIds:forceSystems});
        return <g key={`label-${label.system_id}`} className={`tac-intel-label${report?' has-count':''}${report&&isStale(report.observed_at)?' is-stale':''}${labelState.dimmed?' is-wheel-secondary':''}`} role="button" tabIndex={0}
          aria-label={`${label.name}${report?`，敌方 ${report.people??'未知'} 人`:''}`} onPointerDown={event=>event.stopPropagation()} onClick={()=>onSelectSystem?.(node)} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();onSelectSystem?.(node);}}}>
          <title>{report?`${report.author_name||'未知上报者'} · ${ageLabel(report.observed_at)} · 安全系数 ${securityLabel(node.security_status)}`:`${label.name} · 安全系数 ${securityLabel(node.security_status)}`}</title>
          {label.gateBackdrop&&<rect x={label.x+2} y={label.y+1} width={Math.max(0,label.width-4)} height={label.height-2} rx="3" fill="#19252b" opacity=".92" pointerEvents="none"/>}
          <text className="tac-star-name" x={label.x+label.width/2} y={label.y+14} textAnchor="middle" fill={selected?'#f6edda':'#d2dcda'} fontSize="13" fontWeight="400" paintOrder="stroke" stroke="#19252b" strokeWidth="4">{label.name}</text>
          <text className="tac-star-security" x={label.x+label.width/2} y={label.y+30} textAnchor="middle" fill={securityColor(node.security_status)} fontSize="10" fontWeight="400" paintOrder="stroke" stroke="#19252b" strokeWidth="4">{securityLabel(node.security_status)}</text>
        </g>;
      })}
      {markers.map(({force,x,y,width,height})=><Fragment key={force.id}>
        <g role="button" tabIndex={0} aria-label={`${force.side==='friendly'?'己方':'敌方'} ${force.name} ${force.people??'未知'} 人，${force.system_name}`}
          transform={`translate(${x} ${y})`} data-force-id={force.id} className={`tac-map-force${isStale(force.observed_at)?' is-stale':''}`} onPointerDown={event=>begin(event,force)} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();onSelectForce?.(force);}}}>
          <title>{`${force.name} · ${force.system_name} · ${force.people??'未知'} 人${force.source_author_name?` · 上报：${force.source_author_name}`:''} · ${ageLabel(force.observed_at)}${canMove?' · 拖动调整部署':''}`}</title>
          <rect width={width} height={height} rx="5" fill={force.side==='friendly'?'#29443e':'#553a30'} stroke={force.id===selectedForceId?'#f2e5c8':force.side==='friendly'?'#71988b':'#ab7a65'} strokeWidth={force.id===selectedForceId?2:1}/>
          <text x={(width-(canArchiveForce?MARKER_CLOSE_SIZE:0))/2} y={height/2} textAnchor="middle" dominantBaseline="central" fill="#f1e9d9" fontSize="12" fontWeight="400">{fleetMarkerLabel(force,width,canArchiveForce?MARKER_CLOSE_SIZE:0)}</text>
        </g>
        {canArchiveForce&&<MarkerCloseAction x={x+width-MARKER_CLOSE_SIZE} y={y+(height-MARKER_CLOSE_SIZE)/2}
          label={`归档${force.name}`} title={`归档${force.name}（需确认）`} className="tac-force-close"
          dataArchiveForceId={force.id} onActivate={()=>onArchiveForce?.(force)}/>}
      </Fragment>)}
      {countMarkers.map(({report,x,y,width,height})=>{
        const node=byId.get(Number(report.system_id));if(!node)return null;
        const withdrawable=Boolean(canWithdrawCount?.(report));
        const select=()=>{ onSelectSystem?.(node); onSelectCount?.(report); };
        return <g key={`count-${report.system_id}`} role="button" tabIndex={0}
          aria-label={`${systemDisplayName(node)}，${report.label}，${report.author_name||'未知上报者'}`}
          transform={`translate(${x} ${y})`} data-count-system-id={report.system_id} data-count-report-id={report.id}
          className={`tac-map-count tac-map-report-marker${canMoveCount?.(report)?' is-draggable':''}${isStale(report.observed_at)?' is-stale':''}`}
          onPointerDown={event=>begin(event,null,report)} onClick={event=>{if(suppressClick.current){suppressClick.current=false;return;}select();}}
          onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();select();}}}>
          <title>{`${systemDisplayName(node)} · ${report.label} · 上报：${report.author_name||'未知上报者'} · ${ageLabel(report.observed_at)} · 星系人数独立记录，不与舰队人数相加`}</title>
          <rect width={width} height={height} rx="5" fill="#293638" stroke="#a39577" strokeDasharray="3 2" strokeWidth="1"/>
          <text x={(width-(withdrawable?MARKER_CLOSE_SIZE:0))/2} y={height/2} textAnchor="middle" dominantBaseline="central" fill="#e8d9bb" fontSize="12" fontWeight="400">{report.label}</text>
          {withdrawable&&<MarkerCloseAction x={width-MARKER_CLOSE_SIZE} y={(height-MARKER_CLOSE_SIZE)/2}
            label={`撤下${systemDisplayName(node)}人数上报`} title={`撤下${systemDisplayName(node)}人数上报（需确认）`}
            className="tac-count-close" onActivate={()=>onWithdrawCount?.(report)}/>}
        </g>;
      })}
      {reportMarkers.map(({report,x,y,width,height})=>{
        const node=byId.get(Number(report.system_id)); if(!node)return null;
        const select=()=>onSelectReport?.(report);
        const focus=()=>{onFocusReports?.(node); select();};
        return <g key={`report-${report.id}`} role="button" tabIndex={0} aria-label={`${report.label}，${report.author_name||'未知上报者'}，${report.system_name||node.name||''}`}
          transform={`translate(${x} ${y})`} data-report-id={report.id} className={`tac-map-report tac-map-report-marker${isStale(report.observed_at)?' is-stale':''}`}
          onPointerDown={event=>event.stopPropagation()} onClick={select}
          onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();focus();}}}>
          <title>{`${report.authorLabel} · ${report.shipLabel} · ${ageLabel(report.observed_at)}`}</title>
          <rect width={width} height={height} rx="5" fill="#3a3030" stroke="#b98770" strokeWidth="1"/>
          <text x={width/2} y="18" textAnchor="middle" fill="#ecd5c6" fontSize="11">{fitMarkerText(report.label,width-10,11)}</text>
          <text x={width/2} y="36" textAnchor="middle" fill="#d7c0b2" fontSize="10">{fitMarkerText(report.authorLabel,width-10,10)}</text>
        </g>;
      })}
      {positionedGroups.filter(group=>group.kind==='force'&&group.hiddenCount).map(group=>{
        const node=byId.get(Number(group.system_id)),y=group.y+group.visible.length*(group.rowHeight+group.rowGap);if(!node)return null;
        const focus=()=>{onSelectSystem?.(node);onFocusSystem?.(node);};
        return <g key={`more-${group.key}`} role="button" tabIndex={0} aria-label={`查看${systemDisplayName(node)}全部${group.total}支部署`} transform={`translate(${group.x+group.overflowOffset} ${y})`} className="tac-map-group" onPointerDown={event=>event.stopPropagation()} onClick={focus} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();focus();}}}>
          <rect width={group.overflowWidth} height={group.rowHeight} rx="5" fill="#2d3e3b" stroke="#7d9587"/><text x={group.overflowWidth/2} y={group.rowHeight/2} textAnchor="middle" dominantBaseline="central" fill="#dfe9d7" fontSize="12" fontWeight="400">{fitMarkerText(`+ ${group.hiddenCount} 支部署`,group.overflowWidth-18)}</text>
        </g>;
      })}
      {portals.map(portal=>{
        const node=byId.get(portal.system_id);if(!node)return null;
        return <g key={`portal-${portal.system_id}`} className="tac-map-portal" role="button" tabIndex={0} aria-label={`查看${systemDisplayName(node)}的边界星门`}
          transform={`translate(${view.x+node.px*view.scale} ${view.y+node.py*view.scale})`} onPointerDown={event=>event.stopPropagation()} onClick={()=>onSelectSystem?.(node)} onKeyDown={event=>{if(['Enter',' '].includes(event.key)){event.preventDefault();onSelectSystem?.(node);}}}>
          <title>{portal.exits.map(exit=>exit.destination_name).join('、')}</title><text x="20" y="4" fill="#c9b388" fontSize="10">↗ {portal.exits.length}</text>
        </g>;
      })}
      {drag&&<g pointerEvents="none"><circle cx={drag.point.x} cy={drag.point.y} r="12" fill="#dbc69f" opacity=".8"/>{drag.candidates.map(node=><circle key={node.system_id} cx={liveViewRef.current.x+node.px*liveViewRef.current.scale} cy={liveViewRef.current.y+node.py*liveViewRef.current.scale} r="19" fill="none" stroke={drag.ambiguous?'#d3af70':'#a7c6b0'} strokeWidth="2"/>)}
        <text x={Math.max(110,Math.min(viewport.width-110,drag.point.x))} y={Math.max(170,drag.point.y-28)} textAnchor="middle" fill="#f2e7cf" fontSize="13" paintOrder="stroke" stroke="#19252b" strokeWidth="5">{drag.ambiguous?'松开后选择目标星系':drag.target?systemDisplayName(drag.target):'拖到目标星系'}</text></g>}
      </g>
    </svg>
    {picker&&<div ref={pickerRef} className="tac-map-target-picker" role="dialog" aria-label={picker.kind==='move'?'选择部署目标星系':picker.kind==='move-count'?'选择上报目标星系':'选择重叠星系'} style={pickerPosition} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();setPicker(null);ref.current?.focus();}}}>
      <div><strong>{picker.kind.startsWith('move')?'移动到哪个星系？':'选择星系'}</strong><button type="button" aria-label="取消星系选择" onClick={()=>setPicker(null)}><X size={15}/></button></div>
      <ul>{picker.candidates.filter(node=>byId.has(Number(node.system_id))).map(node=>{
        const report=intelById.get(Number(node.system_id));
        return <li key={node.system_id}><button type="button" data-system-choice={node.system_id} onClick={()=>pick(node)}><span>{systemDisplayName(node)}<small style={{color:securityColor(node.security_status)}}>{securityLabel(node.security_status)}</small></span><em>{report?`敌方 ${report.people??'未知'}`:'选择'}</em></button></li>;
      })}</ul>
    </div>}
    {!nodes.length&&<div className={`tac-map-empty${!scope?.region_ids?.length ? ' is-actionable' : ''}`}>
      <Crosshair size={30}/>
      {!scope?.region_ids?.length ? <>
        <strong>先确定这次作战的范围</strong>
        <span>{canEditScope ? '选择相关星域后，星图会在这里展开。' : '等待统帅或指挥设置作战星域。'}</span>
        {canEditScope && <button type="button" className="tac-map-scope-cta" onClick={onOpenScope}>选择作战星域</button>}
      </> : <><strong>正在加载局部星图</strong><span>若长时间未显示，请使用“重新加载星图”。</span></>}
    </div>}
  </div>;
}
