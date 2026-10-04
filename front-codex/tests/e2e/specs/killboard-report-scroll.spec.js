import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const reports = Array.from({ length: 30 }, (_, index) => ({
  kill_id: String(112233445566 + index),
  ship_name: `Scroll fixture ${String(index + 1).padStart(2, '0')}`,
  victim_name: 'Fixture pilot', system_name: 'Fixture system',
  isk_lost: '24500000000', participants: [], items: [],
}))

async function fixture(page, density) {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await page.addInitScript(value => localStorage.setItem('evem-content-density', value), density)
  await installApiMock(page, ({ url }) => {
    if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: true })
    if (url.pathname.endsWith('/reports/')) return json({ count: 41, results: reports })
    if (url.pathname.includes('/reports/')) return json(reports.find(row => url.pathname.endsWith(`/${row.kill_id}/`)) || reports[0])
    return json({})
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

test.describe('touch report index', () => {
  test.use({ hasTouch: true, viewport: { width: 390, height: 900 } })
  test('an expanded mobile index scrolls with a touch swipe and reaches its last report', async ({ page }) => {
    await fixture(page, 'compact')
    await page.goto('/killboard')
    await page.locator('.kb-mobile-index-toggle').click()
    const list = page.locator('.kb-report-list')
    await expect(list.locator('.kb-report-row')).toHaveCount(30)
    await list.scrollIntoViewIfNeeded()
    const rect = await list.boundingBox()
    const cdp = await page.context().newCDPSession(page)
    const x = rect.x + rect.width / 2
    const start = Math.min(rect.y + rect.height - 30, 820)
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: start }] })
    for (let step = 1; step <= 6; step++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: start - step * 30 }] })
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await list.focus()
    await list.press('End')
    const last = list.locator('.kb-report-row').last()
    await expect(last).toBeInViewport({ ratio: 1 })
    await last.press('Enter')
    await expect(page.locator('.kb-hero h2')).toHaveText('Scroll fixture 30')
    await expect(page.locator('.kb-mobile-index-toggle')).toHaveAttribute('aria-expanded', 'false')
    await cdp.detach()
  })
})

for (const density of ['compact', 'comfortable']) {
  test(`all 30 killboard reports remain reachable by wheel and keyboard in ${density} mode`, async ({ page }) => {
    await fixture(page, density)
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/killboard')
    const list = page.locator('.kb-report-list')
    const last = list.locator('.kb-report-row').last()
    await expect(list.locator('.kb-report-row')).toHaveCount(30)
    await expect(page.locator('.kb-list-head')).toContainText('30 / 41')
    const sidebar = await page.locator('.kb-sidebar').boundingBox()
    const rail = await list.boundingBox()
    await page.mouse.move(rail.x + rail.width / 2, Math.min(rail.y + rail.height / 2, sidebar.y + sidebar.height - 20))
    await page.mouse.wheel(120, 700)
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    expect(await list.evaluate(element => element.scrollHeight)).toBeGreaterThan(await list.evaluate(element => element.clientHeight))
    await list.focus()
    await list.press('Home')
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(0)
    await list.press('PageDown')
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
    await list.press('End')
    await expect(last).toBeInViewport({ ratio: 1 })
    await last.press('Enter')
    await expect(page.locator('.kb-hero h2')).toHaveText('Scroll fixture 30')
  })
}
