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
  expect(Number(preview.gate) * preview.scale).toBeCloseTo(Number(before.gate) * before.scale, 5)
})
