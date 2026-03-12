import { useEffect, useMemo, useRef, useState } from 'react'
import { LocateFixed, RefreshCw, X } from 'lucide-react'

const WORLD_WIDTH = 2400
const WORLD_HEIGHT = 1600
const WORLD_PADDING = 90
const LIGHT_YEAR_IN_METERS = 9.461e15
const LOCATE_ZOOM = 7.56

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function getSecurityColor(value) {
  const level = Number(value)
  if (Number.isNaN(level)) return '#94a3b8'
  if (level <= 0) return '#ef4444'
  if (level < 0.2) return '#f97316'
  if (level < 0.5) return '#f59e0b'
  if (level < 0.8) return '#10b981'
  return '#60a5fa'
}

function getRouteTypeKind(moveType) {
  const value = String(moveType || '')
  if (value.includes('土路')) return 'dirt'
  if (value.includes('不安全')) return 'unsafe-induction'
  if (value.includes('诱导')) return 'induction'
  return 'standard'
}

function getRouteStrokeColor(kind) {
  if (kind === 'dirt') return 'rgba(245, 158, 11, 0.96)'
  if (kind === 'unsafe-induction') return 'rgba(239, 68, 68, 0.96)'
  if (kind === 'induction') return 'rgba(244, 114, 182, 0.96)'
  return 'rgba(96, 165, 250, 0.94)'
}

function average(items) {
  if (!items.length) return 0
  return items.reduce((sum, item) => sum + item, 0) / items.length
}

function getDirectDistanceInLightYears(start, end) {
  if (!start || !end) return null

  const deltaX = Number(end.x) - Number(start.x)
  const deltaY = Number(end.y || 0) - Number(start.y || 0)
  const deltaZ = Number(end.z) - Number(start.z)
  const distanceInMeters = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2)

  if (!Number.isFinite(distanceInMeters)) return null
  return distanceInMeters / LIGHT_YEAR_IN_METERS
}

function createMapModel(systems, stargates, constellations, regions) {
  const validSystems = (systems || []).filter((item) => Number.isFinite(Number(item.x)) && Number.isFinite(Number(item.z)))
  if (!validSystems.length) {
    return {
      systems: [],
      systemMap: new Map(),
      stargates: [],
      regions: [],
    }
  }

  const xs = validSystems.map((item) => Number(item.x))
  const zs = validSystems.map((item) => Number(item.z))
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minZ = Math.min(...zs)
  const maxZ = Math.max(...zs)
  const widthSpan = Math.max(1, maxX - minX)
  const heightSpan = Math.max(1, maxZ - minZ)

  const normalizeX = (value) =>
    WORLD_PADDING + ((Number(value) - minX) / widthSpan) * (WORLD_WIDTH - WORLD_PADDING * 2)
  const normalizeY = (value) =>
    WORLD_HEIGHT - WORLD_PADDING - ((Number(value) - minZ) / heightSpan) * (WORLD_HEIGHT - WORLD_PADDING * 2)

  const normalizedSystems = validSystems.map((item) => ({
    ...item,
    px: normalizeX(item.x),
    py: normalizeY(item.z),
    securityLabel: Number(item.security_status).toFixed(1),
  }))

  const systemMap = new Map(normalizedSystems.map((item) => [item.system_id, item]))
  const stargateLines = (stargates || [])
    .map((item) => {
      const start = systemMap.get(item.system_id)
      const end = systemMap.get(item.destination_system_id)
      if (!start || !end) return null
      return {
        key: `${item.system_id}-${item.destination_system_id}`,
        x1: start.px,
        y1: start.py,
        x2: end.px,
        y2: end.py,
      }
    })
    .filter(Boolean)

  const groupedRegionCoords = {}
  ;(constellations || []).forEach((item) => {
    if (!groupedRegionCoords[item.region_id]) {
      groupedRegionCoords[item.region_id] = { x: [], z: [] }
    }
    groupedRegionCoords[item.region_id].x.push(Number(item.x))
    groupedRegionCoords[item.region_id].z.push(Number(item.z))
  })

  const regionLabels = (regions || [])
    .map((item) => {
      const coords = groupedRegionCoords[item.region_id]
      if (!coords?.x?.length) return null
      return {
        key: item.region_id,
        label: item.zh_name,
        x: normalizeX(average(coords.x)),
        y: normalizeY(average(coords.z)),
      }
    })
    .filter(Boolean)

  return {
    systems: normalizedSystems,
    systemMap,
    stargates: stargateLines,
    regions: regionLabels,
  }
}

