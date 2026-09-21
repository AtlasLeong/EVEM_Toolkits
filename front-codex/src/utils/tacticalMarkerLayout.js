const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const overlapArea = (a, b) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

// Keep count badges beside their actual star, not in a fixed three-row slot.
// Eight nearby placements avoid neighboring groups without unbounded repulsion
// that would visually detach a deployment from its system. Zoom/list handles
// inherently over-dense maps; coordinates themselves are never moved.
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
    const width = 104 * unitScale;
    const rowHeight = 26 * unitScale;
    const rowGap = 4 * unitScale;
    const rows = group.visible.length + (group.hiddenCount ? 1 : 0);
    if (!rows) continue;
    const height = rows * rowHeight + (rows - 1) * rowGap;
    const gap = 10 * unitScale;
    const above = node.py - gap - height;
    const below = node.py + 32 * unitScale;
    const left = node.px - gap - width;
    const right = node.px + gap;
    const positions = [
      [node.px - width / 2, above],
      [right, above], [left, above],
      [right, node.py - height / 2], [left, node.py - height / 2],
      [node.px - width / 2, below], [right, below], [left, below],
    ];
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
      const blocked = [...obstacles, ...placed].reduce((sum, obstacle) => sum + overlapArea(rect, {
        x: obstacle.x - 3 * unitScale, y: obstacle.y - 3 * unitScale,
        width: obstacle.width + 6 * unitScale, height: obstacle.height + 6 * unitScale,
      }), 0);
      return { ...rect, score: blocked * 100 + index };
    });
    const { x, y } = candidates.sort((a, b) => a.score - b.score)[0];
    placed.push({
      ...group, node, x, y, width, rowHeight, rowGap, rows, height,
      leader: {
        from: { x: clamp(node.px, x, x + width), y: clamp(node.py, y, y + height) },
        to: { x: node.px, y: node.py },
      },
    });
  }
  return placed;
}
