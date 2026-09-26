/** Static world-space buckets; pointer selection never depends on label/DOM LOD. */
export function indexPirateSystems(systems, cellSize = 64) {
  const cells = new Map()
  for (const node of systems) {
    if (!Number.isFinite(node.px) || !Number.isFinite(node.py)) continue
    const key = `${Math.floor(node.px / cellSize)}:${Math.floor(node.py / cellSize)}`
    const bucket = cells.get(key) || []
    bucket.push(node)
    cells.set(key, bucket)
  }
  return { cells, cellSize }
}

/** Close/tied candidates require a named choice instead of DOM paint-order selection. */
export function pickPirateSystems(index, point, camera, radius = 22) {
  const scale = Math.max(.0001, camera.scale)
  const x = (point.x - camera.x) / scale, y = (point.y - camera.y) / scale
  const reach = radius / scale
  const found = []
  for (let column = Math.floor((x - reach) / index.cellSize); column <= Math.floor((x + reach) / index.cellSize); column += 1) {
    for (let row = Math.floor((y - reach) / index.cellSize); row <= Math.floor((y + reach) / index.cellSize); row += 1) {
      for (const node of index.cells.get(`${column}:${row}`) || []) {
        const distance = Math.hypot(node.px - x, node.py - y) * scale
        if (distance <= radius) found.push({ node, distance })
      }
    }
  }
  found.sort((a, b) => a.distance - b.distance || Number(a.node.system_id) - Number(b.node.system_id))
  if (!found.length) return []
  // Four screen pixels is intentionally independent of zoom and of hit order.
  return found.length === 1 || found[1].distance - found[0].distance > 4
    ? [found[0].node] : found.map(value => value.node)
}
