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
    await page.locator('.market-trend-panel--sell .market-trend-svg').scrollIntoViewIfNeeded()
    const point = await page.locator('.market-trend-path--sell').evaluate(path => {
      const p = path.getPointAtLength(path.getTotalLength())
      return new DOMPoint(p.x, p.y).matrixTransform(path.getScreenCTM()).toJSON()
    })
    await page.mouse.move(point.x, point.y)
    await expect(page.getByRole('status', { name: '当前观测报价' }).locator('time')).toHaveAttribute('datetime', '2026-09-26T01:00:00Z')
    await expect(page.getByRole('tooltip')).toBeVisible()
    const tip = await page.getByRole('tooltip').boundingBox()
    const chart = await page.locator('.market-trend-panel--sell .market-trend-svg-wrap').boundingBox()
    const cursor = await page.locator('.market-trend-cursor').boundingBox()
    const axis = await page.locator('.market-trend-axis').first().boundingBox()
    expect(chart.height).toBeGreaterThanOrEqual(180)
    const panel = await page.locator('.market-trend-panel--sell').boundingBox()
    const readout = await page.getByRole('status', { name: '当前观测报价' }).boundingBox()
    expect(chart.y + chart.height).toBeLessThanOrEqual(panel.y + panel.height + 1)
    expect(panel.y + panel.height).toBeLessThanOrEqual(readout.y)
    expect(axis.height).toBeGreaterThanOrEqual(11)
    expect(tip.x).toBeGreaterThanOrEqual(chart.x - 1)
    expect(tip.x + tip.width).toBeLessThanOrEqual(chart.x + chart.width + 1)
    expect(tip.y).toBeGreaterThanOrEqual(chart.y - 1)
    expect(tip.y + tip.height).toBeLessThanOrEqual(chart.y + chart.height + 1)
    expect(Math.abs(cursor.x + cursor.width / 2 - point.x)).toBeLessThanOrEqual(2)
    await page.screenshot({ path: testInfo.outputPath('market-release.png') })
  })
}

for (const height of [720, 860]) {
  test(`short desktop ${height}px keeps chart labels readable and the filing footer reachable`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height })
    await market(page)
    const filingLink = page.getByRole('contentinfo').getByRole('link', { name: '粤ICP备2024264329号' })
    await expect(filingLink).toBeVisible()
    const metrics = await page.evaluate(() => {
      const timeLabels = [...document.querySelectorAll('.market-trend-panel--sell .market-trend-axis')].slice(-2)
      const readout = document.querySelector('[role="status"][aria-label="当前观测报价"]').getBoundingClientRect()
      const chart = document.querySelector('.market-chart-frame').getBoundingClientRect()
      const footer = document.querySelector('.site-footer').getBoundingClientRect()
      return {
        axisBottom: Math.max(...timeLabels.map(label => label.getBoundingClientRect().bottom)),
        readoutTop: readout.top,
        chartHeight: chart.height,
        footerTop: footer.top,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }
    })
    expect(metrics.readoutTop - metrics.axisBottom).toBeGreaterThanOrEqual(8)
    expect(metrics.chartHeight).toBeGreaterThanOrEqual(300)
    expect(metrics.footerTop).toBeGreaterThanOrEqual(height)
    expect(metrics.scrollHeight).toBeGreaterThan(metrics.clientHeight)
    await filingLink.scrollIntoViewIfNeeded()
    const footerBox = await page.getByRole('contentinfo').boundingBox()
    expect(footerBox.y + footerBox.height).toBeLessThanOrEqual(height + 1)
  })
}

