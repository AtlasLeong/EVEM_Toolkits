import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { isHistoricalSighting, pirateMapMarkers } from '../../utils/pirateIntel'
import { projectSystemsScoped, systemDisplayName, zoomAroundPoint } from '../../utils/tacticalMapLayout'
import { indexGateSegments, labelVisibilityState, layoutIntelLabels, subscribeMapWheel } from '../../utils/tacticalMapInteraction'
import { BoardGateLine, BoardStarGlyph, BoardSystemLabel } from './BoardMapPrimitives'
import '../../styles/pirateIntelMap.css'

const INITIAL_CAMERA = { x: 0, y: 0, scale: 1 }
const INITIAL_VIEWPORT = { width: 1000, height: 600 }
const MAP_PADDING = { left: 54, right: 54, top: 64, bottom: 54 }
const CARD_WIDTH = 168
const CARD_HEIGHT = 54
const CARD_EDGE = 8
const CARD_TOP = 56
const CARD_BOTTOM_CLEARANCE = 60
const PICKER_TARGET_LIMIT = 40
const useViewportEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

const clamp = (value, lower, upper) => Math.max(lower, Math.min(upper, value))
const overlapArea = (a, b) => Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top))

/** Desktop overlays occupy the top strip and the left side of the map stage. */
function pirateMapSafeArea(viewport, desktopOverlay = viewport.width >= 1100) {
  if (!desktopOverlay) {
    const wrappedToolbar = viewport.width < 540
    return { padding: wrappedToolbar ? { ...MAP_PADDING, top: 116 } : MAP_PADDING,
      cardLeft: CARD_EDGE, cardTop: wrappedToolbar ? 108 : CARD_TOP }
  }
  const left = Math.min(354, Math.max(306, viewport.width - 180))
  const top = Math.min(174, Math.max(160, viewport.height - 160))
  const right = Math.min(68, Math.max(24, viewport.width - left - 112))
  const bottom = Math.min(70, Math.max(24, viewport.height - top - 120))
  return { padding: { left, right, top, bottom }, cardLeft: left, cardTop: 160 }
}

/** Detail floats over the right side; reserve its width without refitting the static star map. */
function pirateMapCardSafeArea(baseArea, detailOpen, desktopOverlay) {
  if (!detailOpen || !desktopOverlay) return baseArea
  return { ...baseArea, padding: { ...baseArea.padding, right: Math.max(baseArea.padding.right, 344) } }
}

/** Screen culling plus world-aligned LOD keeps small pans from reshuffling dense markers. */
function samplePirateViewportNodes(items, viewport, camera, { limit, marker = false, preferredKey = null, margin = 24 }) {
  // Sparse scenes keep every existing marker/label, including constellation overlays.
  if (items.length <= (marker ? limit : 200)) return items
  const aspect = viewport.width / Math.max(1, viewport.height)
  const columns = clamp(Math.floor(Math.sqrt(limit * .72 * aspect)), 1, 18)
  const rows = Math.max(1, Math.floor(limit * .72 / columns))
  const worldCellWidth = viewport.width / columns / camera.scale
  const worldCellHeight = viewport.height / rows / camera.scale
  const buckets = new Map()
  let preferred = null
  for (const item of items) {
    const x = marker ? item.x : item.px
    const y = marker ? item.y : item.py
    const key = marker ? item.key : item.system_id
    const preferredMatch = marker ? key === preferredKey : String(key) === String(preferredKey)
    if (preferredKey != null && preferredMatch) { preferred = item; continue }
    const screenX = x * camera.scale + camera.x + (marker ? item.offset_x || 0 : 0)
    const screenY = y * camera.scale + camera.y + (marker ? item.offset_y || 0 : 0)
    if (screenX < -margin || screenX > viewport.width + margin ||
      screenY < -margin || screenY > viewport.height + margin) continue
    const cellX = Math.floor(x / worldCellWidth), cellY = Math.floor(y / worldCellHeight)
    const bucketKey = `${cellX}:${cellY}`
    const centerX = (cellX + .5) * worldCellWidth, centerY = (cellY + .5) * worldCellHeight
    const distance = (x - centerX) ** 2 + (y - centerY) ** 2
    const priority = marker ? 0 : Number(Boolean(item.primary))
    const previous = buckets.get(bucketKey)
    if (!previous || priority > previous.priority || priority === previous.priority && distance < previous.distance) {
      buckets.set(bucketKey, { item, priority, distance })
    }
  }
  const sampled = [...buckets.values()].slice(0, limit - Number(Boolean(preferred))).map(value => value.item)
  if (preferred) sampled.push(preferred)
  return sampled
}

function stablePirateSubset(previous, next) {
  return previous?.length === next.length && next.every((item, index) => item === previous[index]) ? previous : next
}

