import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js'
import { installApiMock, json } from '../e2e/helpers/api.js'

async function openPirateBoard(page) {
  await page.setViewportSize({ width: 1200, height: 800 })
  await seedAuthenticatedSession(page, { user_id: 23 })
  const scope = { region_ids: [1], border_hops: 0, version: 1 }
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate' }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({
      board: { id: 71, name: '夜巡', kind: 'pirate' }, role: 'founder', user_id: 23,
      permission_version: 1, scope, target_count: 0, sightings: [], server_time: new Date().toISOString(),
    })
    if (url.pathname.endsWith('/boards/71/map/')) return json({
      systems: [
        { system_id: 101, name: 'Derelik I', zh_name: '德里克一', region_id: 1,
          constellation_id: 44, x: 10, z: 10, security_status: -.17 },
        { system_id: 102, name: 'Derelik II', zh_name: '德里克二', region_id: 1,
          constellation_id: 44, x: 30, z: 30, security_status: -.26 },
      ],
      stargates: [{ system_id: 101, destination_system_id: 102 }],
      constellations: [], regions: [], scope,
    })
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  const hit = page.locator('[data-pirate-system="102"]')
  await expect(hit).toBeVisible()
  return hit
}

async function zoomAtSystem(page, hit) {
  const box = await hit.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  // Two normal wheel gestures reach the supported maximum while keeping the
  // target anchored under the pointer, unlike toolbar zoom around map center.
  for (let step = 0; step < 2; step += 1) {
    await page.mouse.wheel(0, -1200)
    const expected = step === 0 ? Math.exp(1.44) : 8
    await expect.poll(() => page.locator('.pirate-map__world').evaluate(node =>
      Number(node.getAttribute('transform').match(/scale\(([-\d.e]+)\)/)[1])),
    ).toBeCloseTo(expected, 3)
  }
  await expect(page.locator('.pirate-map')).not.toHaveClass(/pirate-map--wheel-motion/)
}

async function expectCompactFocus(page, hit) {
  await expect(hit).toBeFocused()
  await expect(hit).toHaveCSS('outline-style', 'none')
  await expect(hit).toHaveCSS('fill', 'rgba(0, 0, 0, 0)')
  await expect(hit).not.toHaveClass(/pirate-map__system-hit--selected/)
  const ring = page.locator('.pirate-map__system-focus-ring')
  await expect(ring).toHaveCount(1)
  const metrics = await ring.evaluate(node => {
    const box = node.getBoundingClientRect()
    const transform = node.getScreenCTM()
    const scale = Math.hypot(transform.a, transform.b)
    return { width: box.width, height: box.height,
      stroke: Number.parseFloat(getComputedStyle(node).strokeWidth) * scale }
  })
  expect(metrics.width).toBeGreaterThanOrEqual(22)
  expect(metrics.width).toBeLessThanOrEqual(26)
  expect(metrics.height).toBeLessThanOrEqual(26)
  expect(metrics.stroke).toBeGreaterThan(0)
  expect(metrics.stroke).toBeLessThanOrEqual(1.5)
}

for (const closeMode of ['close button', 'cancel', 'Escape']) {
  test(`pirate system focus stays compact after ${closeMode} closes a report at maximum zoom`, async ({ page }, testInfo) => {
    const hit = await openPirateBoard(page)
    await zoomAtSystem(page, hit)
    for (let cycle = 0; cycle < 2; cycle += 1) {
      await hit.click()
      const dialog = page.getByRole('dialog', { name: '上报目标线索' })
      await expect(dialog).toContainText('已选：德里克二')
      if (closeMode === 'Escape') await page.keyboard.press('Escape')
      else await dialog.getByRole('button', {
        name: closeMode === 'cancel' ? '取消' : '关闭上报目标线索', exact: true,
      }).click()
      await expect(dialog).toHaveCount(0)
      // The bug appears once the old trigger is focused but no longer hovered
      // or selected. Keep this state explicit for every dismissal route.
      await page.mouse.move(10, 10)
      await expectCompactFocus(page, hit)
    }
    await page.screenshot({ path: testInfo.outputPath('closed-report-maximum-zoom.png') })
    await page.getByRole('button', { name: '放大星图' }).click()
    await expect(page.locator('.pirate-map__system-focus-ring')).toHaveCount(0)
  })
}

test('pirate system keyboard focus is visible, survives reporting, and clears when tabbing away', async ({ page }) => {
  const hit = await openPirateBoard(page)
  await page.locator('[data-pirate-system="101"]').focus()
  await page.keyboard.press('Tab')
  await expect.poll(() => hit.evaluate(node => node.matches(':focus-visible'))).toBe(true)
  await expectCompactFocus(page, hit)
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog', { name: '上报目标线索' })).toContainText('已选：德里克二')
  await page.keyboard.press('Escape')
  await expectCompactFocus(page, hit)
  await page.keyboard.press('Tab')
  await expect(hit).not.toBeFocused()
  await expect(page.locator('.pirate-map__system-focus-ring')).toHaveCount(0)
})
