import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const FIRST_OBSERVATION = '2026-09-26T00:00:00Z'
const LAST_OBSERVATION = '2026-09-26T01:00:00Z'
const MODES = ['双边走势', '只看卖价', '只看买价']

function sideStats(current, low, monthHigh, monthLow) {
  const entry = (value, observed_at = LAST_OBSERVATION) => ({ value, observed_at })
  return {
    current: entry(current),
    range: { high: entry(current), low: entry(low, FIRST_OBSERVATION) },
    month: { high: entry(monthHigh, '2026-09-01T00:00:00Z'), low: entry(monthLow, '2026-09-02T00:00:00Z') },
  }
}

async function openMarket(page, { emptyBuy = false } = {}) {
  await page.clock.setFixedTime(new Date('2026-09-26T01:05:00Z'))
  const requests = []
  await installApiMock(page, ({ url }) => {
    if (url.pathname.startsWith('/api/market/')) requests.push(`${url.pathname}${url.search}`)
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '矿物', count: 2 }])
    if (url.pathname === '/api/market/items/') return json({ count: 2, results: [
      { item_id: '1001', name: '三钛合金', category: '矿物', scope: 'global', best_sell: '130', best_buy: '100', observed_at: LAST_OBSERVATION, status: 'fresh', sell_prices: ['130', '131', '132', '133', '134'], buy_prices: ['100', '99', '98', '97', '96'] },
      { item_id: '1002', name: '类晶体胶矿', category: '矿物', scope: 'global', best_sell: '230', best_buy: '200', observed_at: LAST_OBSERVATION, status: 'stale', sell_prices: ['230', '231', '232', '233', '234'], buy_prices: ['200', '199', '198', '197', '196'] },
    ] })
    if (/\/items\/100[12]\/series\/$/.test(url.pathname)) {
      const offset = url.pathname.includes('/1002/') ? 100 : 0
      const price = value => String(value + offset)
      return json({
        count: 3,
        points: [
          { observed_at: FIRST_OBSERVATION, best_sell: price(120), best_buy: emptyBuy ? null : price(90) },
          { observed_at: '2026-09-26T00:30:00Z', best_sell: price(125), best_buy: emptyBuy ? null : price(95) },
          { observed_at: LAST_OBSERVATION, best_sell: price(130), best_buy: emptyBuy ? null : price(100) },
        ],
        stats: {
          sell: sideStats(price(130), price(120), price(140), price(110)),
          buy: emptyBuy ? { current: null, range: { high: null, low: null }, month: { high: null, low: null } } : sideStats(price(100), price(90), price(120), price(80)),
        },
        change: { best_sell: { absolute: '10', percent: '8.33' }, best_buy: { absolute: '10', percent: '11.11' } },
      })
    }
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-panel--sell .market-trend-path')).toBeVisible()
  return requests
}

function modeGroup(page) {
  return page.getByRole('group', { name: '走势显示方式', exact: true })
}

