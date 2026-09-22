const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
    Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** Approximate a marker's rendered width without requiring a DOM canvas. */
export function markerWidth(label = "", options = {}) {
  const config = typeof options === "number" ? { unitScale: options } : options;
  const min = Number.isFinite(Number(config.min)) ? Number(config.min) : 76;
  const max = Number.isFinite(Number(config.max)) ? Number(config.max) : 180;
  const charWidth = Number.isFinite(Number(config.charWidth)) ? Number(config.charWidth) : 8.5;
  const padding = Number.isFinite(Number(config.padding)) ? Number(config.padding) : 18;
  const unitScale = Number.isFinite(Number(config.unitScale)) ? Number(config.unitScale) : 1;
  const text = String(label ?? "");
  const units = [...text].reduce((sum, character) => sum + (character.charCodeAt(0) > 0xff ? 1 : 0.6), 0);
  return clamp(Math.ceil((padding + units * charWidth) * unitScale), min * unitScale, max * unitScale);
}

// Keep count badges beside their actual star, not in a fixed three-row slot.
// Search a fixed set of nearby callouts, never an unbounded repulsion loop.
// Existing labels take precedence over the softer star-name reservation area:
// readable deployments should not overlap just to keep an empty name slot clear.
// Zoom/list handles inherently over-dense maps; coordinates are never moved.
export function layoutForceMarkers(groups, nodes, unitScale = 1, {
  width: viewportWidth = 1000,
  height: viewportHeight = 570,
  padding = { left: 12, right: 12, top: 65, bottom: 30 },
} = {}) {
  const { left: paddingLeft = 12, right: paddingRight = 12, top: paddingTop = 65, bottom: paddingBottom = 30 } = padding;
  const byId = new Map(nodes.map((node) => [Number(node.system_id), node]));
  const placed = [];
  for (const group of groups) {
    const node = byId.get(group.system_id);
    if (!node) continue;
    if (node.px < 0 || node.px > viewportWidth || node.py < 0 || node.py > viewportHeight) continue;
    const requestedWidth = Number(group.markerWidth);
    const width = Math.min((Number.isFinite(requestedWidth) ? clamp(requestedWidth, 76, 220) : 104) * unitScale, Math.max(1,viewportWidth-paddingLeft-paddingRight));
    const rowWidths = group.visible.map(item => Math.min(width, Number(item.markerWidth) > 0 ? item.markerWidth * unitScale : width));
    const rowOffsets = rowWidths.map(rowWidth => (width - rowWidth) / 2);
    const overflowWidth = Math.min(width, Number(group.overflowWidth) > 0 ? group.overflowWidth * unitScale : width);
    const overflowOffset = (width - overflowWidth) / 2;
    const rowHeight = (group.rowHeight || 26) * unitScale;
    const rowGap = 4 * unitScale;
    const rows = group.visible.length + (group.hiddenCount ? 1 : 0);
    if (!rows) continue;
    const height = rows * rowHeight + (rows - 1) * rowGap;
    const gap = 10 * unitScale;
    const positions = [];
    for (const extra of [0, 32, 64, 96]) {
      const offset = extra * unitScale;
      const above = node.py - gap - height - offset;
      const below = node.py + 32 * unitScale + offset;
      const left = node.px - gap - width - offset;
      const right = node.px + gap + offset;
      positions.push(
        [node.px - width / 2, above],
        [right, above], [left, above],
        [right, node.py - height / 2], [left, node.py - height / 2],
        [node.px - width / 2, below], [right, below], [left, below],
      );
    }
    const obstacles = nodes.filter((other) => other !== node).map((other) => ({
      x: other.px - 20 * unitScale, y: other.py - 9 * unitScale,
      width: 40 * unitScale, height: 36 * unitScale,
    }));
    const candidates = positions.map(([x, y], index) => {
      const rect = {
        x: clamp(x, paddingLeft, viewportWidth - paddingRight - width),
        y: clamp(y, paddingTop, viewportHeight - paddingBottom - height),
        width,
        height,
      };
      const blockedBy = items => items.reduce((sum, obstacle) => sum + overlapArea(rect, {
        x: obstacle.x - 3 * unitScale, y: obstacle.y - 3 * unitScale,
        width: obstacle.width + 6 * unitScale, height: obstacle.height + 6 * unitScale,
      }), 0);
      return { ...rect, labelOverlap: blockedBy(placed), score: blockedBy(obstacles) * 100 + index };
    });
    const { x, y } = candidates.sort((a, b) => a.labelOverlap - b.labelOverlap || a.score - b.score)[0];
    placed.push({
      ...group, node, x, y, width, rowWidths, rowOffsets, overflowWidth, overflowOffset, rowHeight, rowGap, rows, height,
      leader: {
        from: { x: clamp(node.px, x, x + width), y: clamp(node.py, y, y + height) },
        to: { x: node.px, y: node.py },
      },
    });
  }
  return placed;
}
