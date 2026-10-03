import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const end = '2026-09-27T02:35:00Z'
const start = '2026-09-21T02:35:00Z'
const names = ['伊甸币', '三钛合金', '类晶体胶矿', '类银超金属', '光彩合金', '重水', '冷却剂', '贵金属']
const ids = ['28007000000', '41000000000', '41000000002', '41000000003', '42001000001', '42002000012', '42001000028', '42001000022']

async function openMarket(page, { missingLast = false, brokenImage = false, hugePrices = false } = {}) {
  await page.clock.setFixedTime(new Date('2026-09-27T02:40:00Z'))
  // Market items now resolve through the verified client-image library. Keep
  // the broken-image scenario pointed at the published asset so the fallback
  // contract remains covered after the catalog migration.
  if (brokenImage) await page.route('**/images/game-items/823a3352e8c8c545af8305d5b684c083dd374208a45f672f2c53c877067b1360.png', route => route.abort())
  const marketScope = { key: 'jita_h4', protocol_scope: 8, label: '吉他海四', description: '吉他 IV - 月 4 · 加达里海军装配厂' }
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 'currency', label: '货币 · 伊甸币', count: 1 }, { id: 'planetary', label: '行星资源', count: 34 }, { id: 'minerals', label: '矿物', count: 10 }])
    if (url.pathname === '/api/market/items/') return json({ count: 8, market_scope: marketScope, results: names.map((name, index) => ({
      name, item_id: ids[index], category: index ? '矿物' : '货币', scope: 'global', market_scope: marketScope, status: 'fresh', observed_at: end,
      best_sell: '21897981.37', best_buy: '20600001.00', sell_prices: ['21897981.37', '21900000', '21910000', '22000000', '22100000'],
      buy_prices: hugePrices ? ['9999999999999999.99'] : ['21000009.00', '21000005.00', '21000003.00', '21000002.00', '21000001.00'],
    })) })
    if (url.pathname.endsWith('/series/')) {
      const points = Array.from({ length: 29 }, (_, index) => ({
        observed_at: new Date(Date.parse(start) + (Date.parse(end) - Date.parse(start)) * index / 28).toISOString(),
        best_sell: String(Math.round(20310000 + index * 53000 + Math.sin(index * 0.5) * 600000)),
        best_buy: String(Math.round(20100000 + index * 25000 + Math.sin(index * 0.5) * 300000)),
      }))
      points[28].best_sell = missingLast ? null : '21897981.37'
      const entry = value => value === null ? null : { value, observed_at: end }
      const side = current => ({ current: entry(current), range: { high: entry('22114350'), low: entry('20310000') }, month: { high: entry('23400000'), low: entry('19800000') } })
      return json({ count: 29, market_scope: marketScope, points, stats: { sell: side(points[28].best_sell), buy: side(points[28].best_buy) }, change: {} })
    }
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-path--sell')).toBeVisible()
}