for (const width of [1280, 1440]) {
  test(`desktop ${width}x861 keeps chart labels clear with the footer in view`, async ({ page }) => {
    await page.setViewportSize({ width, height: 861 })
    await market(page)
    const metrics = await page.evaluate(() => {
      const timeLabels = [...document.querySelectorAll('.market-trend-panel--sell .market-trend-axis')].slice(-2)
      const readout = document.querySelector('[role="status"][aria-label="当前观测报价"]').getBoundingClientRect()
      const chart = document.querySelector('.market-chart-frame').getBoundingClientRect()
      const footer = document.querySelector('.site-footer').getBoundingClientRect()
      return {
        axisBottom: Math.max(...timeLabels.map(label => label.getBoundingClientRect().bottom)),
        readoutTop: readout.top,
        chartHeight: chart.height,
        footerBottom: footer.bottom,
        scrollHeight: document.documentElement.scrollHeight,
        clientHeight: document.documentElement.clientHeight,
      }
    })
    expect(metrics.readoutTop - metrics.axisBottom).toBeGreaterThanOrEqual(8)
    expect(metrics.chartHeight).toBeGreaterThanOrEqual(300)
    expect(metrics.footerBottom).toBeLessThanOrEqual(862)
    expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
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

test('market renders synchronized buy and sell panels with range stats and keyboard tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '三钛合金', category: '矿物', best_sell: '130', best_buy: '100', observed_at: '2026-09-26T01:00:00Z', status: 'fresh' }] })
    if (url.pathname.endsWith('/series/')) return json({
      count: 3,
      points: [
        { observed_at: '2026-09-26T00:00:00Z', best_sell: '120', best_buy: '90' },
        { observed_at: '2026-09-26T00:30:00Z', best_sell: '125', best_buy: '95' },
        { observed_at: '2026-09-26T01:00:00Z', best_sell: '130', best_buy: '100' },
      ],
      stats: {
        sell: { current: { value: '130', observed_at: '2026-09-26T01:00:00Z' }, range: { high: { value: '130', observed_at: '2026-09-26T01:00:00Z' }, low: { value: '120', observed_at: '2026-09-26T00:00:00Z' } }, month: { high: { value: '140', observed_at: '2026-09-01T00:00:00Z' }, low: { value: '110', observed_at: '2026-09-02T00:00:00Z' } } },
        buy: { current: { value: '100', observed_at: '2026-09-26T01:00:00Z' }, range: { high: { value: '100', observed_at: '2026-09-26T01:00:00Z' }, low: { value: '90', observed_at: '2026-09-26T00:00:00Z' } }, month: { high: { value: '120', observed_at: '2026-09-01T00:00:00Z' }, low: { value: '80', observed_at: '2026-09-02T00:00:00Z' } } },
      },
    })
  })

  await page.goto('/market')
  await expect(page.locator('.market-trend-panel--sell')).toBeVisible()
  await expect(page.locator('.market-trend-panel--buy')).toBeVisible()
  await expect(page.locator('.market-trend-panel--sell .market-trend-path')).toHaveCount(1)
  await expect(page.locator('.market-trend-panel--buy .market-trend-path')).toHaveCount(1)
  await expect(page.locator('.market-trend-panel--sell .market-trend-stats')).toContainText('当前')
  await expect(page.locator('.market-trend-panel--sell .market-trend-stats')).toContainText('130 ISK')
  await expect(page.locator('.market-trend-panel--sell .market-trend-stats')).toContainText('区间高')
  await expect(page.locator('.market-trend-panel--sell .market-trend-stats')).toContainText('月低')
  await expect(page.locator('.market-trend-panel--buy .market-trend-stats')).toContainText('100 ISK')
  await expect(page.locator('.market-trend-panel--buy .market-trend-stats')).toContainText('120 ISK')

  const point = page.locator('.market-trend-panel--sell').getByRole('button', { name: '卖价第 2 次观测' })
  await point.focus()
  await expect(page.locator('.market-trend-tooltip')).toContainText('125 ISK')
  await expect(page.locator('.market-trend-panel--sell .market-trend-point')).toHaveCount(1)
  await expect(point).toHaveAttribute('aria-describedby', /market-trend-tooltip/)
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('130 ISK')
  await page.keyboard.press('ArrowLeft')
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('125 ISK')
  await expect(page.locator('.market-trend-tooltip')).toContainText('95 ISK')
})

test('market quote status clock updates stale labels while the page remains visible', async ({ page }) => {
  await page.clock.install()
  const observedAt = new Date(Date.now() - 2 * 60 * 60 * 1000 + 30000).toISOString()
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '三钛合金', category: '矿物', best_sell: '130', best_buy: '100', observed_at: observedAt, status: 'fresh' }] })
    if (url.pathname.endsWith('/series/')) return json({ count: 1, points: [{ observed_at: observedAt, best_sell: '130', best_buy: '100' }] })
  })
  await page.goto('/market')
  await expect(page.locator('.market-instrument-status')).toHaveText('最新观测')
  await page.clock.fastForward(60000)
  await expect(page.locator('.market-instrument-status')).toHaveText('已过期')
})
