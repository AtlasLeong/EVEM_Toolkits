import { useEffect, useMemo, useRef, useState } from "react";
import { Crosshair, Minus, Plus } from "lucide-react";
import { layoutForceMarkers } from "../../utils/tacticalMarkerLayout";
import {
  adjacentSystems,
  projectSystems,
  isStale,
  groupMapForces,
} from "../../utils/tacticalCollaboration";

export default function CollaborationMap({
  systems = [],
  stargates = [],
  forces = [],
  boundaryExits = [],
  selectedSystemId,
  onSelectSystem,
  selectedForceId,
  onSelectForce,
  onFocusSystem,
  canMove = false,
  onMoveForce,
  className = "",
}) {
  const [viewport, setViewport] = useState({ width: 1000, height: 800 });
  const safePadding = useMemo(() => ({
    left: 76,
    right: viewport.width >= 1000 ? 354 : 304,
    top: Math.min(260, viewport.height * .32),
    bottom: 110,
  }), [viewport.width, viewport.height]);
  const nodes = useMemo(() => projectSystems(systems, { ...viewport, padding: safePadding }), [systems, viewport, safePadding]);
  const byId = useMemo(
    () => new Map(nodes.map((node) => [Number(node.system_id), node])),
    [nodes],
  );
  const ref = useRef(null);
  const gesture = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, scale: 1 });
  const [drag, setDrag] = useState(null);
  const [hint, setHint] = useState("");
  const unitScale = 1;
  useEffect(() => {
    const node = ref.current;
    const measure = () => {
      const { width, height } = node.getBoundingClientRect();
      if (width > 0 && height > 0) setViewport((previous) =>
        Math.abs(previous.width - width) < 1 && Math.abs(previous.height - height) < 1 ? previous : { width, height });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const adjacent = useMemo(
    () => (drag ? adjacentSystems(stargates, drag.force.system_id) : new Set()),
    [drag?.force?.id, stargates],
  );
  const point = (event) => {
    const matrix = ref.current.getScreenCTM();
    return new DOMPoint(event.clientX, event.clientY).matrixTransform(
      matrix.inverse(),
    );
  };
  const begin = (event, force) => {
    if (event.button !== 0) return;
    if (force) {
      event.stopPropagation();
      onSelectForce?.(force);
      if (!canMove) return;
    }
    const p = point(event);
    gesture.current = {
      id: event.pointerId,
      start: p,
      last: p,
      force,
      view,
      started: false,
    };
    ref.current.setPointerCapture(event.pointerId);
  };
  const move = (event) => {
    const current = gesture.current;
    if (!current) return;
    const p = point(event);
    current.last = p;
    if (
      Math.hypot(p.x - current.start.x, p.y - current.start.y) < 7 &&
      !current.started
    )
      return;
    current.started = true;
    if (current.force) {
      const mapPoint = {
        x: (p.x - view.x) / view.scale,
        y: (p.y - view.y) / view.scale,
      };
      const target = nodes.find(
        (node) =>
          Math.hypot(node.px - mapPoint.x, node.py - mapPoint.y) <
          35 / view.scale,
      );
      setDrag({ force: current.force, x: mapPoint.x, y: mapPoint.y, target });
    } else
      setView({
        ...current.view,
        x: current.view.x + p.x - current.start.x,
        y: current.view.y + p.y - current.start.y,
      });
  };
  const end = () => {
    const current = gesture.current;
    gesture.current = null;
    if (current?.force && current.started && drag?.target) {
      if (adjacent.has(Number(drag.target.system_id))) {
        setHint("移动请求已提交，等待服务器确认");
        onMoveForce?.(current.force, Number(drag.target.system_id));
      } else setHint("只能拖到相邻星门连接的星系；远程纠正请使用“移动部队”。");
    }
    setDrag(null);
  };
  const zoom = (multiplier) =>
    setView((current) => {
      const scale = Math.min(4, Math.max(0.5, current.scale * multiplier));
      return {
        scale,
        x: viewport.width / 2 - ((viewport.width / 2 - current.x) * scale) / current.scale,
        y: viewport.height / 2 - ((viewport.height / 2 - current.y) * scale) / current.scale,
      };
    });
  const forceGroups = useMemo(
    () =>
      groupMapForces(forces, selectedForceId).filter((group) =>
        byId.has(group.system_id),
      ),
    [forces, selectedForceId, byId],
  );
  const forceSystems = useMemo(
    () => new Set(forceGroups.map((group) => group.system_id)),
    [forceGroups],
  );
  const positionedGroups = useMemo(
    () => layoutForceMarkers(forceGroups, nodes, unitScale, viewport),
    [forceGroups, nodes, viewport],
  );
  const markers = positionedGroups.flatMap((group) =>
    group.visible.map((force, index) => ({
      force,
      x: group.x,
      y: group.y + index * (group.rowHeight + group.rowGap),
      width: group.width,
      height: group.rowHeight,
    })),
  );
  // Real regions can contain hundreds of systems. Keep the overview legible by
  // labeling a sparse sample; force locations, selected systems and adjacent
  // jump targets always retain their labels regardless of this sampling.
  const labelStep = Math.max(1, Math.ceil(nodes.length / (32 * view.scale)));
  return (
    <div className={`tac-map ${className}`}>
      <div className="tac-map-toolbar">
        <span>
          <i className="tac-enemy-dot" />
          敌方
          {forces.some((force) => force.side === "friendly") && (
            <>
              <i className="tac-friendly-dot" />
              己方
            </>
          )}
        </span>
        <div>
          <button
            type="button"
            aria-label="缩小地图"
            onClick={() => zoom(1 / 1.25)}
          >
            <Minus size={16} />
          </button>
          <button
            type="button"
            aria-label="放大地图"
            onClick={() => zoom(1.25)}
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="适应作战范围"
            onClick={() => setView({ x: 0, y: 0, scale: 1 })}
          >
            <Crosshair size={16} />
          </button>
        </div>
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${viewport.width} ${viewport.height}`}
        role="group"
        aria-label="局部作战星图"
        tabIndex={0}
        onPointerDown={(event) => begin(event)}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={() => {
          gesture.current = null;
          setDrag(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            gesture.current = null;
            setDrag(null);
          }
          if (event.target === ref.current && ["+", "-"].includes(event.key)) {
            event.preventDefault();
            zoom(event.key === "+" ? 1.25 : 1 / 1.25);
          }
        }}
      >
        <defs>
          <pattern
            id="tac-map-grid"
            width="40"
            height="40"
            patternUnits="userSpaceOnUse"
          >
            <circle cx="1" cy="1" r=".7" fill="#758388" opacity=".2" />
          </pattern>
        </defs>
        <rect width={viewport.width} height={viewport.height} fill="url(#tac-map-grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {stargates.map((gate, index) => {
            const a = byId.get(Number(gate.system_id));
            const b = byId.get(Number(gate.destination_system_id));
            return a && b ? (
              <line
                key={index}
                x1={a.px}
                y1={a.py}
                x2={b.px}
                y2={b.py}
                stroke="#455359"
                strokeWidth={1.2}
              />
            ) : null;
          })}
          {nodes.map((node, index) => (
            <g
              key={node.system_id}
              role="button"
              tabIndex={0}
              aria-label={`选择星系 ${node.zh_name || node.name}`}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={() => onSelectSystem?.(node)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectSystem?.(node);
                }
              }}
              className="tac-map-system"
            >
              <title>{`${node.zh_name || node.name} · 安全系数 ${node.security_status == null ? "未知" : Number(node.security_status).toFixed(2)}`}</title>
              <circle
                cx={node.px}
                cy={node.py}
                r={
                  adjacent.has(Number(node.system_id))
                    ? 13
                    : Number(selectedSystemId) === Number(node.system_id)
                      ? 9
                      : 5
                }
                fill={
                  adjacent.has(Number(node.system_id))
                    ? "#80b2a9"
                    : Number(selectedSystemId) === Number(node.system_id)
                      ? "#ede6cb"
                      : "#b3bec0"
                }
                fillOpacity={adjacent.has(Number(node.system_id)) ? 0.5 : 1}
              />
              <circle cx={node.px} cy={node.py} r="19" fill="transparent" />
              {(index % labelStep === 0 ||
                forceSystems.has(Number(node.system_id)) ||
                Number(selectedSystemId) === Number(node.system_id) ||
                adjacent.has(Number(node.system_id))) && (
                <g pointerEvents="none">
                <text
                  x={node.px}
                  y={node.py + 24}
                  textAnchor="middle"
                  fill="#c4ced0"
                  fontSize={12 * unitScale}
                >
                  {node.zh_name || node.name}
                </text>
                <text x={node.px} y={node.py + 40} textAnchor="middle" fill={node.security_status == null ? "#a6adb1" : node.security_status >= .5 ? "#97c6b0" : node.security_status > 0 ? "#d7b68c" : "#d69d96"} fontSize={11}>
                  {node.security_status == null ? "安等未知" : Number(node.security_status).toFixed(2)}
                </text>
                </g>
              )}
            </g>
          ))}
          {positionedGroups.map((group) => (
            <line
              key={`leader-${group.system_id}`}
              x1={group.leader.from.x}
              y1={group.leader.from.y}
              x2={group.leader.to.x}
              y2={group.leader.to.y}
              stroke="#8daba5"
              strokeWidth={unitScale}
              opacity=".8"
              pointerEvents="none"
            />
          ))}
          {markers.map(({ force, x, y, width, height }) => (
            <g
              key={force.id}
              role="button"
              tabIndex={0}
              aria-label={`${force.side === "friendly" ? "己方" : "敌方"} ${force.name} ${force.people ?? "未知"} 人，${force.system_name}`}
              transform={`translate(${x} ${y})`}
              className={`tac-map-force ${isStale(force.observed_at) ? "is-stale" : ""}`}
              onPointerDown={(event) => begin(event, force)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectForce?.(force);
                }
              }}
            >
              <title>{`${force.name} · ${force.system_name} · ${force.people ?? "未知"} 人`}</title>
              <rect
                width={width}
                height={height}
                rx="6"
                fill={force.side === "friendly" ? "#274b49" : "#673e35"}
                stroke={
                  force.id === selectedForceId
                    ? "#f8efdb"
                    : force.side === "friendly"
                      ? "#57938a"
                      : "#ad7362"
                }
                strokeWidth={force.id === selectedForceId ? 2 : 1}
              />
              <text
                x={9 * unitScale}
                y={17 * unitScale}
                fill="#fff4e8"
                fontSize={12 * unitScale}
              >
                {force.side === "friendly" ? "友" : "敌"} ·{" "}
                {force.people == null ? "未知" : force.people >= 10000 ? `${(force.people / 10000).toFixed(1)}万` : force.people} 人
              </text>
            </g>
          ))}
          {positionedGroups
            .filter((group) => group.hiddenCount)
            .map((group) => {
              const node = byId.get(group.system_id);
              const focus = () => {
                onSelectSystem?.(node);
                onFocusSystem?.(node);
              };
              const position = { x: group.x, y: group.y + group.visible.length * (group.rowHeight + group.rowGap) };
              return (
                <g
                  key={`more-${group.system_id}`}
                  role="button"
                  tabIndex={0}
                  aria-label={`查看${node.zh_name || node.name}全部${group.total}支部署`}
                  transform={`translate(${position.x} ${position.y})`}
                  className="tac-map-group"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={focus}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      focus();
                    }
                  }}
                >
                  <rect
                    width={group.width}
                    height={group.rowHeight}
                    rx="5"
                    fill="#354643"
                    stroke="#849e89"
                  />
                  <text
                    x={9 * unitScale}
                    y={17 * unitScale}
                    fill="#dfe9d7"
                    fontSize={12 * unitScale}
                  >
                    + {group.hiddenCount} 支 · 全部
                  </text>
                </g>
              );
            })}
          {drag && (
            <g pointerEvents="none">
              <circle
                cx={drag.x}
                cy={drag.y}
                r="15"
                fill="#d6b987"
                opacity=".8"
              />
              {drag.target && (
                <circle
                  cx={drag.target.px}
                  cy={drag.target.py}
                  r="20"
                  fill="none"
                  stroke={
                    adjacent.has(Number(drag.target.system_id))
                      ? "#92c7a9"
                      : "#de8f79"
                  }
                  strokeWidth="3"
                />
              )}
            </g>
          )}
        </g>
      </svg>
      {!nodes.length && (
        <div className="tac-map-empty">
          <Crosshair size={30} />
          <strong>先确定这次作战的范围</strong>
          <span>选择相关星域后加载局部星图，避免下载整个宇宙。</span>
        </div>
      )}
      <div className="tac-map-caption">
        <span>
          {hint ||
            (canMove
              ? "拖动空白平移 · 按钮缩放 · 拖动部队到相邻星系"
              : "点击星系选择上报地点 · 拖动空白平移")}
        </span>
        <span>
          {nodes.length} 星系
          {boundaryExits.length ? ` · ${boundaryExits.length} 处边界出口` : ""}
        </span>
      </div>
    </div>
  );
}
