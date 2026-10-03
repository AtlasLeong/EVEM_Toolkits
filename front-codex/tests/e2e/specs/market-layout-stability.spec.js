import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const item = { item_id: '28007000000', name: '伊甸币', category: '货币', best_sell: '21897981.37', best_buy: '20600001.00', observed_at: '2026-09-27T02:35:00Z', status: 'fresh', sell_prices: ['21897981.37'], buy_prices: ['20600001.00'] }
const points = [
  { observed_at: '2026-09-21T02:35:00Z', best_sell: '20310000', best_buy: '20100000' },
  { observed_at: item.observed_at, best_sell: item.best_sell, best_buy: item.best_buy },
]
const entry = value => ({ value, observed_at: item.observed_at })
const stats = { sell: { current: entry(item.best_sell), range: { high: entry('22114350'), low: entry('20310000') }, month: { high: entry('23400000'), low: entry('19800000') } } }
const response = { count: 2, points, stats, change: {} }
function deferred() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}
async function layout(page) {
  await page.evaluate(() => document.fonts.ready)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  return page.evaluate(() => Object.fromEntries(['catalog', 'main', 'summary', 'legend', 'plot', 'readout'].map(name => {
    const selector = { catalog: '.market-terminal-catalog', main: '.market-terminal-main', summary: '.market-terminal-summary', legend: '.market-legend', plot: '.market-trend-svg-wrap', readout: '.market-trend-readout' }[name]
    return [name, document.querySelector(selector).getBoundingClientRect().toJSON()]
  })))
}

for (const width of [390, 320]) {
  test(`catalog and history loading reserve the actual chart slots without fabricated data at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await page.clock.setFixedTime(new Date('2026-09-27T02:40:00Z'))
    const catalog = deferred(), history = deferred()
    let historyRequested = false
    await installApiMock(page, async ({ url }) => {
      if (url.pathname === '/api/market/categories/') return json([{ id: 'currency', label: '货币', count: 1 }])
      if (url.pathname === '/api/market/items/') { await catalog.promise; return json({ count: 1, results: [item] }) }
      if (url.pathname.endsWith('/series/')) { historyRequested = true; await history.promise; return json(response) }
    })
    await page.goto('/market')
    await expect(page.getByRole('heading', { name: '物品读取中' })).toBeVisible()
    await expect(page.getByRole('status', { name: '目录读取状态' })).toContainText('读取中')
    await expect(page.getByRole('status', { name: '目录读取状态' }).locator('time')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '7 天', exact: true })).toBeDisabled()
    await expect(page.locator('.market-trend-stats dd')).toHaveText(['—尚未读取', '—尚未读取', '—尚未读取', '—尚未读取', '—尚未读取'])
    await expect(page.locator('.market-trend-path')).toHaveCount(0)
    await expect(page.getByRole('table', { name: '走势图数据' })).toHaveCount(0)
    const catalogLayout = await layout(page)
    catalog.release()
    await expect.poll(() => historyRequested).toBe(true)
    await expect(page.getByRole('heading', { name: '伊甸币', exact: true })).toBeVisible()
    await expect(page.locator('.market-chart-frame')).toContainText('正在读取真实历史报价')
    await expect(page.locator('.market-trend-path')).toHaveCount(0)
    await expect(page.getByRole('table', { name: '走势图数据' })).toHaveCount(0)
    const historyLayout = await layout(page)
    history.release()
    await expect(page.locator('.market-trend-path')).toHaveCount(1)
    await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('21,897,981.37 ISK')
    const loadedLayout = await layout(page)
    for (const pendingLayout of [catalogLayout, historyLayout]) {
      for (const name of ['catalog', 'main', 'summary', 'legend', 'plot', 'readout']) expect(Math.abs(pendingLayout[name].y - loadedLayout[name].y), `${name} must stay in its loaded position`).toBeLessThanOrEqual(2)
      for (const name of ['catalog', 'main', 'plot', 'readout']) expect(Math.abs(pendingLayout[name].height - loadedLayout[name].height), `${name} must reserve its actual loaded height`).toBeLessThanOrEqual(2)
    }
    expect(loadedLayout.plot.height).toBeGreaterThanOrEqual(300)
    await page.screenshot({ path: testInfo.outputPath(`market-stable-loading-${width}.png`), fullPage: true })
  })
}

for (const width of [1440, 390, 320]) {
  test(`200% text enlargement preserves price axes, separate time ticks, and control labels at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await installApiMock(page, ({ url }) => {
      if (url.pathname === '/api/market/categories/') return json([{ id: 'currency', label: '货币', count: 1 }])
      if (url.pathname === '/api/market/items/') return json({ count: 1, results: [item] })
      if (url.pathname.endsWith('/series/')) return json(response)
    })
    await page.goto('/market')
    await expect(page.locator('.market-trend-path')).toHaveCount(1)
    await page.evaluate(() => {
      const records = [...document.querySelectorAll('body *')].filter(element => element.getBoundingClientRect().width && ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) || element.matches('input,textarea,select')))
        .map(element => { const style = getComputedStyle(element); return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) } })
      for (const { element, font, line } of records) {
        if (Number.isFinite(font)) element.style.setProperty('font-size', font * 2 + 'px', 'important')
        if (Number.isFinite(line)) element.style.setProperty('line-height', line * 2 + 'px', 'important')
      }
    })
    await expect.poll(async () => page.locator('.market-trend-axis--value').evaluateAll(labels => labels.every(label => label.getBoundingClientRect().left >= label.closest('svg').getBoundingClientRect().left))).toBe(true)
    const bounds = await page.evaluate(() => {
      const svg = document.querySelector('.market-trend-svg').getBoundingClientRect()
      const values = [...document.querySelectorAll('.market-trend-axis--value')].map(label => label.getBoundingClientRect().toJSON())
      const times = [...document.querySelectorAll('.market-trend-axis--time')].map(label => ({ ...label.getBoundingClientRect().toJSON(), accessible: label.getAttribute('aria-label') }))
      const controls = [...document.querySelectorAll('.market-view-modes button,.market-periods button')].map(button => {
        const range = document.createRange(); range.selectNodeContents(button)
        return { button: button.getBoundingClientRect().toJSON(), text: range.getBoundingClientRect().toJSON() }
      })
      return { svg: svg.toJSON(), values, times, controls, document: document.documentElement.scrollWidth, viewport: innerWidth }
    })
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport)
    for (const value of bounds.values) { expect(value.left).toBeGreaterThanOrEqual(bounds.svg.left); expect(value.right).toBeLessThanOrEqual(bounds.svg.right) }
    expect(bounds.times).toHaveLength(2)
    expect(bounds.times[0].accessible).toContain('2026')
    expect(bounds.times[1].accessible).toContain('2026')
    const [start, end] = bounds.times
    expect(start.right <= end.left || start.bottom <= end.top || end.bottom <= start.top, 'time ticks must not overlap').toBe(true)
    for (const { button, text } of bounds.controls) {
      expect(text.left).toBeGreaterThanOrEqual(button.left - 1)
      expect(text.right).toBeLessThanOrEqual(button.right + 1)
      expect(text.bottom).toBeLessThanOrEqual(button.bottom + 1)
    }
    await expect(page.getByRole('table', { name: '走势图数据' })).toContainText('21,897,981.37 ISK')
    await page.screenshot({ path: testInfo.outputPath(`market-text-enlarged-${width}.png`), fullPage: true })
  })
}
