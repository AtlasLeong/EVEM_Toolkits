import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

async function market(page) {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '三钛合金', category: '矿物', best_sell: '130', best_buy: '100', observed_at: '2026-09-26T01:00:00Z', status: 'fresh', sell_prices: ['130', '131', '132', '133', '134'], buy_prices: ['100', '99', '98', '97', '96'] }] })
    if (url.pathname.endsWith('/series/')) return json({ count: 3, points: [
      { observed_at: '2026-09-26T00:00:00Z', best_sell: '120', best_buy: '90' },
      { observed_at: '2026-09-26T00:30:00Z', best_sell: '125', best_buy: '95' },
      { observed_at: '2026-09-26T01:00:00Z', best_sell: '130', best_buy: '100' },
    ] })
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-path--sell')).toBeVisible()
}

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1920, height: 720 }, { width: 1366, height: 768 }, { width: 1200, height: 768 }, { width: 390, height: 844 }]) {
  test(`release chart pointer aligns with actual curve at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await market(page)
    await page.locator('.market-trend-svg').scrollIntoViewIfNeeded()
    const point = await page.locator('.market-trend-path--sell').evaluate(path => {
      const p = path.getPointAtLength(path.getTotalLength())
      return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()).toJSON()
    })
    await page.mouse.move(point.x, point.y)
    await expect(page.getByRole('status', { name: '当前观测报价' }).locator('time')).toHaveAttribute('datetime', '2026-09-26T01:00:00Z')
    await expect(page.getByRole('tooltip')).toBeVisible()
    const tip = await page.getByRole('tooltip').boundingBox()
    const chart = await page.locator('.market-trend-svg-wrap').boundingBox()
    const cursor = await page.locator('.market-trend-cursor').boundingBox()
    const axis = await page.locator('.market-trend-axis').first().boundingBox()
    expect(chart.height).toBeGreaterThanOrEqual(180)
    expect(axis.height).toBeGreaterThanOrEqual(11)
    expect(tip.x).toBeGreaterThanOrEqual(chart.x - 1)
    expect(tip.x + tip.width).toBeLessThanOrEqual(chart.x + chart.width + 1)
    expect(tip.y).toBeGreaterThanOrEqual(chart.y - 1)
    expect(tip.y + tip.height).toBeLessThanOrEqual(chart.y + chart.height + 1)
    expect(Math.abs(cursor.x + cursor.width / 2 - point.x)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('market-release.png') })
  })
}

test('release desktop keeps all five levels inside the inset terminal on laptop screens', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await market(page)
  const layout = await page.locator('.market-terminal-layout').boundingBox()
  const depth = await page.locator('.market-depth-panel').boundingBox()
  expect(depth.y + depth.height).toBeLessThanOrEqual(layout.y + layout.height)
  expect(depth.y + depth.height).toBeLessThan(768)
  const metrics = await page.locator('.market-terminal').evaluate(el => ({
    radius: parseFloat(getComputedStyle(el).borderTopLeftRadius),
    inset: el.getBoundingClientRect().x - el.closest('.shell-main').getBoundingClientRect().x,
    bg: getComputedStyle(el.closest('.shell-main')).backgroundColor,
    terminalBg: getComputedStyle(el).backgroundColor,
  }))
  expect(metrics.radius).toBeGreaterThanOrEqual(10)
  expect(metrics.inset).toBeGreaterThanOrEqual(12)
  expect(metrics.bg).not.toBe(metrics.terminalBg)
})