/** Keep the subset of HTML cards stable while the visible world is panned or zoomed. */
function samplePirateCardAnchors(visible, limit, selectedKey) {
  if (visible.length <= limit) return visible
  const remaining = [...visible]
  const nearestDistances = Array(remaining.length).fill(Infinity)
  const chosen = []
  const choose = index => {
    const card = remaining.splice(index, 1)[0]
    nearestDistances.splice(index, 1)
    chosen.push(card)
    remaining.forEach((other, candidate) => {
      const distance = (card.marker.x - other.marker.x) ** 2 + (card.marker.y - other.marker.y) ** 2
      nearestDistances[candidate] = Math.min(nearestDistances[candidate], distance)
    })
  }
  const selectedIndex = selectedKey == null ? -1
    : remaining.findIndex(card => card.marker.targets?.some(target => target.key === selectedKey))
  if (selectedIndex >= 0) choose(selectedIndex)
  else {
    let centerX = 0, centerY = 0
    for (const card of remaining) { centerX += card.marker.x; centerY += card.marker.y }
    centerX /= remaining.length; centerY /= remaining.length
    let closest = 0, distance = Infinity
    remaining.forEach((card, index) => {
      const next = (card.marker.x - centerX) ** 2 + (card.marker.y - centerY) ** 2
      if (next < distance) { closest = index; distance = next }
    })
    choose(closest)
  }
  while (chosen.length < limit) {
    let farthest = 0, distance = -1
    nearestDistances.forEach((nearest, index) => {
      if (nearest > distance) { farthest = index; distance = nearest }
    })
    choose(farthest)
  }
  return chosen
}

/** Place only a readable number of fixed-size HTML cards for the sampled visible markers. */
export function layoutPirateTargetCards(markers, viewport, camera, labels = [], safeArea = pirateMapSafeArea(viewport), selectedKey = null) {
  const minLeft = safeArea.cardLeft
  const rightInset = Math.max(CARD_EDGE, safeArea.padding.right)
  const width = Math.min(CARD_WIDTH, Math.max(72, viewport.width - minLeft - rightInset))
  const height = CARD_HEIGHT
  const maxLeft = Math.max(minLeft, viewport.width - width - rightInset)
  const bottomLimit = Math.max(CARD_EDGE, viewport.height - height - CARD_BOTTOM_CLEARANCE)
  const minTop = Math.min(safeArea.cardTop, bottomLimit)
  const maxTop = Math.max(minTop, bottomLimit)
  const columns = Math.max(1, Math.floor((maxLeft - minLeft) / (width + CARD_EDGE)) + 1)
  const rows = Math.max(1, Math.floor((maxTop - minTop) / (height + CARD_EDGE)) + 1)
  const limit = Math.min(24, columns * rows)
  const slots = Array.from({ length: columns * rows }, (_, index) => {
    const column = index % columns, row = Math.floor(index / columns)
    return { left: minLeft + (columns === 1 ? 0 : column * (maxLeft - minLeft) / (columns - 1)),
      top: minTop + (rows === 1 ? 0 : row * (maxTop - minTop) / (rows - 1)), width, height }
  })
  const projected = markers.map(marker => {
    const x = marker.x * camera.scale + camera.x
    const y = marker.y * camera.scale + camera.y
    return { marker, anchorX: x + (marker.offset_x || 0), anchorY: y + (marker.offset_y || 0),
      labelLeft: x + 9, labelTop: y - 22 }
  })
  const visible = projected.filter(card => card.anchorX >= -24 && card.anchorX <= viewport.width + 24 &&
    card.anchorY >= -24 && card.anchorY <= viewport.height + 24)
  const crowded = visible.length > limit
  const chosen = samplePirateCardAnchors(visible, limit, selectedKey)
  const occupied = []
  const nearViewport = zone => zone.left < viewport.width && zone.left + zone.width > 0 &&
    zone.top < viewport.height && zone.top + zone.height > 0
  const labelZones = crowded ? [] : [
    ...projected.map(card => ({ left: card.labelLeft, top: card.labelTop, width: 76, height: 20 })),
    ...labels.filter(label => label.primary).map(label => ({
      left: label.px * camera.scale + camera.x + 9,
      top: label.py * camera.scale + camera.y - 22,
      width: 76, height: 20,
    })),
  ].filter(nearViewport)
  const usedSlots = new Set()
  return chosen.flatMap(card => {
    const { anchorX, anchorY } = card
    if (crowded) {
      let bestIndex = -1, bestDistance = Infinity
      slots.forEach((slot, index) => {
        if (usedSlots.has(index)) return
        const distance = (anchorX - clamp(anchorX, slot.left, slot.left + width)) ** 2 +
          (anchorY - clamp(anchorY, slot.top, slot.top + height)) ** 2
        if (distance < bestDistance) { bestIndex = index; bestDistance = distance }
      })
      if (bestIndex < 0) return []
      usedSlots.add(bestIndex)
      const { left, top } = slots[bestIndex]
      return [{ ...card, left, top, width, height,
        tetherX: clamp(anchorX, left, left + width), tetherY: clamp(anchorY, top, top + height) }]
    }
    const candidates = [
      [anchorX - width / 2, anchorY - height - 22], [anchorX - width / 2, anchorY + 48],
      [anchorX + 24, anchorY + 14], [anchorX - width - 24, anchorY + 14],
      [anchorX + 24, anchorY - height - 14], [anchorX - width - 24, anchorY - height - 14],
      [anchorX + 24, anchorY + 44], [anchorX - width - 24, anchorY + 44],
      [anchorX + 24, anchorY - height - 44], [anchorX - width - 24, anchorY - height - 44],
    ]
    const options = candidates.flatMap(([candidateLeft, candidateTop], index) => {
      const rect = { left: clamp(candidateLeft, minLeft, maxLeft), top: clamp(candidateTop, minTop, maxTop), width, height }
      const collisions = occupied.reduce((sum, previous) => sum + overlapArea(rect, previous), 0)
      if (collisions) return []
      const labels = labelZones.reduce((sum, label) => sum + overlapArea(rect, label), 0)
      const displacement = Math.abs(rect.left - candidateLeft) + Math.abs(rect.top - candidateTop)
      return [{ ...rect, score: labels * 4 + displacement * 3 + index }]
    })
    if (!options.length) slots.forEach((slot, index) => {
      if (occupied.some(previous => overlapArea(slot, previous))) return
      const labels = labelZones.reduce((sum, label) => sum + overlapArea(slot, label), 0)
      const displacement = Math.hypot(anchorX - clamp(anchorX, slot.left, slot.left + width),
        anchorY - clamp(anchorY, slot.top, slot.top + height))
      options.push({ ...slot, score: labels * 4 + displacement * 3 + index })
    })
    if (!options.length) return []
    const best = options.reduce((best, option) => option.score < best.score ? option : best)
    const { left, top } = best
    const placed = { ...card, left, top, width, height,
      tetherX: clamp(anchorX, left, left + width), tetherY: clamp(anchorY, top, top + height) }
    occupied.push(placed)
    return [placed]
  })
}