function findNearestSystem(modelSystems, screenX, screenY, view) {
  let nearest = null
  let nearestDistance = 12

  for (const item of modelSystems) {
    const x = item.px * view.zoom + view.panX
    const y = item.py * view.zoom + view.panY
    const distance = Math.hypot(screenX - x, screenY - y)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearest = item
    }
  }

  return nearest
}

function getScreenPoint(system, view) {
  if (!system) return null
  return {
    x: system.px * view.zoom + view.panX,
    y: system.py * view.zoom + view.panY,
  }
}

function easeOutCubic(progress) {
  return 1 - (1 - progress) ** 3
}

function rankSystemMatch(systemName, query) {
  const lowerName = systemName.toLowerCase()
  const lowerQuery = query.toLowerCase()
  const startsWith = lowerName.startsWith(lowerQuery)
  const index = lowerName.indexOf(lowerQuery)

  return {
    startsWith,
    index: index === -1 ? Number.MAX_SAFE_INTEGER : index,
    length: systemName.length,
  }
}

function getSystemAliases(system) {
  const values = [
    system?.zh_name,
    system?.name,
    system?.en_name,
    system?.english_name,
    system?.system_name,
    system?.name_en,
  ]

  return [...new Set(values.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim()))]
}

function getBestAliasMatch(system, query) {
  const aliases = getSystemAliases(system)
  const lowerQuery = query.toLowerCase()
  let best = null

  aliases.forEach((alias) => {
    const lowerAlias = alias.toLowerCase()
    if (!lowerAlias.includes(lowerQuery)) return
    const rank = rankSystemMatch(alias, query)
    if (
      !best ||
      rank.startsWith !== best.rank.startsWith ||
      rank.index !== best.rank.index ||
      rank.length !== best.rank.length
    ) {
      const isBetter =
        !best ||
        (rank.startsWith && !best.rank.startsWith) ||
        (rank.startsWith === best.rank.startsWith && rank.index < best.rank.index) ||
        (rank.startsWith === best.rank.startsWith &&
          rank.index === best.rank.index &&
          rank.length < best.rank.length)

      if (isBetter) {
        best = { alias, rank }
      }
    }
  })

  return best
}

