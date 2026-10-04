import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const report = {
  kill_id: 'console-fixture', ship_name: '夜神级', ship_class_label: '航空母舰',
  victim_name: '测试飞行员', victim_corporation_name: '远航军团',
  system_name: '德里克一', constellation_name: '德里克核心', region_name: '德里克',
  security_status: -.24, isk_lost: '24500000000',
  kill_time_display: '2026-10-03T08:30:00Z', participants: [], items: [],
}

for (const width of [1440, 390]) {
  test(`killboard shares the console shell and stays usable at ${width}px`, async ({ page }) => {
    await seedAuthenticatedSession(page, { user_id: 23 })
    await installApiMock(page, ({ url }) => {
      if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: true })
      if (url.pathname.endsWith('/reports/')) return json({ count: 1, results: [report] })
      if (url.pathname.endsWith('/reports/console-fixture/')) return json(report)
      return json({})
    })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/killboard')
    const title = page.getByRole('heading', { name: '击毁情报 KM', exact: true })
    await expect(title).toHaveCSS('font-size', '28px')
    await expect(page.locator('.kb-workspace')).toHaveCSS('background-color', 'rgb(11, 23, 29)')
    await expect(page.locator('.kb-hero')).toHaveCSS('background-color', 'rgb(18, 37, 46)')
    await expect(page.locator('.kb-hero h2')).toHaveText('夜神级')
    await expect(page.locator('.kb-hero-value')).toContainText('245亿')
    await expect(page.getByRole('button', { name: '复制 KM' })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: `test-results/console-killboard-${width}.png`, fullPage: true })
  })
}