/** Keep a searched target comfortably visible, without moving an already visible map. */
export function focusPirateCamera(camera, marker, viewport, safeArea = pirateMapSafeArea(viewport)) {
  const x = marker.x * camera.scale + camera.x + (marker.offset_x || 0)
  const y = marker.y * camera.scale + camera.y + (marker.offset_y || 0)
  const insetX = Math.min(180, viewport.width * .25)
  const insetY = Math.min(100, viewport.height * .25)
  const minX = Math.max(insetX, safeArea.padding.left, safeArea.cardLeft)
  const minY = Math.max(insetY, safeArea.padding.top, safeArea.cardTop)
  const maxX = viewport.width - Math.max(insetX, safeArea.padding.right)
  const maxY = viewport.height - Math.max(insetY, safeArea.padding.bottom)
  if (x >= minX && x <= maxX && y >= minY && y <= maxY) return camera
  const focusX = clamp(viewport.width / 2, minX + 24, Math.max(minX + 24, maxX - 24))
  const focusY = clamp(viewport.height / 2, minY + 24, Math.max(minY + 24, maxY - 24))
  return { ...camera, x: camera.x + focusX - x, y: camera.y + focusY - y }
}

/** Only static universe geometry determines layout. Sighting updates never move stars. */
export function createPirateMapGeometry(mapData = {}, viewport = INITIAL_VIEWPORT, { desktopOverlay } = {}) {
  const safeArea = pirateMapSafeArea(viewport, desktopOverlay)
  const rawSystems = mapData?.systems || []
  const regions = new Set((mapData?.scope?.region_ids || []).map(Number))
  const coreIds = regions.size
    ? rawSystems.filter(node => regions.has(Number(node.region_id))).map(node => node.system_id)
    : undefined
  const systems = projectSystemsScoped(rawSystems, { ...viewport, padding: safeArea.padding, fitIds: coreIds })
  const byId = new Map(systems.map(node => [Number(node.system_id), node]))
  const gates = []
  const seenGates = new Set()
  for (const gate of mapData?.stargates || []) {
    const sourceId = Number(gate.system_id ?? gate.source_system_id)
    const destinationId = Number(gate.destination_system_id ?? gate.target_system_id)
    const source = byId.get(sourceId)
    const destination = byId.get(destinationId)
    if (!source || !destination || sourceId === destinationId) continue
    const key = [sourceId, destinationId].sort((a, b) => a - b).join(':')
    if (seenGates.has(key)) continue
    seenGates.add(key)
    gates.push({ key, x1: source.px, y1: source.py, x2: destination.px, y2: destination.py })
  }
  const labelStep = Math.max(1, Math.ceil(systems.length / 42))
  const labels = systems.map((node, index) => ({ ...node, baseLabel: index % labelStep === 0 }))
  return { systems, gates, labels, safeArea }
}

export function createPirateMapScene(mapData = {}, targets = [], viewport = INITIAL_VIEWPORT,
  { now = Date.now(), geometry = createPirateMapGeometry(mapData, viewport) } = {}) {
  const { systems, gates } = geometry
  const markers = pirateMapMarkers(targets, systems).map(marker => {
    const historical_count = marker.targets.filter(target => isHistoricalSighting(target.latest, now)).length
    const nearStar = marker.location_kind === 'constellation' && systems.some(node =>
      Number(node.constellation_id) === Number(marker.location_id) && Math.hypot(marker.x - node.px, marker.y - node.py) < 17)
    return { ...marker, historical_count, is_historical: historical_count === marker.count,
      offset_x: nearStar ? marker.x > viewport.width / 2 ? -26 : 26 : 0,
      offset_y: nearStar ? marker.y < viewport.height / 2 ? 24 : -24 : 0 }
  })
  const markedSystems = new Set(markers.filter(marker => marker.location_kind === 'system').map(marker => Number(marker.location_id)))
  const labels = geometry.labels.map(node => ({ ...node,
    primary: node.baseLabel || markedSystems.has(Number(node.system_id)),
  }))
  return { systems, gates, markers, labels }
}