export default function TacticalStarMap({
  systems,
  stargates,
  constellations,
  regions,
  pathRows,
  startSystem,
  endSystem,
  onSetStart,
  onSetEnd,
  onClearRoute,
}) {
  const containerRef = useRef(null)
  const searchRef = useRef(null)
  const canvasRef = useRef(null)
  const fitScaleRef = useRef(0.32)
  const dragRef = useRef(null)
  const animationFrameRef = useRef(null)
  const labelFadeFrameRef = useRef(null)
  const regionLabelFadeFrameRef = useRef(null)
  const viewRef = useRef({ zoom: 0.32, panX: 0, panY: 0 })
  const [size, setSize] = useState({ width: 0, height: 0 })
  const [view, setView] = useState({ zoom: 0.32, panX: 0, panY: 0 })
  const [selectedSystemId, setSelectedSystemId] = useState(null)
  const [locateQuery, setLocateQuery] = useState('')
  const [isLocateOpen, setIsLocateOpen] = useState(false)
  const [isViewAnimating, setIsViewAnimating] = useState(false)
  const [systemLabelAlpha, setSystemLabelAlpha] = useState(0)
  const [regionLabelAlpha, setRegionLabelAlpha] = useState(0)

  const model = useMemo(
    () => createMapModel(systems, stargates, constellations, regions),
    [systems, stargates, constellations, regions],
  )

  const systemAliasMap = useMemo(() => {
    const map = new Map()
    model.systems.forEach((item) => {
      getSystemAliases(item).forEach((alias) => {
        map.set(alias.toLowerCase(), item)
      })
    })
    return map
  }, [model.systems])

  const systemNameMap = useMemo(() => {
    return new Map(model.systems.map((item) => [item.zh_name, item]))
  }, [model.systems])

  const selectedSystem = useMemo(() => {
    if (!selectedSystemId) return null
    return model.systemMap.get(selectedSystemId) || null
  }, [model.systemMap, selectedSystemId])

  const startSystemRecord = useMemo(() => systemNameMap.get(startSystem) || null, [systemNameMap, startSystem])
  const endSystemRecord = useMemo(() => systemNameMap.get(endSystem) || null, [systemNameMap, endSystem])
  const directDistance = useMemo(
    () => getDirectDistanceInLightYears(startSystemRecord, endSystemRecord),
    [startSystemRecord, endSystemRecord],
  )
  const locateMatches = useMemo(() => {
    const query = locateQuery.trim()
    if (!query) return []

    return [...model.systems]
      .map((item) => {
        const bestMatch = getBestAliasMatch(item, query)
        if (!bestMatch) return null
        return {
          item,
          bestMatch,
        }
      })
      .filter(Boolean)
      .sort((left, right) => {
        const leftRank = left.bestMatch.rank
        const rightRank = right.bestMatch.rank
        if (leftRank.startsWith !== rightRank.startsWith) {
          return leftRank.startsWith ? -1 : 1
        }
        if (leftRank.index !== rightRank.index) {
          return leftRank.index - rightRank.index
        }
        if (leftRank.length !== rightRank.length) {
          return leftRank.length - rightRank.length
        }
        return left.item.zh_name.localeCompare(right.item.zh_name, 'zh-Hans-CN')
      })
      .map(({ item, bestMatch }) => ({
        ...item,
        matchedAlias: bestMatch.alias,
      }))
      .slice(0, 14)
  }, [locateQuery, model.systems])
  const startMarkerPoint = useMemo(() => getScreenPoint(startSystemRecord, view), [startSystemRecord, view])
  const endMarkerPoint = useMemo(() => getScreenPoint(endSystemRecord, view), [endSystemRecord, view])
  const selectedMarkerPoint = useMemo(() => getScreenPoint(selectedSystem, view), [selectedSystem, view])
  const hasPinnedRoute = Boolean(startSystemRecord || endSystemRecord)

  const pathSegments = useMemo(() => {
    return (pathRows || [])
      .map((item, index) => {
        const start = model.systemMap.get(item?.start?.system_id)
        const end = model.systemMap.get(item?.end?.system_id)
        if (!start || !end) return null
        return {
          key: `${item?.start?.system_id || 's'}-${item?.end?.system_id || 'e'}-${index}`,
          start,
          end,
          distance: Number(item?.distance || 0),
          moveType: item?.end?.move_type || item?.start?.move_type || '',
          routeKind: getRouteTypeKind(item?.end?.move_type || item?.start?.move_type || ''),
        }
      })
      .filter(Boolean)
  }, [model.systemMap, pathRows])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    return () => {
      if (labelFadeFrameRef.current) {
        window.cancelAnimationFrame(labelFadeFrameRef.current)
      }
      if (regionLabelFadeFrameRef.current) {
        window.cancelAnimationFrame(regionLabelFadeFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const handleOutsideClick = (event) => {
      if (!searchRef.current?.contains(event.target)) {
        setIsLocateOpen(false)
      }
    }

    window.addEventListener('mousedown', handleOutsideClick)
    return () => window.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  useEffect(() => {
    return () => {
      if (animationFrameRef.current) {
        window.cancelAnimationFrame(animationFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined

    const updateSize = () => {
      const currentNode = containerRef.current
      if (!currentNode || !currentNode.isConnected) return
      const rect = currentNode.getBoundingClientRect()
      const nextWidth = Math.max(0, Math.floor(rect.width))
      const nextHeight = Math.max(0, Math.floor(rect.height))
      setSize((current) => {
        if (current.width === nextWidth && current.height === nextHeight) {
          return current
        }
        return {
          width: nextWidth,
          height: nextHeight,
        }
      })
    }

    updateSize()
    const observer = new ResizeObserver(() => updateSize())
    observer.observe(node)
    return () => {
      dragRef.current = null
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!size.width || !size.height || !model.systems.length) return

    const fitScale = Math.min(
      (size.width - 40) / WORLD_WIDTH,
      (size.height - 40) / WORLD_HEIGHT,
    )
    fitScaleRef.current = fitScale

    setView((current) => {
      if (current.panX !== 0 || current.panY !== 0 || current.zoom !== 0.32) return current
      return {
        zoom: fitScale,
        panX: (size.width - WORLD_WIDTH * fitScale) / 2,
        panY: (size.height - WORLD_HEIGHT * fitScale) / 2,
      }
    })
  }, [size.width, size.height, model.systems.length])

  useEffect(() => {
    const shouldRevealLabels = !isViewAnimating && view.zoom > fitScaleRef.current * 6.8

    if (labelFadeFrameRef.current) {
      window.cancelAnimationFrame(labelFadeFrameRef.current)
      labelFadeFrameRef.current = null
    }

    if (!shouldRevealLabels) {
      setSystemLabelAlpha(0)
      return
    }

    const startAt = performance.now()
    const duration = 220

    const step = (timestamp) => {
      const progress = Math.min(1, (timestamp - startAt) / duration)
      setSystemLabelAlpha(easeOutCubic(progress))

      if (progress < 1) {
        labelFadeFrameRef.current = window.requestAnimationFrame(step)
      } else {
        labelFadeFrameRef.current = null
      }
    }

    labelFadeFrameRef.current = window.requestAnimationFrame(step)
  }, [isViewAnimating, view.zoom])

  useEffect(() => {
    if (regionLabelFadeFrameRef.current) {
      window.cancelAnimationFrame(regionLabelFadeFrameRef.current)
      regionLabelFadeFrameRef.current = null
    }

    if (isViewAnimating) {
      setRegionLabelAlpha(0)
      return
    }

    const startAt = performance.now()
    const duration = 220

    const step = (timestamp) => {
      const progress = Math.min(1, (timestamp - startAt) / duration)
      setRegionLabelAlpha(easeOutCubic(progress))

      if (progress < 1) {
        regionLabelFadeFrameRef.current = window.requestAnimationFrame(step)
      } else {
        regionLabelFadeFrameRef.current = null
      }
    }

    regionLabelFadeFrameRef.current = window.requestAnimationFrame(step)
  }, [isViewAnimating])

  const stopViewAnimation = () => {
    if (!animationFrameRef.current) return
    window.cancelAnimationFrame(animationFrameRef.current)
    animationFrameRef.current = null
    setIsViewAnimating(false)
  }

  const animateToView = (targetView, duration = 520) => {
    stopViewAnimation()
    setIsViewAnimating(true)
    const fromView = viewRef.current
    const startAt = performance.now()

    const step = (timestamp) => {
      const progress = Math.min(1, (timestamp - startAt) / duration)
      const eased = easeOutCubic(progress)

      setView({
        zoom: fromView.zoom + (targetView.zoom - fromView.zoom) * eased,
        panX: fromView.panX + (targetView.panX - fromView.panX) * eased,
        panY: fromView.panY + (targetView.panY - fromView.panY) * eased,
      })

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step)
      } else {
        animationFrameRef.current = null
        setIsViewAnimating(false)
      }
    }

    animationFrameRef.current = window.requestAnimationFrame(step)
  }

  useEffect(() => {
    if (!canvasRef.current || !size.width || !size.height) return

    const canvas = canvasRef.current
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(size.width * ratio)
    canvas.height = Math.floor(size.height * ratio)

    const ctx = canvas.getContext('2d')
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
    ctx.clearRect(0, 0, size.width, size.height)

    const gradient = ctx.createLinearGradient(0, 0, size.width, size.height)
    gradient.addColorStop(0, '#000000')
    gradient.addColorStop(1, '#000000')
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, size.width, size.height)

    ctx.save()
    ctx.translate(view.panX, view.panY)
    ctx.scale(view.zoom, view.zoom)

    if (view.zoom > fitScaleRef.current * 1.75) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.34)'
      ctx.lineWidth = 1.35 / view.zoom
      ctx.beginPath()
      model.stargates.forEach((item) => {
        ctx.moveTo(item.x1, item.y1)
        ctx.lineTo(item.x2, item.y2)
      })
      ctx.stroke()
    }

    if (pathSegments.length) {
      ctx.lineWidth = 2.4 / view.zoom
      pathSegments.forEach((segment) => {
        ctx.strokeStyle = getRouteStrokeColor(segment.routeKind)
        ctx.beginPath()
        ctx.moveTo(segment.start.px, segment.start.py)
        ctx.lineTo(segment.end.px, segment.end.py)
        ctx.stroke()
      })

      pathSegments.forEach((segment) => {
        if (segment.routeKind !== 'induction' && segment.routeKind !== 'unsafe-induction') return
        if (!Number.isFinite(segment.distance) || segment.distance <= 0) return

        const midX = (segment.start.px + segment.end.px) / 2
        const midY = (segment.start.py + segment.end.py) / 2
        const labelText = `${segment.distance.toFixed(2)} 光年`

        ctx.save()
        ctx.font = `600 ${11.5 / view.zoom}px "Segoe UI", sans-serif`
        ctx.textAlign = 'center'
        ctx.lineWidth = 4 / view.zoom
        ctx.strokeStyle = 'rgba(2, 6, 23, 0.94)'
        ctx.strokeText(labelText, midX, midY - 9 / view.zoom)
        ctx.fillStyle = getRouteStrokeColor(segment.routeKind)
        ctx.fillText(labelText, midX, midY - 9 / view.zoom)
        ctx.restore()
      })
    }

    const zoomFactor = view.zoom / fitScaleRef.current
    const coreRadius =
      zoomFactor < 1.8 ? 1.25 :
      zoomFactor < 4.6 ? 1.55 :
      1.95
    const haloRadius =
      zoomFactor < 2.8 ? 0 :
      zoomFactor < 6.5 ? 2.8 :
      3.4
    const effectiveHaloRadius = isViewAnimating ? 0 : haloRadius

    model.systems.forEach((item) => {
      const color = getSecurityColor(item.security_status)
      if (effectiveHaloRadius > 0) {
        ctx.globalAlpha = zoomFactor < 4.6 ? 0.12 : 0.18
        ctx.fillStyle = color
        ctx.beginPath()
        ctx.arc(item.px, item.py, effectiveHaloRadius / view.zoom, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(item.px, item.py, coreRadius / view.zoom, 0, Math.PI * 2)
      ctx.fill()
    })

    if (startSystemRecord && endSystemRecord && directDistance != null) {
      const midX = (startSystemRecord.px + endSystemRecord.px) / 2
      const midY = (startSystemRecord.py + endSystemRecord.py) / 2

      ctx.save()
      ctx.setLineDash([10 / view.zoom, 7 / view.zoom])
      ctx.strokeStyle = 'rgba(250, 204, 21, 0.92)'
      ctx.lineWidth = 2.4 / view.zoom
      ctx.beginPath()
      ctx.moveTo(startSystemRecord.px, startSystemRecord.py)
      ctx.lineTo(endSystemRecord.px, endSystemRecord.py)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.font = `600 ${13 / view.zoom}px "Segoe UI", sans-serif`
      ctx.textAlign = 'center'
      ctx.lineWidth = 4 / view.zoom
      ctx.strokeStyle = 'rgba(2, 6, 23, 0.94)'
      ctx.strokeText(`距离 ${directDistance.toFixed(2)} 光年`, midX, midY - 10 / view.zoom)
      ctx.fillStyle = 'rgba(250, 204, 21, 0.96)'
      ctx.fillText(`距离 ${directDistance.toFixed(2)} 光年`, midX, midY - 10 / view.zoom)
      ctx.restore()
    }

    if (!isViewAnimating && systemLabelAlpha > 0.01 && view.zoom > fitScaleRef.current * 6.8) {
      const left = (-view.panX) / view.zoom
      const top = (-view.panY) / view.zoom
      const right = left + size.width / view.zoom
      const bottom = top + size.height / view.zoom
      const visibleSystems = model.systems.filter(
        (item) => item.px >= left && item.px <= right && item.py >= top && item.py <= bottom,
      )
      const canRenderLabels = visibleSystems.length <= 72 || view.zoom > fitScaleRef.current * 10.2

      if (canRenderLabels) {
        ctx.save()
        ctx.globalAlpha = systemLabelAlpha
        ctx.fillStyle = 'rgba(226, 232, 240, 0.82)'
        ctx.font = `${13 / view.zoom}px "Segoe UI", sans-serif`
        const labelLift = ((1 - systemLabelAlpha) * 2.6) / view.zoom
        visibleSystems.forEach((item) => {
          const labelX = item.px + 6 / view.zoom
          const labelY = item.py - 4 / view.zoom - labelLift
          ctx.lineWidth = 3.6 / view.zoom
          ctx.strokeStyle = 'rgba(2, 6, 23, 0.94)'
          ctx.strokeText(item.zh_name, labelX, labelY)
          ctx.fillText(item.zh_name, labelX, labelY)
        })
        ctx.restore()
      }
    }

    ctx.restore()

    ctx.save()
    ctx.textAlign = 'center'
    if (!isViewAnimating && regionLabelAlpha > 0.01) {
      ctx.globalAlpha = regionLabelAlpha
      const regionLabelLift = (1 - regionLabelAlpha) * 4
      model.regions.forEach((item) => {
        const x = item.x * view.zoom + view.panX
        const y = item.y * view.zoom + view.panY - regionLabelLift
        if (x < -120 || x > size.width + 120 || y < -40 || y > size.height + 40) return
        ctx.fillStyle = 'rgba(248, 250, 252, 0.72)'
        ctx.shadowBlur = 10
        ctx.shadowColor = 'rgba(255, 255, 255, 0.08)'
        ctx.font = '600 15px "Segoe UI", sans-serif'
        ctx.fillText(item.label, x, y)
      })
    }
    ctx.restore()
  }, [isViewAnimating, model, pathSegments, regionLabelAlpha, selectedSystem, size.height, size.width, startSystemRecord, endSystemRecord, systemLabelAlpha, view])

  const centerOnSystem = (system) => {
    if (!system || !size.width || !size.height) return

    const targetZoom = clamp(LOCATE_ZOOM, fitScaleRef.current, fitScaleRef.current * 28)
    const nextView = {
      zoom: targetZoom,
      panX: size.width / 2 - system.px * targetZoom,
      panY: size.height / 2 - system.py * targetZoom,
    }
    animateToView(nextView, 860)
    setSelectedSystemId(system.system_id)
  }

  const handleLocate = (systemOverride = null) => {
    const exactQuery = locateQuery.trim().toLowerCase()
    const target = systemOverride || systemAliasMap.get(exactQuery) || locateMatches[0]
    if (!target) return
    setLocateQuery(target.zh_name)
    setIsLocateOpen(false)
    centerOnSystem(target)
  }

  const resetView = () => {
    if (!size.width || !size.height) return
    const fitScale = fitScaleRef.current
    animateToView({
      zoom: fitScale,
      panX: (size.width - WORLD_WIDTH * fitScale) / 2,
      panY: (size.height - WORLD_HEIGHT * fitScale) / 2,
    }, 760)
  }

  const clearPinnedRoute = () => {
    if (onClearRoute) {
      onClearRoute()
      return
    }
    onSetStart('')
    onSetEnd('')
  }

  const handlePointerDown = (event) => {
    stopViewAnimation()
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: view.panX,
      panY: view.panY,
      moved: false,
    }
  }

  const handlePointerMove = (event) => {
    const dragState = dragRef.current
    if (!dragState) return
    if (event.buttons === 0) {
      dragRef.current = null
      return
    }
    const deltaX = event.clientX - dragState.x
    const deltaY = event.clientY - dragState.y
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      dragState.moved = true
    }
    setView((current) => ({
      ...current,
      panX: dragState.panX + deltaX,
      panY: dragState.panY + deltaY,
    }))
  }

  const handlePointerUp = (event) => {
    if (!dragRef.current) return
    const dragState = dragRef.current
    dragRef.current = null

    if (dragState.moved) return
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return

    const nearest = findNearestSystem(
      model.systems,
      event.clientX - rect.left,
      event.clientY - rect.top,
      viewRef.current,
    )

    if (!nearest) return
    setSelectedSystemId(nearest.system_id)
  }

  useEffect(() => {
    const node = containerRef.current
    if (!node) return undefined
    const wheelOptions = { passive: false }

    const handleWheel = (event) => {
      const currentNode = containerRef.current
      if (!currentNode || !currentNode.isConnected) return
      if (event.cancelable) {
        event.preventDefault()
      }
      stopViewAnimation()
      const rect = currentNode.getBoundingClientRect()
      const { zoom, panX, panY } = viewRef.current
      const pointerX = event.clientX - rect.left
      const pointerY = event.clientY - rect.top
      const zoomFactor = event.deltaY < 0 ? 1.08 : 0.92
      const nextZoom = clamp(zoom * zoomFactor, fitScaleRef.current, fitScaleRef.current * 28)
      const worldX = (pointerX - panX) / zoom
      const worldY = (pointerY - panY) / zoom

      setView({
        zoom: nextZoom,
        panX: pointerX - worldX * nextZoom,
        panY: pointerY - worldY * nextZoom,
      })
    }

    node.addEventListener('wheel', handleWheel, wheelOptions)
    return () => node.removeEventListener('wheel', handleWheel, wheelOptions)
  }, [])

  return (
    <div className="tactical-map-shell">
      <div className="tactical-map-toolbar">
        <div className="tactical-map-search" ref={searchRef}>
          <div className="tactical-map-search-shell">
            <input
              className="text-input tactical-map-search-input"
              aria-label="搜索并定位星系"
              value={locateQuery}
              onFocus={() => setIsLocateOpen(Boolean(locateMatches.length))}
              onChange={(event) => {
                const nextValue = event.target.value
                setLocateQuery(nextValue)
                setIsLocateOpen(Boolean(nextValue.trim()))
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  handleLocate()
                }
                if (event.key === 'Escape') {
                  setIsLocateOpen(false)
                }
              }}
              placeholder="搜索并定位星系"
            />
            {isLocateOpen && locateMatches.length ? (
              <div className="tactical-search-dropdown">
                {locateMatches.map((item) => (
                  <button
                    key={item.system_id}
                    type="button"
                    className="tactical-search-option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => handleLocate(item)}
                  >
                    <span className="tactical-search-option-copy">
                      <strong>{item.zh_name}</strong>
                      {item.matchedAlias && item.matchedAlias !== item.zh_name ? (
                        <em>{item.matchedAlias}</em>
                      ) : null}
                    </span>
                    <span
                      className="tactical-search-security"
                      style={{ color: getSecurityColor(item.security_status) }}
                    >
                      {item.securityLabel}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className="ghost-btn tactical-locate-btn" onClick={() => handleLocate()}>
            <LocateFixed size={14} />
            定位
          </button>
        </div>

        <div className="pill-row">
          <button
            type="button"
            className="ghost-btn danger-ghost-btn"
            onClick={clearPinnedRoute}
            disabled={!hasPinnedRoute}
          >
            <X size={14} />
            清除起终点
          </button>
          <button type="button" className="ghost-btn" onClick={resetView}>
            <RefreshCw size={14} />
            重置视图
          </button>
        </div>

      </div>

      <div
        ref={containerRef}
        className="tactical-map-viewport"
        onMouseDown={handlePointerDown}
        onMouseMove={handlePointerMove}
        onMouseUp={handlePointerUp}
        onMouseLeave={() => {
          dragRef.current = null
        }}
      >
        <canvas ref={canvasRef} className="tactical-map-canvas" />
        <div className="tactical-marker-layer" aria-hidden="true">
          {selectedMarkerPoint &&
          selectedSystemId !== startSystemRecord?.system_id &&
          selectedSystemId !== endSystemRecord?.system_id ? (
            <div
              className="tactical-system-marker is-selected"
              style={{ left: `${selectedMarkerPoint.x}px`, top: `${selectedMarkerPoint.y}px` }}
            >
              <span className="tactical-system-marker-ring" />
              <span className="tactical-system-marker-core" />
              <span className="tactical-system-marker-label">已选</span>
            </div>
          ) : null}
          {startMarkerPoint ? (
            <div
              className="tactical-system-marker is-start"
              style={{ left: `${startMarkerPoint.x}px`, top: `${startMarkerPoint.y}px` }}
            >
              <span className="tactical-system-marker-ring" />
              <span className="tactical-system-marker-core" />
              <span className="tactical-system-marker-label">起点</span>
            </div>
          ) : null}
          {endMarkerPoint ? (
            <div
              className="tactical-system-marker is-end"
              style={{ left: `${endMarkerPoint.x}px`, top: `${endMarkerPoint.y}px` }}
            >
              <span className="tactical-system-marker-ring" />
              <span className="tactical-system-marker-core" />
              <span className="tactical-system-marker-label">终点</span>
            </div>
          ) : null}
        </div>

        <div className="tactical-map-overlay">
          <div className="tactical-map-hud">
            <span>星系 {model.systems.length}</span>
            <span>星门 {model.stargates.length}</span>
            <span>缩放 {view.zoom.toFixed(2)}x</span>
            {directDistance != null ? <span>直线 {directDistance.toFixed(2)} 光年</span> : null}
          </div>

          <div className="tactical-system-card">
            {selectedSystem ? (
              <>
                <div className="tactical-system-head">
                  <strong>{selectedSystem.zh_name}</strong>
                  <span style={{ color: getSecurityColor(selectedSystem.security_status) }}>
                    安等 {selectedSystem.securityLabel}
                  </span>
                </div>
                <p>系统 ID: {selectedSystem.system_id}</p>
                <div className="pill-row">
                  <button type="button" className="ghost-btn" onClick={() => onSetStart(selectedSystem.zh_name)}>
                    设为起点
                  </button>
                  <button type="button" className="ghost-btn" onClick={() => onSetEnd(selectedSystem.zh_name)}>
                    设为终点
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="tactical-system-head">
                  <strong>交互星图</strong>
                  <span>点击星系查看详情</span>
                </div>
                <p>缩放到中近景时会显示星门网络，计算出的跳跃路径会直接高亮在图中</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}


