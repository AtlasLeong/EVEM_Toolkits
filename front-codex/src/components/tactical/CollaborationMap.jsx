import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Crosshair, Layers, Minus, Plus, Scan } from "lucide-react";
import { layoutForceMarkers } from "../../utils/tacticalMarkerLayout";
import { adjacentSystems, isStale, groupMapForces } from "../../utils/tacticalCollaboration";
import {
  buildConstellationOverview,
  nearestSystemAt,
  layoutTopology,
  projectSystemsScoped,
  summarizeOverviewForces,
  visibleGateExits,
  zoomAroundPoint,
} from "../../utils/tacticalMapLayout";
import { layoutSystemLabels, screenNodes } from "../../utils/tacticalMapScreen";

const modeLabel = { overview: "星座总览", constellation: "局部作战星图", spatial: "真实空间星图" };
const securityColor = (value) => value == null ? "#a6adb1" : Number(value) >= 0.5 ? "#97c6b0" : Number(value) > 0 ? "#d7b68c" : "#d69d96";

export default function CollaborationMap({
  systems = [], stargates = [], constellations = [], forces = [], boundaryExits = [],
  selectedSystemId, onSelectSystem, selectedForceId, onSelectForce, onFocusSystem,
  focusSystem, scope = null, canMove = false, onMoveForce, className = "",
}) {
  const [viewport, setViewport] = useState({ width: 1000, height: 800 });
  const safePadding = useMemo(() => ({ left: 76, right: viewport.width >= 1000 ? 354 : 304, top: Math.min(260, viewport.height * 0.32), bottom: 110 }), [viewport.width, viewport.height]);
  const [mode, setMode] = useState("spatial");
  const [activeConstellationId, setActiveConstellationId] = useState(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState(null);
  const [hint, setHint] = useState("");
  const ref = useRef(null);
  const gesture = useRef(null);
  const hasOverview = constellations.length > 0 && systems.some((system) => system.constellation_id != null);
  const overview = useMemo(() => buildConstellationOverview(systems, stargates, constellations), [systems, stargates, constellations]);
  const overviewNodes = useMemo(() => layoutTopology(overview.nodes, overview.edges).map((node) => ({ ...node, x: node.px, z: -node.py })), [overview.edges, overview.nodes]);
  const overviewForces = useMemo(() => summarizeOverviewForces(forces, systems), [forces, systems]);

  useEffect(() => { if (hasOverview) setMode((current) => (current === "spatial" ? "overview" : current)); }, [hasOverview]);
  const displayedSystems = useMemo(() => {
    if (mode === "overview" && hasOverview) return overviewNodes;
    if (mode === "constellation" && activeConstellationId != null) {
      const coreIds = new Set(systems.filter((system) => Number(system.constellation_id) === Number(activeConstellationId)).map((system) => Number(system.system_id)));
      const adjacentIds = new Set(coreIds);
      for (const gate of stargates) {
        const source = Number(gate.system_id);
        const destination = Number(gate.destination_system_id);
        if (coreIds.has(source)) adjacentIds.add(destination);
        if (coreIds.has(destination)) adjacentIds.add(source);
      }
      return systems.filter((system) => adjacentIds.has(Number(system.system_id)));
    }
    return systems;
  }, [activeConstellationId, hasOverview, mode, overviewNodes, stargates, systems]);
  const fitIds = useMemo(() => {
    if (mode === "spatial" && Array.isArray(scope?.region_ids) && scope.region_ids.length) {
      const regionIds = new Set(scope.region_ids.map(Number));
      const core = displayedSystems.filter((node) => regionIds.has(Number(node.region_id)));
      if (core.length) return core.map((node) => node.system_id);
    }
    if (mode === "constellation" && activeConstellationId != null) return displayedSystems.filter((node) => Number(node.constellation_id) === Number(activeConstellationId)).map((node) => node.system_id);
    return displayedSystems.map((node) => node.system_id);
  }, [activeConstellationId, displayedSystems, mode, scope?.region_ids]);
  const nodes = useMemo(() => projectSystemsScoped(displayedSystems, { ...viewport, padding: safePadding, fitIds }), [displayedSystems, fitIds, safePadding, viewport]);
  const byId = useMemo(() => new Map(nodes.map((node) => [Number(node.system_id), node])), [nodes]);
  const activeSystemNodes = mode === "overview" ? [] : nodes;
  const activeById = useMemo(() => new Map(activeSystemNodes.map((node) => [Number(node.system_id), node])), [activeSystemNodes]);
  const portals = useMemo(() => mode === "overview" ? [] : visibleGateExits(systems, stargates, boundaryExits, activeSystemNodes.map((node) => node.system_id)), [activeSystemNodes, boundaryExits, mode, stargates, systems]);
  const adjacent = useMemo(() => drag ? adjacentSystems(stargates, drag.force.system_id) : new Set(), [drag?.force?.id, stargates]);
  const forceGroups = useMemo(() => mode === "overview" ? [] : groupMapForces(forces, selectedForceId).filter((group) => activeById.has(Number(group.system_id))), [activeById, forces, mode, selectedForceId]);
  const forceSystems = useMemo(() => new Set(forceGroups.map((group) => group.system_id)), [forceGroups]);
  const positionedGroups = useMemo(() => layoutForceMarkers(forceGroups, activeSystemNodes, 1 / Math.max(view.scale, 0.5), { width: viewport.width, height: viewport.height, padding: safePadding }), [activeSystemNodes, forceGroups, safePadding, view.scale, viewport]);
  const markers = positionedGroups.flatMap((group) => group.visible.map((force, index) => ({ force, x: view.x + group.x * view.scale, y: view.y + (group.y + index * (group.rowHeight + group.rowGap)) * view.scale, width: group.width * view.scale, height: group.rowHeight * view.scale })));
  const labelLayouts = useMemo(() => mode === "constellation" ? layoutSystemLabels(screenNodes(activeSystemNodes, { panX: view.x, panY: view.y, zoom: view.scale }), {
    selectedId: selectedSystemId,
    forceIds: forceSystems,
    targetIds: adjacent,
    width: viewport.width,
    height: viewport.height,
    padding: safePadding,
    occupied: markers.map(({ x, y, width, height }) => ({ x, y, width, height })),
  }) : [], [activeSystemNodes, adjacent, forceSystems, mode, markers, safePadding, selectedSystemId, view.scale, view.x, view.y, viewport.height, viewport.width]);
  const labelStep = Math.max(1, Math.ceil(nodes.length / 18));
  const point = (event) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return { x: 0, y: 0 };
    return {
      x: (event.clientX - rect.left) * (viewport.width / rect.width),
      y: (event.clientY - rect.top) * (viewport.height / rect.height),
    };
  };
  const fitView = () => setView({ x: 0, y: 0, scale: 1 });
  const zoom = (multiplier, anchor = { x: viewport.width / 2, y: viewport.height / 2 }) => setView((current) => { const next = zoomAroundPoint({ zoom: current.scale, panX: current.x, panY: current.y }, anchor, multiplier, { min: 0.5, max: 4 }); return { x: next.panX, y: next.panY, scale: next.zoom }; });
  const openConstellation = (node) => { setActiveConstellationId(node.id); setMode("constellation"); fitView(); };
  const returnOverview = () => { setActiveConstellationId(null); setMode("overview"); fitView(); };

  const lastFocusToken = useRef(null);
  useEffect(() => {
    if (!focusSystem || !systems.length) return;
    if (focusSystem._focusToken == null || focusSystem._focusToken === lastFocusToken.current) return;
    lastFocusToken.current = focusSystem._focusToken;
    if (hasOverview && focusSystem.constellation_id != null && (mode === "overview" || (mode === "constellation" && Number(activeConstellationId) !== Number(focusSystem.constellation_id)))) {
      setActiveConstellationId(focusSystem.constellation_id);
      setMode("constellation");
      return;
    }
    if (mode === "overview") return;
    const target = activeSystemNodes.find((node) => Number(node.system_id) === Number(focusSystem.system_id));
    if (!target) return;
    const scale = 2;
    const nextView = { scale, x: viewport.width / 2 - target.px * scale, y: viewport.height / 2 - target.py * scale };
    setView((current) => current.scale === nextView.scale && current.x === nextView.x && current.y === nextView.y ? current : nextView);
  }, [activeConstellationId, activeSystemNodes, focusSystem, hasOverview, mode, systems.length, viewport.height, viewport.width]);
  useEffect(() => {
    const node = ref.current; if (!node) return undefined;
    const measure = () => { const { width, height } = node.getBoundingClientRect(); if (width > 0 && height > 0) setViewport((previous) => Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1 ? previous : { width, height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(node); return () => observer.disconnect();
  }, []);

  const begin = (event, force) => {
    if (event.button !== 0) return;
    if (force) { event.stopPropagation(); onSelectForce?.(force); if (!canMove || mode === "overview") return; }
    const p = point(event); gesture.current = { start: p, last: p, force, view, started: false }; ref.current?.setPointerCapture(event.pointerId);
  };
  const move = (event) => {
    const current = gesture.current; if (!current) return;
    const p = point(event); current.last = p;
    if (Math.hypot(p.x - current.start.x, p.y - current.start.y) < 7 && !current.started) return;
    current.started = true;
    if (current.force) { const mapPoint = { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale }; const target = nearestSystemAt(activeSystemNodes, mapPoint, 48 / view.scale); setDrag({ force: current.force, x: mapPoint.x, y: mapPoint.y, target }); }
    else setView({ ...current.view, x: current.view.x + p.x - current.start.x, y: current.view.y + p.y - current.start.y });
  };
  const end = () => {
    const current = gesture.current;
    gesture.current = null;
    let target = drag?.target;
    if (current?.force && current.started && !target && current.last) {
      const mapPoint = { x: (current.last.x - view.x) / view.scale, y: (current.last.y - view.y) / view.scale };
      target = nearestSystemAt(activeSystemNodes, mapPoint, 70 / view.scale);
    }
    if (current?.force && current.started && target) {
      if (adjacent.has(Number(target.system_id))) {
        setHint("移动请求已提交，等待服务器确认");
        onMoveForce?.(current.force, Number(target.system_id));
      } else setHint("只能拖到相邻星门连接的星系；远程纠正请使用“移动部队”。");
    }
    setDrag(null);
  };
  const svgLabel = mode === "spatial" && !hasOverview ? "局部作战星图" : modeLabel[mode];

  return <div className={`tac-map tac-map-mode-${mode} ${className}`}>
    <div className="tac-map-toolbar">
      <div className="tac-map-mode-switch" role="toolbar" aria-label="地图视图">
        {mode === "constellation" && <button type="button" aria-label="返回星座总览" onClick={returnOverview}><ArrowLeft size={14} /> 返回星座总览</button>}
        {hasOverview && mode === "overview" && <button type="button" aria-label="切换真实空间" onClick={() => { setMode("spatial"); fitView(); }}><Scan size={14} /> 真实空间</button>}
        {hasOverview && mode === "spatial" && <button type="button" aria-label="切换星座总览" onClick={returnOverview}><Layers size={14} /> 星座总览</button>}
        <span className="tac-map-mode-label">{svgLabel}</span>
      </div>
      <span className="tac-map-legend"><i className="tac-enemy-dot" /> 敌方{forces.some((force) => force.side === "friendly") && <><i className="tac-friendly-dot" /> 己方</>}</span>
      <div><button type="button" aria-label="缩小地图" onClick={() => zoom(1 / 1.25)}><Minus size={16} /></button><button type="button" aria-label="放大地图" onClick={() => zoom(1.25)}><Plus size={16} /></button><button type="button" aria-label="适应作战范围" onClick={fitView}><Crosshair size={16} /></button></div>
    </div>
    <svg ref={ref} viewBox={`0 0 ${viewport.width} ${viewport.height}`} role="group" aria-label={svgLabel} tabIndex={0} onPointerDown={(event) => begin(event)} onPointerMove={move} onPointerUp={end} onPointerCancel={() => { gesture.current = null; setDrag(null); }} onWheel={(event) => { event.preventDefault(); zoom(event.deltaY < 0 ? 1.16 : 1 / 1.16, point(event)); }} onKeyDown={(event) => { if (event.key === "Escape") { gesture.current = null; setDrag(null); } if (event.target === ref.current && ["+", "-"].includes(event.key)) { event.preventDefault(); zoom(event.key === "+" ? 1.25 : 1 / 1.25); } }}>
      <defs><pattern id="tac-map-grid" width="40" height="40" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".7" fill="#758388" opacity=".2" /></pattern></defs>
      <rect width={viewport.width} height={viewport.height} fill="url(#tac-map-grid)" />
      <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
        {(mode === "overview" ? overview.edges : stargates).map((gate, index) => { const a = byId.get(Number(mode === "overview" ? gate.source_id : gate.system_id)); const b = byId.get(Number(mode === "overview" ? gate.destination_id : gate.destination_system_id)); return a && b ? <line key={`${gate.id || index}`} x1={a.px} y1={a.py} x2={b.px} y2={b.py} stroke={mode === "overview" ? "#68827f" : "#455359"} strokeWidth={mode === "overview" ? 2 : 1.2} opacity={mode === "overview" ? .8 : 1} /> : null; })}
        {mode === "overview" ? overview.nodes.map((node) => { const projected = byId.get(Number(node.id)); if (!projected) return null; const summary = overviewForces[String(node.id)] || { forces: 0, knownPeople: 0, enemyForces: 0, friendlyForces: 0 }; return <g key={node.id} role="button" tabIndex={0} aria-label={`进入星座 ${node.label}`} className="tac-map-constellation" onPointerDown={(event) => event.stopPropagation()} onClick={() => openConstellation(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openConstellation(node); } }}><title>{`${node.label} · ${node.system_count} 个星系`}</title><rect x={projected.px - 74} y={projected.py - 28} width="148" height="56" rx="12" fill="#243738" stroke="#6e9189" strokeWidth={1.5 / view.scale} /><circle cx={projected.px - 55} cy={projected.py - 7} r={5 / view.scale} fill={summary.enemyForces ? "#d28b72" : "#7aa69c"} /><text x={projected.px - 42} y={projected.py - 6} fill="#e8eee6" fontSize={13 / view.scale} fontWeight="600">{node.label}</text><text x={projected.px - 42} y={projected.py + 13} fill="#9db4aa" fontSize={10 / view.scale}>{node.system_count} 个星系 · {summary.forces ? `${summary.forces} 支敌情` : "暂无敌情"}</text></g>; }) : activeSystemNodes.map((node, index) => { const id = Number(node.system_id); const selected = Number(selectedSystemId) === id; const isAdjacent = adjacent.has(id); const shouldLabel = mode !== "constellation" && (index % labelStep === 0 || forceSystems.has(id) || selected || isAdjacent); return <g key={node.system_id} role="button" tabIndex={0} aria-label={`选择星系 ${node.zh_name || node.name}`} onPointerDown={(event) => event.stopPropagation()} onClick={() => onSelectSystem?.(node)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectSystem?.(node); } }} className="tac-map-system"><title>{`${node.zh_name || node.name} · 安全系数 ${node.security_status == null ? "未知" : Number(node.security_status).toFixed(2)}`}</title><circle cx={node.px} cy={node.py} r={(isAdjacent ? 13 : selected ? 9 : 5) / view.scale} fill={isAdjacent ? "#80b2a9" : selected ? "#ede6cb" : "#b3bec0"} fillOpacity={isAdjacent ? .5 : 1} /><circle cx={node.px} cy={node.py} r={19 / view.scale} fill="transparent" />{shouldLabel && <g pointerEvents="none"><text x={node.px} y={node.py + 24 / view.scale} textAnchor="middle" fill="#c4ced0" fontSize={12 / view.scale}>{node.zh_name || node.name}</text><text x={node.px} y={node.py + 40 / view.scale} textAnchor="middle" fill={securityColor(node.security_status)} fontSize={11 / view.scale}>{node.security_status == null ? "安等未知" : Number(node.security_status).toFixed(2)}</text></g>}</g>; })}
        {mode !== "overview" && positionedGroups.map((group) => <line key={`leader-${group.system_id}`} x1={group.leader.from.x} y1={group.leader.from.y} x2={group.leader.to.x} y2={group.leader.to.y} stroke="#8daba5" strokeWidth={1 / Math.max(view.scale, .5)} opacity=".8" pointerEvents="none" />)}
      </g>
      {mode === "constellation" && labelLayouts.map((label) => { const node = activeById.get(Number(label.system_id)); if (!node) return null; return <g key={`label-${label.system_id}`} className="tac-map-system-label" pointerEvents="none"><text x={label.x + label.width / 2} y={label.y + 14} textAnchor="middle" fill="#d8e1df" fontSize="12" paintOrder="stroke" stroke="#182728" strokeWidth="4">{label.name}</text><text x={label.x + label.width / 2} y={label.y + 30} textAnchor="middle" fill={securityColor(node.security_status)} fontSize="11" paintOrder="stroke" stroke="#182728" strokeWidth="3">{node.security_status == null ? "安等未知" : Number(node.security_status).toFixed(2)}</text></g>; })}
      {mode !== "overview" && markers.map(({ force, x, y, width, height }) => <g key={force.id} role="button" tabIndex={0} aria-label={`${force.side === "friendly" ? "己方" : "敌方"} ${force.name} ${force.people ?? "未知"} 人，${force.system_name}`} transform={`translate(${x} ${y})`} className={`tac-map-force ${isStale(force.observed_at) ? "is-stale" : ""}`} onPointerDown={(event) => begin(event, force)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelectForce?.(force); } }}><title>{`${force.name} · ${force.system_name} · ${force.people ?? "未知"} 人`}</title><rect width={width} height={height} rx="6" fill={force.side === "friendly" ? "#274b49" : "#673e35"} stroke={force.id === selectedForceId ? "#f8efdb" : force.side === "friendly" ? "#57938a" : "#ad7362"} strokeWidth={force.id === selectedForceId ? 2 : 1} /><text x="9" y="17" fill="#fff4e8" fontSize="12">{force.side === "friendly" ? "友" : "敌"} · {force.people == null ? "未知" : force.people >= 10000 ? `${(force.people / 10000).toFixed(1)}万` : force.people} 人</text></g>)}
      {mode !== "overview" && positionedGroups.filter((group) => group.hiddenCount).map((group) => { const node = activeById.get(Number(group.system_id)); if (!node) return null; const x = view.x + group.x * view.scale; const y = view.y + (group.y + group.visible.length * (group.rowHeight + group.rowGap)) * view.scale; const width = group.width * view.scale; const height = group.rowHeight * view.scale; const focus = () => { onSelectSystem?.(node); onFocusSystem?.(node); }; return <g key={`more-${group.system_id}`} role="button" tabIndex={0} aria-label={`查看${node.zh_name || node.name}全部${group.total}支部署`} transform={`translate(${x} ${y})`} className="tac-map-group" onPointerDown={(event) => event.stopPropagation()} onClick={focus} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); focus(); } }}><rect width={width} height={height} rx="5" fill="#354643" stroke="#849e89" /><text x="9" y="17" fill="#dfe9d7" fontSize="12">+ {group.hiddenCount} 支 · 全部</text></g>; })}
      {portals.map((portal) => { const node = byId.get(Number(portal.source_system_id)); if (!node) return null; const x = view.x + node.px * view.scale; const y = view.y + node.py * view.scale; return <g key={portal.id} className="tac-map-portal" transform={`translate(${x} ${y})`} pointerEvents="none"><circle r="10" fill="none" stroke="#d8b36e" strokeDasharray="3 3" /><text x="14" y="4" fill="#e3c991" fontSize="10">↗ {portal.label}</text></g>; })}
      {drag && <g pointerEvents="none"><circle cx={view.x + drag.x * view.scale} cy={view.y + drag.y * view.scale} r="15" fill="#d6b987" opacity=".8" />{drag.target && <circle cx={view.x + drag.target.px * view.scale} cy={view.y + drag.target.py * view.scale} r="20" fill="none" stroke={adjacent.has(Number(drag.target.system_id)) ? "#92c7a9" : "#de8f79"} strokeWidth="3" />}</g>}
    </svg>
    {!nodes.length && <div className="tac-map-empty"><Crosshair size={30} /><strong>先确定这次作战的范围</strong><span>选择相关星域后加载局部星图，避免下载整个宇宙。</span></div>}
    <div className="tac-map-caption"><span>{hint || (mode === "overview" ? "点击星座进入局部战术图 · 连线代表真实星门通道" : canMove ? (!hasOverview ? "拖动空白平移 · 按钮缩放 · 拖动部队到相邻星系" : "拖动空白平移 · 滚轮或按钮缩放 · 拖动部队到相邻星系") : "点击星系选择上报地点 · 拖动空白平移")}</span><span>{mode === "overview" ? `${nodes.length} 个星座` : `${nodes.length} 星系`}{portals.length ? ` · ${portals.length} 处边界出口` : ""}</span></div>
  </div>;
}