export function zoomPirateCamera(camera, anchor, deltaY) {
  const factor = Math.exp(-Math.max(-1200, Math.min(1200, deltaY)) * 0.0012)
  const next = zoomAroundPoint({ zoom: camera.scale, panX: camera.x, panY: camera.y }, anchor, factor,
    { min: 0.55, max: 8 })
  return { x: next.panX, y: next.panY, scale: next.zoom }
}

export function panPirateCamera(camera, origin, current) {
  return { x: camera.x + current.x - origin.x, y: camera.y + current.y - origin.y, scale: camera.scale }
}

/** Pan commits per frame; wheel previews only transform layers until idle. */
export function createPirateCameraScheduler(commit, {
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = frame => window.cancelAnimationFrame(frame),
  setTimer = callback => setTimeout(callback, 220),
  clearTimer = timer => clearTimeout(timer),
  onPreview = commit,
} = {}) {
  let current = INITIAL_CAMERA
  let pendingFrame = null
  let pendingTimer = null
  let previewing = false
  const nextCamera = update => { current = typeof update === 'function' ? update(current) : update }
  const cancelPending = () => {
    if (pendingFrame !== null) cancelFrame(pendingFrame)
    if (pendingTimer !== null) clearTimer(pendingTimer)
    pendingFrame = null
    pendingTimer = null
    previewing = false
  }
  const queueFrame = () => {
    if (pendingFrame === null) pendingFrame = requestFrame(() => {
      pendingFrame = null
      if (previewing) onPreview(current)
      else commit(current)
    })
  }
  return {
    current: () => current,
    schedule(update) {
      if (pendingTimer !== null) clearTimer(pendingTimer)
      pendingTimer = null
      previewing = false
      nextCamera(update)
      queueFrame()
    },
    preview(update) {
      nextCamera(update)
      previewing = true
      queueFrame()
      if (pendingTimer !== null) clearTimer(pendingTimer)
      pendingTimer = setTimer(() => {
        cancelPending()
        commit(current)
      })
    },
    immediate(update) {
      nextCamera(update)
      cancelPending()
      commit(current)
    },
    dispose: cancelPending,
  }
}

export function finishPirateDrag(scheduler, drag, point, cancelled = false) {
  scheduler.immediate(cancelled ? scheduler.current() : panPirateCamera(drag.camera, drag.origin, point))
}

function eventPoint(event, svg, viewport) {
  const rect = svg?.getBoundingClientRect()
  if (!rect?.width || !rect?.height) return { x: viewport.width / 2, y: viewport.height / 2 }
  return {
    x: (event.clientX - rect.left) * viewport.width / rect.width,
    y: (event.clientY - rect.top) * viewport.height / rect.height,
  }
}

const StaticGeometry = memo(function StaticGeometry({ geometry, scale }) {
  return <>
    <g className="pirate-map__routes" aria-hidden="true">
      {geometry.gates.map(gate => <BoardGateLine key={gate.key} className="pirate-map__gate" scale={scale}
        a={{ px: gate.x1, py: gate.y1 }} b={{ px: gate.x2, py: gate.y2 }} />)}
    </g>
    <g className="pirate-map__stars" aria-hidden="true">
      {geometry.systems.map(node => <BoardStarGlyph key={node.system_id} node={node} scale={scale}
        dotClassName="pirate-map__star" />)}
    </g>
  </>
})

const StaticLabels = memo(function StaticLabels({ labels, byId, selectedSystemId }) {
  return labels.map(label => <g key={label.system_id} className="pirate-map__label">
    <BoardSystemLabel label={label} node={byId.get(Number(label.system_id))}
      selected={Number(label.system_id) === selectedSystemId} />
  </g>)
})

const StaticSystemHits = memo(function StaticSystemHits({ systems, scale, selectedSystemId, onSelectSystem }) {
  const activate = (event, node) => {
    event.stopPropagation()
    onSelectSystem?.(node)
  }
  return <g className="pirate-map__system-hits">
    {systems.map(node => {
      const id = Number(node.system_id)
      const security = Number.isFinite(Number(node.security_status)) ? Number(node.security_status).toFixed(2) : '未知'
      return <circle key={id} className={`pirate-map__system-hit${id === selectedSystemId ? ' pirate-map__system-hit--selected' : ''}`}
        data-pirate-system={id} cx={node.px} cy={node.py} r={22 / Math.max(.0001, scale)} role="button" tabIndex={0}
        aria-label={`${systemDisplayName(node)} (${id})，安等 ${security}`}
        onClick={event => activate(event, node)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event, node) } }} />
    })}
  </g>
})

