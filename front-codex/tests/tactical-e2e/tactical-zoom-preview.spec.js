import { test, expect } from '@playwright/test'

test('wheel preview keeps fixed-size hit rings synchronized before React settles', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/marker-render-harness.html')
  await expect(page.locator('.pirate-map__svg')).toBeVisible()
  await page.evaluate(() => window.__pirateSetSelectedKey('target:1'))
  const halo = page.locator('[data-pirate-marker="system:2"] .pirate-map__marker-halo')
  await expect(halo).toBeVisible()
  const before = await halo.boundingBox()
  await page.locator('.pirate-map__svg').dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, clientX: 600, clientY: 350 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())))
  const preview = await halo.boundingBox()
  expect(preview).not.toBeNull()
  expect(Math.abs(preview.width - before.width)).toBeLessThanOrEqual(1)
})

test('pirate wheel preview survives a target snapshot rerender', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/marker-render-harness.html')
  await expect(page.locator('.pirate-map__svg')).toBeVisible()
  await page.evaluate(() => window.__pirateSetSelectedKey('target:1'))
  const world = page.locator('.pirate-map__world')
  const before = await world.getAttribute('transform')
  await page.locator('.pirate-map__svg').dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, clientX: 600, clientY: 350 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = await world.getAttribute('transform')
  expect(preview).not.toBe(before)
  await page.evaluate(() => window.__pirateTriggerRerender())
  await expect(page.locator('[data-harness-revision="1"]')).toHaveCount(1)
  expect(await world.getAttribute('transform')).toBe(preview)
  const existingHalo = await page.locator('[data-pirate-marker="system:2"] .pirate-map__marker-halo').boundingBox()
  const incomingHalo = await page.locator('[data-pirate-marker="system:101"] .pirate-map__marker-halo').boundingBox()
  expect(incomingHalo).not.toBeNull()
  // Fractional SVG transforms can round a newly inserted marker by a pixel;
  // the invariant is that it stays within the fixed-size halo tolerance.
  expect(Math.abs(incomingHalo.width - existingHalo.width)).toBeLessThanOrEqual(2)
})

test('war board keeps the selected star ring and gate stroke stable during preview', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/collaboration-zoom-harness.html')
  const map = page.getByRole('group', { name: '局部作战星图' })
  await expect(map).toBeVisible()
  const ring = page.locator('.tac-star-ring')
  await expect(ring).toHaveCount(1)
  const gate = page.locator('.tac-map-gate').first()
  const camera = map.locator('.tac-map-world-layer')
  const readScale = async () => Number((await camera.getAttribute('transform')).match(/scale\(([-\d.e]+)\)/)[1])
  const before = { ring: await ring.boundingBox(), gate: await gate.getAttribute('stroke-width'), scale: await readScale() }
  await map.dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, clientX: 600, clientY: 350 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = { ring: await ring.boundingBox(), gate: await gate.getAttribute('stroke-width'), scale: await readScale() }
  expect(preview.ring).not.toBeNull()
  expect(Math.abs(preview.ring.width - before.ring.width)).toBeLessThanOrEqual(1)
  expect(Number(preview.gate)).toBeCloseTo(Number(before.gate), 5)
  await expect(gate).toHaveAttribute('vector-effect', 'non-scaling-stroke')
})

test('focused war-board system keeps the invisible hit circle from becoming a halo', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/collaboration-zoom-harness.html?focus=1')
  await page.waitForFunction(() => window.__collabFocusStylesReady === true)
  const system = page.locator('[data-system-id="1"]')
  const hit = system.locator('[data-fixed-kind="hit"]')
  await system.press('Enter')
  const metrics = await hit.evaluate(node => {
    const style = getComputedStyle(node)
    return {
      focusVisible: node.parentElement?.matches(':focus-visible') ?? false,
      stroke: style.stroke,
      strokeWidth: Number.parseFloat(style.strokeWidth),
    }
  })
  expect(metrics.focusVisible).toBe(true)
  expect(metrics.stroke).toMatch(/transparent|rgba\(0, 0, 0, 0\)/)
  expect(metrics.strokeWidth).toBeLessThanOrEqual(0.5)
})

test('focused war-board selection ring keeps a hairline stroke at high zoom', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/collaboration-zoom-harness.html?focus=1')
  await page.waitForFunction(() => window.__collabFocusStylesReady === true)
  const map = page.getByRole('group', { name: '局部作战星图' })
  for (let index = 0; index < 7; index += 1) {
    await page.getByRole('button', { name: '放大地图' }).click()
  }
  const system = map.locator('[data-system-id="1"]')
  await system.press('Enter')
  const metrics = await system.locator('.tac-star-ring').evaluate(node => {
    const world = node.closest('.tac-map-world-layer')
    const scale = Number(world.getAttribute('transform').match(/scale\(([-\d.e]+)\)/)[1])
    return { scale, screenStroke: Number.parseFloat(getComputedStyle(node).strokeWidth) * scale }
  })
  expect(metrics.scale).toBeGreaterThan(2)
  expect(metrics.screenStroke).toBeLessThanOrEqual(1.5)
})

test('war board bounds dense topology and preserves the selected system while zooming', async ({ page }) => {
  // This 900-card correctness stress case performs six settled layouts. The
  // pre-change baseline also takes ~41s locally; keep every assertion intact.
  test.setTimeout(60000)
  await page.goto('/tests/tactical-e2e/collaboration-zoom-harness.html?dense=1&intel=1')
  const map = page.getByRole('group', { name: '局部作战星图' })
  await expect(map).toBeVisible()
  await expect(map.locator('[data-system-id]')).toHaveCount(900)

  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: '放大地图' }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }

  const visibleCount = await map.locator('[data-system-id]').count()
  expect(visibleCount).toBeGreaterThan(0)
  expect(visibleCount).toBeLessThan(900)
  await expect(map.locator('[data-system-id="1"]')).toHaveCount(1)
})

test('war board wheel preview survives a systems snapshot rerender', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/collaboration-zoom-harness.html')
  const map = page.getByRole('group', { name: '局部作战星图' })
  await expect(map).toBeVisible()
  const world = map.locator('.tac-map-world-layer')
  await map.dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, clientX: 600, clientY: 350 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = await world.getAttribute('transform')
  expect(preview).not.toBe('translate(0 0) scale(1)')
  await page.evaluate(() => window.__collabTriggerRerender())
  await expect(page.locator('[data-harness-revision="1"]')).toHaveCount(1)
  expect(await world.getAttribute('transform')).toBe(preview)
  const existingDot = await map.locator('[data-system-id="2"] [data-fixed-kind="dot"]').boundingBox()
  const incomingDot = await map.locator('[data-system-id="4"] [data-fixed-kind="dot"]').boundingBox()
  expect(incomingDot).not.toBeNull()
  expect(Math.abs(incomingDot.width - existingDot.width)).toBeLessThanOrEqual(1)
})
