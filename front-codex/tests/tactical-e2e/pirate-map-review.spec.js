import { test, expect } from '@playwright/test'

for (const boundary of [{ name: 'maximum', button: '放大星图', clicks: 13, scale: 16, direction: -1 },
  { name: 'minimum', button: '缩小星图', clicks: 4, scale: .5, direction: 1 }]) {
  test(`pirate wheel reverses immediately at the ${boundary.name} zoom boundary`, async ({ page }) => {
    await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html')
    for (let i = 0; i < boundary.clicks; i += 1) await page.getByRole('button', { name: boundary.button, exact: true }).click()
    await page.locator('.pirate-map__svg').evaluate((node, direction) => {
      const box = node.getBoundingClientRect()
      for (const delta of [120 * direction, -120 * direction]) node.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, deltaY: delta, clientX: box.x + 500, clientY: box.y + 400,
      }))
    }, boundary.direction)
    await expect.poll(() => page.locator('.pirate-map__world').evaluate(node =>
      Number(node.getAttribute('transform').match(/scale\(([-\d.e]+)\)/)[1])))
      .toBeCloseTo(boundary.scale * Math.exp(.12 * boundary.direction), 6)
  })
}

test('multiple native wheel events in one frame use the same capped delta as the war board', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html')
  const svg = page.locator('.pirate-map__svg')
  await expect(svg).toBeVisible()
  await svg.evaluate(node => {
    const box = node.getBoundingClientRect()
    for (let i = 0; i < 5; i += 1) node.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true, deltaY: -1200, clientX: box.x + 500, clientY: box.y + 400,
    }))
  })
  await expect.poll(() => page.locator('.pirate-map__world').evaluate(node =>
    Number(node.getAttribute('transform').match(/scale\(([-\d.e]+)\)/)[1]))).toBeCloseTo(Math.exp(.12), 6)
})

test('pirate card center and tether preserve screen offsets from its star during active wheel preview', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html?card')
  const card = page.locator('[data-pirate-card="system:111"]')
  await expect(card).toBeVisible()
  const readGeometry = async () => page.locator('.pirate-map').evaluate(map => {
    const card = map.querySelector('[data-pirate-card="system:111"]').getBoundingClientRect()
    const marker = map.querySelector('[data-pirate-marker="system:111"] .pirate-map__marker-shape').getBoundingClientRect()
    const label = [...map.querySelectorAll('.tac-star-name')].find(node => node.textContent === 'System 111').getBoundingClientRect()
    const tether = map.querySelector('.pirate-map__card-tether')
    const end = new DOMPoint(Number(tether.getAttribute('x2')), Number(tether.getAttribute('y2'))).matrixTransform(tether.getScreenCTM())
    const anchor = { x: marker.x + marker.width / 2, y: marker.y + marker.height / 2 }
    return { width: card.width, offsetX: card.x + card.width / 2 - anchor.x,
      offsetY: card.y + card.height / 2 - anchor.y,
      labelOffsetX: label.x + label.width / 2 - anchor.x,
      labelOffsetY: label.y + label.height / 2 - anchor.y,
      tetherError: Math.hypot(end.x - Math.max(card.left, Math.min(card.right, anchor.x)),
        end.y - Math.max(card.top, Math.min(card.bottom, anchor.y))),
      previewing: map.classList.contains('pirate-map--wheel-motion') }
  })
  const before = await readGeometry()
  const svg = page.locator('.pirate-map__svg')
  const box = await svg.boundingBox()
  await svg.dispatchEvent('wheel', { deltaY: -120, deltaMode: 0, clientX: box.x + 600, clientY: box.y + 350 })
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = await readGeometry()
  expect(preview.previewing).toBe(true)
  expect(preview.width).toBeCloseTo(before.width, 1)
  expect(preview.offsetX).toBeCloseTo(before.offsetX, 1)
  expect(preview.offsetY).toBeCloseTo(before.offsetY, 1)
  expect(preview.tetherError).toBeLessThan(1)
  expect(preview.labelOffsetX).toBeCloseTo(before.labelOffsetX, 1)
  expect(preview.labelOffsetY).toBeCloseTo(before.labelOffsetY, 1)
})