const TargetMarker = memo(function TargetMarker({ marker, selected, tabbable, inverseScale, onActivate }) {
  const isConstellation = marker.location_kind === 'constellation'
  const offsetX = marker.offset_x || 0, offsetY = marker.offset_y || 0
  const historyLabel = marker.is_historical ? '，历史线索（目击已超过 48 小时）'
    : marker.historical_count ? `，其中 ${marker.historical_count} 条历史线索` : ''
  const label = `${marker.location_name || marker.location_id}：${marker.count} 个目标，${isConstellation ? '星座范围（非精确星系）' : '星系定位'}${historyLabel}`
  const activate = event => { event.stopPropagation(); onActivate(marker) }
  return <g className={`pirate-map__marker pirate-map__marker--${marker.location_kind}${selected ? ' pirate-map__marker--selected' : ''}${marker.is_historical ? ' pirate-map__marker--historical' : ''}`}
    data-location-kind={marker.location_kind} data-pirate-marker={marker.key}
    role="button" tabIndex={tabbable ? 0 : -1} aria-label={label}
    transform={`translate(${marker.x + offsetX * inverseScale} ${marker.y + offsetY * inverseScale}) scale(${inverseScale})`}
    onPointerDown={event => event.stopPropagation()} onClick={activate}
    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(event) } }}>
    <title>{label}</title>
    {isConstellation && Boolean(offsetX || offsetY) && <g className="pirate-map__constellation-range" aria-hidden="true" pointerEvents="none">
      <line x1={-offsetX} y1={-offsetY} x2={0} y2={0} />
      <circle cx={-offsetX} cy={-offsetY} r={17} />
    </g>}
    <circle className="pirate-map__marker-halo" r={18} pointerEvents={isConstellation ? undefined : 'none'} />
    {isConstellation
      ? <path className="pirate-map__marker-shape" d="M0 -11 L11 0 L0 11 L-11 0 Z" />
      : <circle className="pirate-map__marker-shape" r={10} />}
    <text className="pirate-map__marker-count" textAnchor="middle" dominantBaseline="central">{marker.count}</text>
  </g>
})