test('default focus mode uses genuine icons and a single chart with compact quote rail', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openMarket(page)
  await expect(page.getByRole('button', { name: '只看卖价', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.market-trend-panel')).toHaveCount(1)
  const icon = page.locator('.market-item-choice').first().locator('img')
  await expect(icon).toHaveAttribute('src', '/images/game-items/823a3352e8c8c545af8305d5b684c083dd374208a45f672f2c53c877067b1360.png')
  // The client crop keeps a transparent 156×128 canvas; the component still
  // reserves a square 40px slot so this aspect ratio never shifts the row.
  await expect.poll(() => icon.evaluate(image => image.complete && image.naturalWidth)).toBe(156)
  await expect(page.locator('.market-quote-card')).toHaveCount(0)
  await expect(page.locator('.market-terminal-summary')).toContainText('报价档位')
  await expect(page.getByText('价格范围：吉他海四').first()).toBeVisible()
  await expect(page.locator('.market-terminal-summary')).toContainText('吉他海四')
  await expect(page.locator('.market-terminal')).not.toContainText('实时盘口')
  await expect(page.locator('.market-terminal')).not.toContainText('盘口深度')
  await expect(page.locator('.market-trend-stats dt')).toHaveText(['当前', '区间高', '区间低', '30天高', '30天低'])
  await expect(page.locator('.market-last-price')).toHaveText('2189.8万')
  await expect(page.locator('.market-last-price')).toHaveAttribute('title', '21,897,981.37 ISK')
})

test('a missing final price is not relabeled with an older price at the chart edge', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openMarket(page, { missingLast: true })
  await expect(page.locator('.market-last-price')).toHaveCount(0)
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('暂无报价')
})

test('image failure uses a library fallback without shifting the item row', async ({ page }) => {
  await openMarket(page, { brokenImage: true })
  const item = page.locator('.market-item-choice').first()
  await expect(item.locator('.market-item-icon svg')).toBeVisible()
  await expect(item.locator('img')).toHaveCount(0)
  const box = await item.locator('.market-item-icon').boundingBox()
  expect(box.width).toBe(40)
  expect(box.height).toBe(40)
})

test('adjacent quote levels stay visibly precise and toolbar focus contrasts on the unified dark header', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 })
  await openMarket(page)
  const prices = page.locator('.market-price-ladder--buy li strong > [aria-hidden="true"]')
  await expect(prices).toHaveText(['21,000,009.00', '21,000,005.00', '21,000,003.00', '21,000,002.00', '21,000,001.00'])
  for (const price of await prices.all()) {
    expect(await price.evaluate(el => el.getBoundingClientRect().right <= el.closest('.market-price-ladder').getBoundingClientRect().right + 1)).toBe(true)
  }
  await page.getByRole('button', { name: '刷新市场价格' }).focus()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Shift+Tab')
  const focusRing = await page.evaluate(() => {
    const sample = document.createElement('span')
    sample.style.color = 'var(--focus-ring)'
    document.body.append(sample)
    const color = getComputedStyle(sample).color
    sample.remove()
    return color
  })
  await expect(page.getByRole('button', { name: '刷新市场价格' })).toHaveCSS('outline-color', focusRing)
})

test('very large quote levels fit the rail and retain the exact decimal in their accessible label', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 768 })
  await openMarket(page, { hugePrices: true })
  const price = page.locator('.market-price-ladder--buy li strong')
  await expect(price).toHaveAttribute('title', '9,999,999,999,999,999.99 ISK')
  await expect(price.locator('.sr-only')).toHaveText('9,999,999,999,999,999.99 ISK')
  await expect(price.locator('[aria-hidden="true"]')).toHaveText('10000万亿')
  expect(await price.evaluate(el => el.getBoundingClientRect().right <= el.closest('.market-price-ladder').getBoundingClientRect().right + 1)).toBe(true)
})

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1672, height: 941 }, { width: 1440, height: 960 }, { width: 1280, height: 720 }, { width: 390, height: 844 }]) {
  test(`focus terminal preserves chart priority at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await openMarket(page)
    const metrics = await page.evaluate(() => {
      const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON()
      return { plot: box('.market-trend-svg-wrap'), panel: box('.market-trend-panel'), readout: box('.market-trend-readout'), main: box('.market-terminal-main'), terminal: box('.market-terminal-layout'),
        catalog: box('.market-terminal-catalog'), sidebar: box('.market-terminal-summary'),
        controls: box('.market-view-modes'), periods: box('.market-periods'),
        scroll: document.documentElement.scrollWidth, width: innerWidth }
    })
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width)
    expect(metrics.plot.bottom).toBeLessThanOrEqual(metrics.panel.bottom + 1)
    expect(metrics.readout.top).toBeGreaterThanOrEqual(metrics.plot.bottom)
    expect(metrics.plot.height).toBeGreaterThanOrEqual(viewport.width >= 1180 ? viewport.height * 0.47 : 230)
    if (viewport.width >= 1180) {
      expect(metrics.plot.width).toBeGreaterThan(metrics.main.width * 0.90)
      expect(metrics.main.width).toBeGreaterThan(metrics.catalog.width * 2)
      expect(Math.abs(metrics.controls.y - metrics.periods.y)).toBeLessThanOrEqual(4)
      expect(metrics.sidebar.right).toBeLessThanOrEqual(metrics.terminal.right + 1)
      expect(metrics.terminal.bottom).toBeLessThanOrEqual(viewport.height)
    }
    // Lazy images can still be decoding when the faster series fixture is ready.
    // Wait for onscreen assets before treating the screenshot as visual evidence.
    await expect.poll(() => page.locator('.market-item-choice img').evaluateAll(images => images.every(img => {
      const rect = img.getBoundingClientRect()
      const nav = img.closest('.market-item-nav').getBoundingClientRect()
      return rect.top >= nav.bottom || rect.bottom <= nav.top || (img.complete && img.naturalWidth > 0)
    }))).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('market-focus.png'), fullPage: true })
  })
}
