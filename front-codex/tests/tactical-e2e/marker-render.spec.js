import { test, expect } from '@playwright/test'

test('map pan skips marker reconciliation while zoom and selection still update markers', async ({ page }) => {
  await page.addInitScript(() => {
    const commits = []
    let previousMarkers = new Map()
    let nextRenderer = 1
    window.__pirateMarkerCommits = commits
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true,
      renderers: new Map(),
      inject(renderer) { const id = nextRenderer++; this.renderers.set(id, renderer); return id },
      onCommitFiberRoot(_id, root) {
        let total = 0, reconciled = 0
        const currentMarkers = new Map()
        const visit = fiber => {
          if (!fiber) return
          // The component name is rewritten by Vite fast-refresh; identify its keyed marker props.
          if (fiber.key && fiber.pendingProps?.marker?.key === fiber.key) {
            total += 1
            currentMarkers.set(fiber.key, fiber)
            if (previousMarkers.has(fiber.key) && previousMarkers.get(fiber.key) !== fiber) reconciled += 1
          }
          visit(fiber.child)
          visit(fiber.sibling)
        }
        visit(root.current)
        previousMarkers = currentMarkers
        commits.push({ total, reconciled })
      },
      onCommitFiberUnmount() {},
    }
  })
  await page.goto('/tests/tactical-e2e/marker-render-harness.html')
  await expect(page.locator('[data-pirate-marker]')).toHaveCount(100)
  const mounted = await page.evaluate(() => window.__pirateMarkerCommits.some(commit => commit.total === 100))
  expect(mounted).toBe(true)

  const beforePan = await page.evaluate(() => window.__pirateMarkerCommits.length)
  await page.locator('.pirate-map__svg').evaluate(svg => {
    const event = (type, clientX) => svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 7, button: 0, clientX, clientY: 300,
    }))
    event('pointerdown', 400)
    event('pointermove', 430)
    event('pointerup', 430)
  })
  await expect(page.locator('.pirate-map__world')).toHaveAttribute('transform', /translate\(30 0\)/)
  const panReconciled = await page.evaluate(start => window.__pirateMarkerCommits.slice(start)
    .reduce((sum, commit) => sum + commit.reconciled, 0), beforePan)
  expect(panReconciled).toBe(0)

  const beforeZoom = await page.evaluate(() => window.__pirateMarkerCommits.length)
  await page.getByRole('button', { name: '放大星图' }).click()
  await expect(page.locator('.pirate-map__world')).toHaveAttribute('transform', /scale\(1\.35\)/)
  const zoomReconciled = await page.evaluate(start => window.__pirateMarkerCommits.slice(start)
    .reduce((sum, commit) => sum + commit.reconciled, 0), beforeZoom)
  expect(zoomReconciled).toBeGreaterThan(0)

  await page.evaluate(() => window.__pirateSetSelectedKey('target:99'))
  await expect(page.locator('[data-pirate-marker="system:100"]')).toHaveClass(/pirate-map__marker--selected/)
  await page.locator('[data-pirate-marker="system:1"]').dispatchEvent('click')
  await expect(page.locator('[data-pirate-marker="system:1"]')).toHaveClass(/pirate-map__marker--selected/)
})

test('selected pirate system uses a compact visual ring without exposing its hit area', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/marker-render-harness.html')
  const hit = page.locator('[data-pirate-system="1"]')
  await expect(hit).toBeVisible()
  // Target cards intentionally sit above the hit area in this dense harness;
  // dispatch the same click handler without relying on z-index hit testing.
  await hit.dispatchEvent('click')
  const ring = page.locator('.pirate-map__system-selection-ring')
  await expect(ring).toHaveCount(1)
  const metrics = await ring.evaluate(node => {
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return { width: rect.width, height: rect.height, strokeWidth: parseFloat(style.strokeWidth) }
  })
  expect(metrics.width).toBeLessThanOrEqual(28)
  expect(metrics.height).toBeLessThanOrEqual(28)
  expect(metrics.strokeWidth).toBeLessThanOrEqual(1.5)
  await expect(hit).toHaveAttribute('fill', 'transparent')
})