async function expectMode(page, mode) {
  const group = modeGroup(page)
  await expect(group.getByRole('button')).toHaveCount(3)
  await expect(group.locator('button[aria-pressed="true"]')).toHaveCount(1)
  for (const label of MODES) await expect(group.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', String(mode === label))
}

test('removes the instrument badge while retaining catalog freshness and sidebar collection time', async ({ page }) => {
  await openMarket(page)
  await expect(page.locator('.market-instrument-head h2')).toHaveText('三钛合金')
  await expect(page.locator('.market-instrument-status')).toHaveCount(0)
  await expect(page.locator('.market-choice-status')).toHaveText(['最新观测', '已过期'])
  await expect(page.locator('.market-snapshot-meta')).toContainText('最近采集')
  await expect(page.locator('.market-snapshot-meta strong')).toContainText('2026')
  await expect(page.locator('.market-sample-age')).toHaveText('5 分钟前')
  await page.getByRole('button', { name: /类晶体胶矿 已过期/ }).click()
  await expect(page.locator('.market-instrument-head h2')).toHaveText('类晶体胶矿')
  await expect(page.locator('.market-instrument-status')).toHaveCount(0)
})

test('offers one exclusive display mode and switches locally without requesting market data', async ({ page }) => {
  const requests = await openMarket(page)
  const initialRequests = [...requests]
  await expectMode(page, '双边走势')
  for (const mode of ['只看卖价', '只看卖价', '只看买价', '只看买价', '双边走势']) {
    await modeGroup(page).getByRole('button', { name: mode, exact: true }).click()
    await expectMode(page, mode)
    await expect(page.locator('.market-trend-panel')).toHaveCount(mode === '双边走势' ? 2 : 1)
  }
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  expect(requests).toEqual(initialRequests)
})

test('display modes support Tab, Space, Enter and a visible keyboard focus state', async ({ page }) => {
  await openMarket(page)
  const group = modeGroup(page)
  await group.getByRole('button', { name: '双边走势', exact: true }).focus()
  await page.keyboard.press('Tab')
  const sell = group.getByRole('button', { name: '只看卖价', exact: true })
  await expect(sell).toBeFocused()
  const focus = await sell.evaluate(button => ({ width: parseFloat(getComputedStyle(button).outlineWidth), style: getComputedStyle(button).outlineStyle }))
  expect(focus.width).toBeGreaterThanOrEqual(2)
  expect(focus.style).not.toBe('none')
  await page.keyboard.press('Space')
  await expectMode(page, '只看卖价')
  await expect(sell).toBeFocused()
  await page.keyboard.press('Tab')
  const buy = group.getByRole('button', { name: '只看买价', exact: true })
  await expect(buy).toBeFocused()
  await page.keyboard.press('Enter')
  await expectMode(page, '只看买价')
  await expect(buy).toBeFocused()
  const colors = await group.getByRole('button').evaluateAll(buttons => buttons.map(button => getComputedStyle(button).backgroundColor))
  expect(colors[2]).not.toBe(colors[0])
})

for (const side of [{ mode: '只看卖价', tone: 'sell', label: '最低卖价', other: '最高买价', first: '120 ISK', last: '130 ISK', stats: ['130 ISK', '130 ISK', '120 ISK', '140 ISK', '110 ISK'] }, { mode: '只看买价', tone: 'buy', label: '最高买价', other: '最低卖价', first: '90 ISK', last: '100 ISK', stats: ['100 ISK', '100 ISK', '90 ISK', '120 ISK', '80 ISK'] }]) {
  test(`${side.mode} filters statistics, tooltip, persistent readout and accessible table only`, async ({ page }) => {
    await openMarket(page)
    const sidebarBefore = await page.locator('.market-terminal-summary').innerText()
    await modeGroup(page).getByRole('button', { name: side.mode, exact: true }).click()
    const panel = page.locator(`.market-trend-panel--${side.tone}`)
    await expect(page.locator('.market-trend-panel')).toHaveCount(1)
    await expect(panel.locator('.market-trend-stats dt')).toHaveText(['当前', '区间高', '区间低', '月高', '月低'])
    await expect(panel.locator('.market-trend-stats .sr-only')).toHaveText(side.stats)
    const readout = page.getByRole('status', { name: '当前观测报价' })
    await expect(readout).toContainText(side.label)
    await expect(readout).toContainText(side.last)
    await expect(readout).not.toContainText(side.other)
    const table = page.getByRole('table', { name: '走势图数据' })
    await expect(table.getByRole('columnheader')).toHaveText(['采集时间', side.label])
    await expect(table.getByRole('row')).toHaveCount(4)
    await expect(table.locator('tbody tr').first().getByRole('cell')).toHaveCount(2)
    await expect(table.locator('tbody tr').first()).toContainText(side.first)
    await expect(table).not.toContainText(side.other)
    await panel.locator('[data-point-index="0"]').focus()
    const tooltip = page.getByRole('tooltip')
    await expect(tooltip).toBeVisible()
    await expect(tooltip).toContainText(side.label)
    await expect(tooltip).toContainText(side.first)
    await expect(tooltip).not.toContainText(side.other)
    await expect(readout).toContainText(side.first)
    await expect(readout.locator('time')).toHaveAttribute('datetime', FIRST_OBSERVATION)
    expect(await page.locator('.market-terminal-summary').innerText()).toBe(sidebarBefore)
    await expect(page.locator('.market-quote-card')).toHaveCount(2)
    await expect(page.locator('.market-price-ladder--sell li')).toHaveCount(5)
    await expect(page.locator('.market-price-ladder--buy li')).toHaveCount(5)
  })
}

test('mode changes clear historical interaction and both mode restores synchronized dual-side data', async ({ page }) => {
  await openMarket(page)
  const readout = page.getByRole('status', { name: '当前观测报价' })
  await page.locator('.market-trend-panel--sell [data-point-index="0"]').focus()
  await expect(readout).toContainText('120 ISK')
  await expect(readout).toContainText('90 ISK')
  await expect(page.getByRole('tooltip')).toContainText('90 ISK')
  await modeGroup(page).getByRole('button', { name: '只看买价', exact: true }).click()
  await expect(readout.locator('time')).toHaveAttribute('datetime', LAST_OBSERVATION)
  await expect(readout).toContainText('100 ISK')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(page.locator('.market-trend-cursor, .market-trend-point')).toHaveCount(0)
  await page.locator('.market-trend-panel--buy [data-point-index="0"]').focus()
  await expect(readout).toContainText('90 ISK')
  await modeGroup(page).getByRole('button', { name: '双边走势', exact: true }).click()
  await expect(readout.locator('time')).toHaveAttribute('datetime', LAST_OBSERVATION)
  await expect(readout).toContainText('130 ISK')
  await expect(readout).toContainText('100 ISK')
  await expect(page.getByRole('tooltip')).toHaveCount(0)
  await expect(page.getByRole('table', { name: '走势图数据' }).getByRole('columnheader')).toHaveText(['采集时间', '最低卖价', '最高买价'])
  await page.locator('.market-trend-panel--buy [data-point-index="1"]').focus()
  await expect(readout).toContainText('125 ISK')
  await expect(readout).toContainText('95 ISK')
  await expect(page.getByRole('tooltip')).toContainText('125 ISK')
  await expect(page.getByRole('tooltip')).toContainText('95 ISK')
})

test('retains the selected side across item, historical window and refresh changes', async ({ page }) => {
  const requests = await openMarket(page)
  await modeGroup(page).getByRole('button', { name: '只看卖价', exact: true }).click()
  await page.getByRole('button', { name: /类晶体胶矿 已过期/ }).click()
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('230 ISK')
  await expectMode(page, '只看卖价')
  await Promise.all([
    page.waitForResponse(response => response.url().includes('/1002/series/?days=7')),
    page.getByRole('button', { name: '7 天', exact: true }).click(),
  ])
  await expectMode(page, '只看卖价')
  const beforeRefresh = requests.length
  await page.getByRole('button', { name: '刷新市场价格', exact: true }).click()
  await expect.poll(() => requests.length).toBe(beforeRefresh + 3)
  await expectMode(page, '只看卖价')
  await expect(page.locator('.market-trend-panel--sell')).toBeVisible()
  await expect(page.locator('.market-trend-panel--buy')).toHaveCount(0)
})

test('an empty selected side stays selected with its own empty statistics and no hidden-side leakage', async ({ page }) => {
  await openMarket(page, { emptyBuy: true })
  await modeGroup(page).getByRole('button', { name: '只看买价', exact: true }).click()
  await expectMode(page, '只看买价')
  await expect(page.locator('.market-trend-panel')).toHaveCount(1)
  await expect(page.locator('.market-trend-panel--buy .market-trend-panel-empty')).toHaveText('暂无有效报价曲线')
  await expect(page.locator('.market-trend-stats .sr-only')).toHaveText(Array(5).fill('样本不足'))
  await expect(page.locator('.market-trend-path')).toHaveCount(0)
  const readout = page.getByRole('status', { name: '当前观测报价' })
  await expect(readout).toContainText('最高买价 暂无报价')
  await expect(readout).not.toContainText('最低卖价')
  const table = page.getByRole('table', { name: '走势图数据' })
  await expect(table.getByRole('columnheader')).toHaveText(['采集时间', '最高买价'])
  await expect(table.locator('tbody tr td:last-child')).toHaveText(Array(3).fill('暂无报价'))
  await expect(page.locator('.market-price-ladder--sell li')).toHaveCount(5)
  await expect(page.locator('.market-price-ladder--buy li')).toHaveCount(5)
})

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }, { width: 820, height: 1180 }, { width: 390, height: 844 }, { width: 320, height: 740 }]) {
  test(`single-side panels fill the chart and avoid overflow at ${viewport.width}x${viewport.height}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport)
    await openMarket(page)
    if (viewport.width === 1920) await page.screenshot({ path: testInfo.outputPath('market-both-desktop.png') })
    for (const [mode, tone] of [['只看卖价', 'sell'], ['只看买价', 'buy']]) {
      await modeGroup(page).getByRole('button', { name: mode, exact: true }).click()
      const panel = page.locator(`.market-trend-panel--${tone}`)
      await expect(page.locator('.market-trend-panel')).toHaveCount(1)
      const frame = await page.locator('.market-chart-frame').boundingBox()
      const panelBox = await panel.boundingBox()
      expect(Math.abs(panelBox.x - frame.x)).toBeLessThanOrEqual(1)
      expect(Math.abs(panelBox.width - frame.width)).toBeLessThanOrEqual(1)
      const dimensions = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
      expect(dimensions.scroll).toBeLessThanOrEqual(dimensions.client + 1)
      const main = await page.locator('.market-terminal-main').evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth }))
      expect(main.scroll).toBeLessThanOrEqual(main.client + 1)
      if (tone === 'sell' && [1920, 390].includes(viewport.width)) {
        await panel.scrollIntoViewIfNeeded()
        await page.screenshot({ path: testInfo.outputPath(`market-sell-${viewport.width}.png`) })
      }
    }
  })
}
