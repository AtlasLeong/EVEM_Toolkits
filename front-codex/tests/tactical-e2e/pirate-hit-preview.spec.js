import { test, expect } from '@playwright/test'

async function screenStars(page) {
  return page.locator('.pirate-map__stars circle').evaluateAll(nodes => nodes.map((node, index) => {
    const box = node.getBoundingClientRect()
    return { index, x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }))
}

for (const selection of ['', '?selected']) test(`a drawn star outside keyboard sampling opens its own report ${selection || 'without selection'}`, async ({ page }) => {
  await page.goto(`/tests/tactical-e2e/pirate-hit-preview-harness.html${selection}`)
  await expect(page.locator('.pirate-map__stars circle')).toHaveCount(201)
  const stars = await screenStars(page)
  const sampled = await page.locator('[data-pirate-system]').evaluateAll(nodes => nodes.map(node => Number(node.dataset.pirateSystem)))
  const target = stars.find(star => !sampled.includes(star.index + 1) && star.x > 370 && star.y > 230 && star.y < 700)
  expect(target).toBeTruthy()
  await page.mouse.click(target.x, target.y)
  await expect(page.getByTestId('selected-system')).toHaveText(String(target.index + 1))
})

test('coincident stars require an explicit named choice and dragging does not report', async ({ page }, testInfo) => {
  await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html?overlap')
  await expect(page.locator('.pirate-map__stars circle')).toHaveCount(201)
  const star = (await screenStars(page))[10]
  await page.mouse.move(star.x, star.y)
  await page.mouse.down()
  await page.mouse.move(star.x + 50, star.y + 30, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByTestId('selected-system')).toBeEmpty()
  await page.getByRole('button', { name: '重置星图视角' }).click()
  const resetStar = (await screenStars(page))[10]
  await page.mouse.click(resetStar.x, resetStar.y)
  const picker = page.getByRole('group', { name: '选择上报星系' })
  await expect(picker).toBeVisible()
  await expect(page.getByTestId('selected-system')).toBeEmpty()
  await page.screenshot({ path: testInfo.outputPath('ambiguous-system-picker.png') })
  await picker.getByRole('button', { name: /System 12/ }).click()
  await expect(page.getByTestId('selected-system')).toHaveText('12')
})

test('continuous zoom out replenishes stars before wheel idle', async ({ page }, testInfo) => {
  await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html?dense')
  await expect(page.locator('.pirate-map__stars circle')).toHaveCount(5000)
  const svg = page.locator('.pirate-map__svg')
  const box = await svg.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await svg.evaluate(async node => {
    const box = node.getBoundingClientRect()
    for (let i = 0; i < 24; i += 1) {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true,
        clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }))
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
    }
  })
  await expect(page.locator('.pirate-map')).not.toHaveClass(/wheel-motion/)
  const initial = await page.locator('.pirate-map__stars circle').count()
  expect(initial).toBeLessThan(1500)
  // A 100ms cadence is deliberately below the 220ms idle commit. The visible
  // topology must replenish during the burst, not only after its final event.
  const during = await svg.evaluate(async node => {
    const box = node.getBoundingClientRect()
    let count = 0
    for (let i = 0; i < 18; i += 1) {
      node.dispatchEvent(new WheelEvent('wheel', { deltaY: 200, bubbles: true, cancelable: true,
        clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 }))
      await new Promise(resolve => setTimeout(resolve, 100))
      count = node.querySelectorAll('.pirate-map__stars circle').length
    }
    return { count, previewing: node.parentElement.classList.contains('pirate-map--wheel-motion') }
  })
  expect(during.previewing).toBe(true)
  expect(during.count).toBeGreaterThan(initial * 2)
  await testInfo.attach('live-topology-counts', { body: JSON.stringify({ initial, during }), contentType: 'application/json' })
})

test('system search focus centers the star without selecting it for a report', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-hit-preview-harness.html')
  await expect(page.locator('.pirate-map__stars circle')).toHaveCount(201)
  const before = await page.locator('.pirate-map__world').getAttribute('transform')
  await page.getByRole('button', { name: '定位 11', exact: true }).click()
  await expect(page.locator('.pirate-map__world')).not.toHaveAttribute('transform', before)
  await expect(page.getByTestId('selected-system')).toBeEmpty()
})
