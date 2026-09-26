import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const observedAt = '2026-09-26T07:03:47Z'
const sell = '21897981.37'
const buy = '20600001.00'
const entry = value => ({ value, observed_at: observedAt })
const stats = {
  sell: { current: entry(sell), range: { high: entry('22114288.00'), low: entry('20310000.00') }, month: { high: entry('123456789.00'), low: entry('20310000.00') } },
  buy: { current: entry(buy), range: { high: entry('21000000.00'), low: entry('20200003.00') }, month: { high: entry('21000000.00'), low: entry('0') } },
}

async function market(page, { empty = false, priceStats = stats } = {}) {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '货币 · 伊甸币', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{
      item_id: '1001', name: '伊甸币', category: '货币', best_sell: empty ? null : sell, best_buy: empty ? null : buy,
      observed_at: observedAt, status: empty ? 'empty' : 'fresh', scope: 'global',
      sell_prices: empty ? [] : [sell, '21900000', '21910000', '22000000', '22100000'],
      buy_prices: empty ? [] : [buy, '20500000', '20400000', '20300000', '20200000'],
    }] })
    if (url.pathname.endsWith('/series/')) return json({ count: 2, stats: priceStats, points: [
      { observed_at: '2026-09-26T06:00:00Z', best_sell: '22000000.00', best_buy: '20500000.00' },
      { observed_at: observedAt, best_sell: sell, best_buy: buy },
    ], change: { best_sell: { absolute: '-102018.63', percent: '-0.46' }, best_buy: { absolute: '100001.00', percent: '0.49' } } })
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-path--sell')).toBeVisible()
}

test('compact statistics keep precise titles and accessible prices including zero', async ({ page }) => {
  await market(page)
  const current = page.locator('.market-trend-panel--sell .market-trend-stats dd').first()
  await expect(current.locator('[aria-hidden="true"]')).toHaveText('2189.8万')
  await expect(current).toHaveAttribute('title', '21,897,981.37 ISK')
  await expect(current.locator('.sr-only')).toHaveText('21,897,981.37 ISK')
  await expect(page.locator('.market-trend-panel--sell .market-trend-stats dd').nth(3).locator('[aria-hidden="true"]')).toHaveText('1.23亿')
  await expect(page.locator('.market-trend-panel--buy .market-trend-stats dd').last().locator('[aria-hidden="true"]')).toHaveText('0')
  await expect(page.locator('.market-trend-stats').first()).toHaveAttribute('aria-label', /ISK/)
  await page.getByRole('button', { name: '卖价第 2 次观测' }).focus()
  await expect(page.getByRole('tooltip')).toContainText('21,897,981.37 ISK')
})

