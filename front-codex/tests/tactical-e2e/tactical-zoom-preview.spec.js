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