export default function PirateIntelMap({ mapData, targets = [], selectedKey, focusTargetKey, focusRequestId = 0, onSelectTarget, onSelectSystem, selectedSystemId: selectedSystemIdProp, now }) {
  const [viewport, setViewport] = useState(INITIAL_VIEWPORT)
  const [desktopOverlay, setDesktopOverlay] = useState(() => typeof window === 'undefined' ? INITIAL_VIEWPORT.width >= 1100
    : window.matchMedia?.('(min-width: 1100px)')?.matches ?? window.innerWidth >= 1100)
  const [camera, setCamera] = useState(INITIAL_CAMERA)
  const [showZoomLabels, setShowZoomLabels] = useState(false)
  const [wheelMotion, setWheelMotion] = useState(false)
  const [openKey, setOpenKey] = useState(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const svgRef = useRef(null)
  const worldLayerRef = useRef(null)
  const labelLayerRef = useRef(null)
  const tetherLayerRef = useRef(null)
  const cardLayerRef = useRef(null)
  const committedCameraRef = useRef(INITIAL_CAMERA)
  const dragRef = useRef(null)
  const suppressClickRef = useRef(false)
  const wheelHandlerRef = useRef(null)
  const focusedTargetRef = useRef(null)
  const cameraSchedulerRef = useRef(null)
  const pickerRef = useRef(null)
  const visibleMarkersRef = useRef(null)
  const visibleLabelsRef = useRef(null)
  const visibleSystemHitsRef = useRef(null)
  const onSelectTargetRef = useRef(onSelectTarget)
  const defaultNowRef = useRef(null)
  onSelectTargetRef.current = onSelectTarget
  if (defaultNowRef.current === null) defaultNowRef.current = now ?? Date.now()
  const sceneNow = now ?? defaultNowRef.current
  if (!cameraSchedulerRef.current) cameraSchedulerRef.current = createPirateCameraScheduler(setCamera, {
    onPreview: next => {
      const base = committedCameraRef.current
      const ratio = next.scale / Math.max(.0001, base.scale)
      const relative = `translate(${next.x - ratio * base.x} ${next.y - ratio * base.y}) scale(${ratio})`
      worldLayerRef.current?.setAttribute('transform', `translate(${next.x} ${next.y}) scale(${next.scale})`)
      labelLayerRef.current?.setAttribute('transform', relative)
      tetherLayerRef.current?.setAttribute('transform', relative)
      if (cardLayerRef.current) {
        cardLayerRef.current.style.transformOrigin = '0 0'
        cardLayerRef.current.style.transform = `translate(${next.x - ratio * base.x}px, ${next.y - ratio * base.y}px) scale(${ratio})`
      }
    },
  })
  const cameraScheduler = cameraSchedulerRef.current
  useLayoutEffect(() => {
    committedCameraRef.current = camera
    worldLayerRef.current?.setAttribute('transform', `translate(${camera.x} ${camera.y}) scale(${camera.scale})`)
    labelLayerRef.current?.removeAttribute('transform')
    tetherLayerRef.current?.removeAttribute('transform')
    if (cardLayerRef.current) cardLayerRef.current.style.transform = ''
    setWheelMotion(false)
  }, [camera])
  useEffect(() => {
    setShowZoomLabels(previous => labelVisibilityState({ visible: previous, zoom: camera.scale }).visible)
  }, [camera.scale])
  const geometry = useMemo(() => createPirateMapGeometry(mapData, viewport, { desktopOverlay }), [mapData, viewport, desktopOverlay])
  const cardSafeArea = useMemo(() => pirateMapCardSafeArea(geometry.safeArea, Boolean(selectedKey), desktopOverlay),
    [geometry.safeArea, selectedKey, desktopOverlay])
  const scene = useMemo(() => createPirateMapScene(mapData, targets, viewport, { now: sceneNow, geometry }),
    [mapData, targets, viewport, sceneNow, geometry])
  const selectedMarker = useMemo(() => scene.markers.find(marker => marker.targets.some(target => target.key === selectedKey)),
    [scene.markers, selectedKey])
  const nextVisibleMarkers = useMemo(() => samplePirateViewportNodes(scene.markers, viewport, camera,
    { limit: 250, marker: true, preferredKey: selectedMarker?.key }),
    [scene.markers, viewport, camera, selectedMarker])
  const visibleMarkers = stablePirateSubset(visibleMarkersRef.current, nextVisibleMarkers)
  visibleMarkersRef.current = visibleMarkers
  const selectedSystemId = selectedMarker?.location_kind === 'system' ? Number(selectedMarker.location_id) : null
  const nextVisibleLabels = useMemo(() => samplePirateViewportNodes(scene.labels, viewport, camera,
    { limit: camera.scale >= 2.5 ? 180 : 88, preferredKey: selectedSystemId, margin: 40 }),
    [scene.labels, viewport, camera, selectedSystemId])
  const visibleLabels = stablePirateSubset(visibleLabelsRef.current, nextVisibleLabels)
  visibleLabelsRef.current = visibleLabels
  const selectedSystemHitId = selectedSystemIdProp ?? selectedSystemId
  const nextVisibleSystemHits = useMemo(() => samplePirateViewportNodes(geometry.systems, viewport, camera,
    { limit: 250, preferredKey: selectedSystemHitId, margin: 40 }),
    [geometry.systems, viewport, camera, selectedSystemHitId])
  const visibleSystemHits = stablePirateSubset(visibleSystemHitsRef.current, nextVisibleSystemHits)
  visibleSystemHitsRef.current = visibleSystemHits
  const cards = useMemo(() => layoutPirateTargetCards(visibleMarkers, viewport, camera, visibleLabels, cardSafeArea, selectedKey),
    [visibleMarkers, visibleLabels, viewport, camera, cardSafeArea, selectedKey])
  const bySystemId = useMemo(() => new Map(geometry.systems.map(node => [Number(node.system_id), node])), [geometry.systems])
  const onSelectSystemRef = useRef(onSelectSystem)
  onSelectSystemRef.current = onSelectSystem
  const activateSystem = useCallback(system => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    onSelectSystemRef.current?.(system)
  }, [])
  const labelLayouts = useMemo(() => {
    const screenLabels = visibleLabels.filter(node => node.primary || showZoomLabels || node.system_id === selectedSystemId)
      .map(node => ({ ...node, px: node.px * camera.scale + camera.x,
        py: node.py * camera.scale + camera.y, zh_name: systemDisplayName(node) }))
    const gateSegments = indexGateSegments(geometry.gates.map(gate => ({
      x1: gate.x1 * camera.scale + camera.x, y1: gate.y1 * camera.scale + camera.y,
      x2: gate.x2 * camera.scale + camera.x, y2: gate.y2 * camera.scale + camera.y,
    })), viewport)
    return layoutIntelLabels(screenLabels, { ...viewport, selectedId: selectedSystemId,
      forceIds: new Set(scene.markers.filter(marker => marker.location_kind === 'system')
        .map(marker => Number(marker.location_id))), zoom: camera.scale, showAll: true,
      occupied: cards.map(card => ({ x: card.left, y: card.top, width: card.width, height: card.height })),
      gateSegments, padding: { ...geometry.safeArea.padding, left: Math.max(14, geometry.safeArea.cardLeft) } })
  }, [visibleLabels, showZoomLabels, selectedSystemId, camera, geometry.gates, geometry.safeArea, scene.markers, cards, viewport])
  const cardlessLocations = scene.markers.length - cards.length
  const openMarker = scene.markers.find(marker => marker.key === openKey && marker.targets.length > 1)
  const filteredPickerTargets = useMemo(() => {
    if (!openMarker) return []
    const query = pickerQuery.trim().toLowerCase()
    if (!query) return openMarker.targets
    return openMarker.targets.filter(target => `${target.character_name || ''} ${target.ship_type || ''}`.toLowerCase().includes(query))
  }, [openMarker, pickerQuery])
  const pickerTargets = filteredPickerTargets.slice(0, PICKER_TARGET_LIMIT)
  const pickerNeedsSearch = Boolean(openMarker && openMarker.targets.length > PICKER_TARGET_LIMIT)

  useEffect(() => () => cameraScheduler.dispose(), [cameraScheduler])

  useViewportEffect(() => {
    const svg = svgRef.current
    if (!svg) return undefined
    const measure = () => {
      const bounds = svg.getBoundingClientRect()
      if (bounds.width > 0 && bounds.height > 0) {
        setViewport(previous => Math.abs(previous.width - bounds.width) < 1 && Math.abs(previous.height - bounds.height) < 1
          ? previous : { width: bounds.width, height: bounds.height })
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(svg)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia?.('(min-width: 1100px)')
    if (!media) return undefined
    const update = () => setDesktopOverlay(media.matches)
    media.addEventListener?.('change', update)
    update()
    return () => media.removeEventListener?.('change', update)
  }, [])

  useEffect(() => {
    cameraScheduler.immediate(INITIAL_CAMERA)
    setOpenKey(null)
    focusedTargetRef.current = null
  }, [mapData?.scope?.version, cameraScheduler])

  useEffect(() => {
    if (!focusTargetKey) { focusedTargetRef.current = null; return }
    const marker = scene.markers.find(item => item.targets.some(target => target.key === focusTargetKey))
    if (!marker) return
    const signature = `${focusTargetKey}:${focusRequestId}:${marker.key}:${viewport.width}:${viewport.height}:${cardSafeArea.padding.right}`
    if (focusedTargetRef.current === signature) return
    focusedTargetRef.current = signature
    cameraScheduler.immediate(current => focusPirateCamera(current, marker, viewport, cardSafeArea))
  }, [focusTargetKey, focusRequestId, scene.markers, viewport, cardSafeArea, cameraScheduler])

  useEffect(() => {
    if (openKey) pickerRef.current?.querySelector(pickerNeedsSearch ? 'input' : 'button')?.focus()
  }, [openKey, pickerNeedsSearch])

  wheelHandlerRef.current = event => {
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1)
    if (!Number.isFinite(delta) || delta === 0) return
    setWheelMotion(true)
    cameraScheduler.preview(current => zoomPirateCamera(current, eventPoint(event, svgRef.current, viewport), delta))
  }
  useEffect(() => svgRef.current
    ? subscribeMapWheel(svgRef.current, event => wheelHandlerRef.current?.(event))
    : undefined, [])

  const activateMarker = useCallback(marker => {
    if (suppressClickRef.current) { suppressClickRef.current = false; return }
    if (marker.targets.length === 1) {
      setOpenKey(null)
      onSelectTargetRef.current?.(marker.targets[0])
    } else {
      setPickerQuery('')
      setOpenKey(current => current === marker.key ? null : marker.key)
    }
  }, [])
  const keyboardMarkerKey = visibleMarkers.some(marker => marker.key === selectedMarker?.key)
    ? selectedMarker.key : visibleMarkers[0]?.key
  const markerLayer = useMemo(() => {
    const ordered = [...visibleMarkers].reverse()
    const selectedIndex = ordered.findIndex(marker => marker.key === selectedMarker?.key)
    if (selectedIndex >= 0) ordered.push(ordered.splice(selectedIndex, 1)[0])
    return <g className="pirate-map__markers">
    {ordered.map(marker => <TargetMarker key={marker.key} marker={marker}
      inverseScale={1 / camera.scale} selected={marker.targets.some(target => target.key === selectedKey)}
      tabbable={marker.key === keyboardMarkerKey} onActivate={activateMarker} />)}
    </g>
  }, [visibleMarkers, selectedKey, selectedMarker?.key, keyboardMarkerKey, camera.scale, activateMarker])
  const zoom = multiplier => cameraScheduler.immediate(current => {
    const next = zoomAroundPoint({ zoom: current.scale, panX: current.x, panY: current.y },
      { x: viewport.width / 2, y: viewport.height / 2 }, multiplier, { min: 0.55, max: 8 })
    return { x: next.panX, y: next.panY, scale: next.zoom }
  })
  const pointerDown = event => {
    if (event.button !== 0) return
    const origin = eventPoint(event, svgRef.current, viewport)
    dragRef.current = { pointerId: event.pointerId, origin, camera: cameraScheduler.current() }
    setOpenKey(null)
  }
  const pointerMove = event => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const point = eventPoint(event, svgRef.current, viewport)
    if (Math.hypot(point.x - drag.origin.x, point.y - drag.origin.y) > 6) {
      if (!drag.moved) event.currentTarget.setPointerCapture?.(event.pointerId)
      drag.moved = true
    }
    cameraScheduler.schedule(panPirateCamera(drag.camera, drag.origin, point))
  }
  const pointerEnd = event => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    suppressClickRef.current = Boolean(dragRef.current.moved)
    finishPirateDrag(cameraScheduler, dragRef.current,
      eventPoint(event, svgRef.current, viewport), event.type === 'pointercancel')
    dragRef.current = null
    if (suppressClickRef.current) setTimeout(() => { suppressClickRef.current = false }, 0)
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const openMarkerSelected = openMarker && openMarker.targets.some(target => target.key === selectedKey)
  const popupX = openMarker ? Math.max(12, Math.min(viewport.width - 224, openMarker.x * camera.scale + camera.x + openMarker.offset_x + 16)) : 0
  const popupY = openMarker ? Math.max(54, Math.min(viewport.height - (pickerNeedsSearch ? 264 : 170),
    openMarker.y * camera.scale + camera.y + openMarker.offset_y + 16)) : 0
  const noScope = mapData && !(mapData.scope?.region_ids || []).length

  return <div className={`pirate-map${wheelMotion ? ' pirate-map--wheel-motion' : ''}`}>
    <svg ref={svgRef} className="pirate-map__svg" viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none" role="group" aria-label="海盗情报星图"
      onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}>
      <g ref={worldLayerRef} className="pirate-map__world" transform={`translate(${camera.x} ${camera.y}) scale(${camera.scale})`}>
        <StaticGeometry geometry={geometry} scale={camera.scale} />
        <StaticSystemHits systems={visibleSystemHits} scale={camera.scale}
          selectedSystemId={selectedSystemHitId} onSelectSystem={activateSystem} />
        {markerLayer}
      </g>
      <g ref={labelLayerRef} className="pirate-map__labels">
        <StaticLabels labels={labelLayouts} byId={bySystemId} selectedSystemId={selectedSystemIdProp ?? selectedSystemId} />
      </g>
    </svg>
    <svg className="pirate-map__card-tethers" viewBox={`0 0 ${viewport.width} ${viewport.height}`}
      preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <g ref={tetherLayerRef}>
      {cards.map(card => <line key={card.marker.key} className="pirate-map__card-tether"
        x1={card.anchorX} y1={card.anchorY} x2={card.tetherX} y2={card.tetherY} />)}
      </g>
    </svg>
    <div ref={cardLayerRef} className="pirate-map__target-layer" aria-label="地图目标卡">
      {cards.map(card => {
        const marker = card.marker
        const single = marker.targets.length === 1 ? marker.targets[0] : null
        const selected = marker.targets.some(target => target.key === selectedKey)
        const place = marker.location_name || String(marker.location_id)
        const precision = marker.location_kind === 'constellation' ? '星座范围' : '星系定位'
        const history = marker.is_historical ? '历史线索' : marker.historical_count ? `含 ${marker.historical_count} 条历史` : ''
        const cardLabel = single ? `${single.character_name}，${single.ship_type}，${place}，${precision}` : `${place}，${marker.count} 个目标，${precision}`
        return <button key={marker.key} type="button" data-pirate-card={marker.key}
          className={`pirate-map__target-card pirate-map__target-card--${marker.location_kind}${selected ? ' pirate-map__target-card--selected' : ''}${marker.is_historical ? ' pirate-map__target-card--historical' : ''}`}
          style={{ left: card.left, top: card.top, width: card.width }}
          aria-label={`${cardLabel}${history ? `，${history}` : ''}`}
          onPointerDown={event => event.stopPropagation()} onClick={() => activateMarker(marker)}>
          <span className="pirate-map__target-card-title">{single ? single.character_name : place}</span>
          <span className="pirate-map__target-card-meta">{single ? single.ship_type : `${marker.count} 个目标`}<span>{history ? `${precision} · ${history}` : precision}</span></span>
        </button>
      })}
    </div>
    {cardlessLocations > 0 && <div className="pirate-map__card-summary">
      显示 {cards.length}/{scene.markers.length} 处目标卡；其余目标可在列表搜索，放大星图查看更多标记
    </div>}
    <div className="pirate-map__toolbar" aria-label="星图控制">
      <span className="pirate-map__source">{mapData?.data_source?.label || '星系与星门'}</span>
      <span className="pirate-map__legend"><i className="pirate-map__legend-system" /> 星系 <i className="pirate-map__legend-constellation" /> 星座 <i className="pirate-map__legend-history" /> 历史</span>
      <div className="pirate-map__zoom-controls">
        <button type="button" aria-label="放大星图" onClick={() => zoom(1.35)}>+</button>
        <button type="button" aria-label="缩小星图" onClick={() => zoom(1 / 1.35)}>−</button>
        <button type="button" aria-label="重置星图视角" onClick={() => cameraScheduler.immediate(INITIAL_CAMERA)}>适配</button>
      </div>
    </div>
    {openMarker && <div ref={pickerRef} className={`pirate-map__picker${openMarkerSelected ? ' pirate-map__picker--selected' : ''}`}
      style={{ left: popupX, top: popupY }} role="group" aria-label={`${openMarker.location_name || '当前位置'}的目标`}
      onKeyDown={event => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        setOpenKey(null)
        const markerNode = [...(svgRef.current?.querySelectorAll('[data-pirate-marker]') || [])]
          .find(node => node.getAttribute('data-pirate-marker') === openMarker.key)
        markerNode?.focus()
      }}>
      <strong>{openMarker.location_name || '当前位置'} · {openMarker.targets.length} 个目标</strong>
      {pickerNeedsSearch && <>
        <input type="text" inputMode="search" autoComplete="off" aria-label="搜索该地点目标"
          placeholder="搜索角色或船型" value={pickerQuery} onChange={event => setPickerQuery(event.target.value)} />
        <span className="pirate-map__picker-summary" role="status">
          共 {openMarker.targets.length} 个目标{pickerQuery.trim() ? `，匹配 ${filteredPickerTargets.length} 个` : ''}，显示 {pickerTargets.length} 个
          {filteredPickerTargets.length > pickerTargets.length && `；剩余 ${filteredPickerTargets.length - pickerTargets.length} 个请到列表搜索`}
        </span>
      </>}
      <div className="pirate-map__picker-results">
      {pickerTargets.map(target => <button key={target.key} type="button" onClick={() => {
        onSelectTarget?.(target)
        setOpenKey(null)
      }}>{target.character_name}<small>{target.ship_type}{isHistoricalSighting(target.latest, now) ? ' · 历史线索' : ''}</small></button>)}
      {!pickerTargets.length && <span className="pirate-map__picker-empty" role="status">没有匹配的目标，请换个关键词。</span>}
      </div>
    </div>}
    {mapData && !scene.systems.length && <div className="pirate-map__empty" role="status">
      <strong>{noScope ? '这块板尚未设置星图范围' : '当前范围暂无可绘制星系'}</strong>
      <span>{noScope ? '请先设置这块板的星图范围，再在真实星图上查看目标位置。' : '可调整这块板的范围，或稍后重试加载静态星图。'}</span>
    </div>}
    {!mapData && <div className="pirate-map__empty" role="status">正在加载星图…</div>}
  </div>
}