for (const viewport of [
  { width: 1920, height: 1080 }, { width: 1440, height: 900 },
  { width: 1920, height: 720 }, { width: 1366, height: 768 },
  { width: 1200, height: 768 }, { width: 1100, height: 820 },
  { width: 820, height: 900 }, { width: 390, height: 844 },
]) {
  test(`compact stats and sidebar stay readable at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await market(page)
    const sidebar = page.locator('.market-terminal-summary')
    await expect(sidebar.locator('.market-depth-panel')).toHaveCount(1)
    await expect(page.locator('.market-terminal-main .market-depth-panel')).toHaveCount(0)
    await expect(sidebar.locator('.market-price-ladder--sell li')).toHaveCount(5)
    await expect(sidebar.locator('.market-price-ladder--buy li')).toHaveCount(5)
    const metrics = await page.evaluate(() => {
      const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
      return {
        layout: rect('.market-terminal-layout'), main: rect('.market-terminal-main'), summary: rect('.market-terminal-summary'),
        depth: rect('.market-depth-panel'), meta: rect('.market-snapshot-meta'),
        ladders: [...document.querySelectorAll('.market-price-ladder')].map(el => el.getBoundingClientRect().toJSON()),
        stats: [...document.querySelectorAll('.market-trend-stats dd')].map(el => ({ scroll: el.scrollWidth, width: el.clientWidth, font: parseFloat(getComputedStyle(el).fontSize) })),
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight, height: innerHeight,
      }
    })
    expect(metrics.scrollWidth).toBeLessThanOrEqual(viewport.width)
    for (const value of metrics.stats) {
      expect(value.scroll).toBeLessThanOrEqual(value.width + 1)
      expect(value.font).toBeGreaterThanOrEqual(12)
    }
    if (viewport.width >= 1180) {
      expect(metrics.depth.x).toBeGreaterThanOrEqual(metrics.main.x + metrics.main.width)
      expect(metrics.depth.y + metrics.depth.height).toBeLessThanOrEqual(metrics.layout.y + metrics.layout.height)
      expect(metrics.meta.y + metrics.meta.height).toBeLessThanOrEqual(metrics.layout.y + metrics.layout.height)
      expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.height + 1)
    } else {
      expect(metrics.summary.y).toBeGreaterThanOrEqual(metrics.main.y + metrics.main.height - 1)
      if (viewport.width < 768) {
        for (const ladder of metrics.ladders) expect(ladder.width).toBeGreaterThan(metrics.summary.width * 0.8)
      }
    }
    await page.screenshot({ path: testInfo.outputPath('market-compact.png'), fullPage: true })
  })
}

for (const width of [1180, 1200, 1280, 1366, 1440, 320, 390, 420, 520]) {
  test(`longest supported compact statistics do not truncate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 768 })
    await market(page, { priceStats: {
      ...stats,
      sell: { ...stats.sell, current: entry('999999989999999999.99'), range: { high: entry('99999949.99'), low: entry('999999499999.99') } },
    } })
    await expect(page.locator('.market-trend-panel--sell .market-trend-stats dd [aria-hidden="true"]').first()).toHaveText('999999.99万亿')
    const widths = await page.locator('.market-trend-stats dd').evaluateAll(elements => elements.map(el => ({ scroll: el.scrollWidth, width: el.clientWidth })))
    for (const value of widths) expect(value.scroll).toBeLessThanOrEqual(value.width + 1)
  })
}

test('compact and exact statistics normalize the same decimal input', async ({ page }) => {
  await market(page, { priceStats: { ...stats, sell: { ...stats.sell, current: entry(' 21897981.37 ') } } })
  const current = page.locator('.market-trend-panel--sell .market-trend-stats dd').first()
  await expect(current.locator('[aria-hidden="true"]')).toHaveText('2189.8万')
  await expect(current).toHaveAttribute('title', '21,897,981.37 ISK')
  await expect(current.locator('.sr-only')).toHaveText('21,897,981.37 ISK')
})

test('short desktop keeps charts and the complete sidebar accessible through panel scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 600 })
  await market(page)
  const finalLevel = page.locator('.market-terminal-summary .market-price-ladder--buy li').last()
  await finalLevel.scrollIntoViewIfNeeded()
  await expect(finalLevel).toBeInViewport({ ratio: 1 })
  const meta = page.locator('.market-snapshot-meta')
  await meta.scrollIntoViewIfNeeded()
  await expect(meta).toBeInViewport({ ratio: 1 })
  const point = page.getByRole('button', { name: '卖价第 2 次观测' })
  await point.focus()
  await expect(page.getByRole('tooltip')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1366)
})

test('empty order-book sides remain explicit without invented price levels', async ({ page }) => {
  await market(page, { empty: true })
  const sidebar = page.locator('.market-terminal-summary')
  await expect(sidebar.locator('.market-price-ladder')).toHaveCount(2)
  await expect(sidebar.locator('.market-price-ladder--sell')).toContainText('暂无挂单')
  await expect(sidebar.locator('.market-price-ladder--buy')).toContainText('暂无挂单')
  await expect(sidebar.locator('.market-price-ladder li')).toHaveCount(0)
})
