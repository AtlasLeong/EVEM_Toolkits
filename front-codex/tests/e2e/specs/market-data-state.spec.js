import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const observedAt = '2026-10-03T18:00:00Z'
const firstItem = {
  item_id: '1001', name: '三钛合金', category: '矿物', category_id: 'minerals',
  best_sell: '130', best_buy: '100', observed_at: observedAt, status: 'fresh',
  sell_prices: ['130', '131'], buy_prices: ['100', '99'], scope: 'global',
}
const secondItem = { ...firstItem, item_id: '1002', name: '光泽合金', best_sell: '230', best_buy: '200', sell_prices: ['230'], buy_prices: ['200'] }

function series(sell = '130', count = 2) {
  return {
    count,
    points: [
      { observed_at: '2026-10-03T17:00:00Z', best_sell: String(Number(sell) - 10), best_buy: '90' },
      { observed_at: observedAt, best_sell: sell, best_buy: '100' },
    ],
    change: { best_sell: { absolute: '10', percent: '8.33' }, best_buy: { absolute: '10', percent: '11.11' } },
  }
}

function deferred() {
  let resolve
  const promise = new Promise(release => { resolve = release })
  return { promise, resolve }
}

test('a new history window never presents the previous window as its data', async ({ page }) => {
  const nextRange = deferred()
  let rangeRequested = false
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [firstItem] })
    if (url.pathname.endsWith('/series/')) {
      if (url.searchParams.get('days') === '7') {
        rangeRequested = true
        await nextRange.promise
        return json(series('730', 7))
      }
      return json(series())
    }
  })
  await page.goto('/market')
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('130 ISK')
  await page.getByRole('button', { name: '7 天', exact: true }).click()
  await expect.poll(() => rangeRequested).toBe(true)
  await expect(page.getByRole('button', { name: '7 天', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.market-chart-frame')).toContainText('正在读取')
  await expect(page.locator('.market-trend-path')).toHaveCount(0)
  await expect(page.getByRole('table', { name: '走势图数据' })).toHaveCount(0)
  await expect(page.locator('.market-current-quotes')).not.toContainText('8.33%')
  nextRange.resolve()
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('730 ISK')
  await expect(page.locator('.market-legend')).toContainText('7 次观测')
})

test('a changed catalog filter does not label old results as the new category', async ({ page }) => {
  const nextCatalog = deferred()
  let categoryRequested = false
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 1 }, { id: 'intermediate', label: '中间产物', count: 1 }])
    if (url.pathname === '/api/market/items/') {
      if (url.searchParams.get('category_id') === 'intermediate') {
        categoryRequested = true
        await nextCatalog.promise
        return json({ count: 1, results: [{ ...secondItem, category: '中间产物' }] })
      }
      return json({ count: 1, results: [firstItem] })
    }
    if (url.pathname.endsWith('/series/')) return json(series(url.pathname.includes('1002') ? '230' : '130'))
  })
  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '三钛合金' })).toBeVisible()
  await page.getByRole('button', { name: /中间产物 1/ }).click()
  await expect.poll(() => categoryRequested).toBe(true)
  await expect(page.getByRole('button', { name: /中间产物 1/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.locator('.market-item-choice')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '三钛合金' })).toHaveCount(0)
  await expect(page.locator('.market-trend-path')).toHaveCount(0)
  nextCatalog.resolve()
  await expect(page.getByRole('heading', { name: '光泽合金' })).toBeVisible()
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('230 ISK')
})

for (const width of [1440, 390]) {
  test(`failed refresh retains identified cache and successful timestamps, then recovers at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    let failRefresh = false
    let successfulReads = 0
    await installApiMock(page, ({ url }) => {
      if (url.pathname === '/api/market/categories/') return failRefresh ? json({ detail: '服务暂不可用' }, 503) : json([{ id: 'minerals', label: '矿物', count: 1 }])
      if (url.pathname === '/api/market/items/') {
        if (failRefresh) return json({ detail: '目录暂不可用' }, 503)
        successfulReads += 1
        return json({ count: 1, results: [firstItem] })
      }
      if (url.pathname.endsWith('/series/')) return failRefresh ? json({ detail: '走势暂不可用' }, 503) : json(series())
    })
    await page.goto('/market')
    await expect(page.locator('.market-trend-path')).toHaveCount(1)
    const catalogTime = page.getByRole('status', { name: '目录读取状态' }).locator('time')
    const historyTime = page.getByRole('status', { name: '走势读取状态' }).locator('time')
    const previousCatalogTime = await catalogTime.getAttribute('datetime')
    const previousHistoryTime = await historyTime.getAttribute('datetime')
    await expect(page.locator('.market-snapshot-meta time')).toHaveAttribute('datetime', observedAt)
    failRefresh = true
    await page.getByRole('button', { name: '刷新市场价格' }).click()
    await expect(page.getByRole('status', { name: '目录读取状态' })).toContainText('刷新失败，显示本页缓存')
    await expect(page.getByRole('status', { name: '走势读取状态' })).toContainText('刷新失败，显示本页缓存')
    await expect(catalogTime).toHaveAttribute('datetime', previousCatalogTime)
    await expect(historyTime).toHaveAttribute('datetime', previousHistoryTime)
    await expect(page.getByRole('heading', { name: '三钛合金' })).toBeVisible()
    await expect(page.locator('.market-trend-path')).toHaveCount(1)
    await expect(page.getByRole('table', { name: '走势图数据' })).toContainText('130 ISK')
    if (width < 768) await page.getByRole('button', { name: '切换物品', exact: true }).click()
    await expect(page.getByRole('button', { name: /矿物 1/ })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`market-cache-failure-${width}.png`), fullPage: width < 768 })
    failRefresh = false
    await page.getByRole('button', { name: '刷新市场价格' }).click()
    await expect.poll(() => successfulReads).toBe(2)
    await expect(page.getByRole('status', { name: '目录读取状态' })).toContainText('已读取')
    await expect(page.getByRole('status', { name: '走势读取状态' })).toContainText('已读取')
    await expect(catalogTime).not.toHaveAttribute('datetime', previousCatalogTime)
    await expect(historyTime).not.toHaveAttribute('datetime', previousHistoryTime)
    await expect(page.getByText('刷新失败，显示本页缓存')).toHaveCount(0)
  })
}

for (const width of [390, 320]) {
  test(`mobile catalog prioritizes the chart and preserves keyboard access and selection at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 })
    await installApiMock(page, ({ url }) => {
      if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 2 }])
      if (url.pathname === '/api/market/items/') return json({ count: 2, results: [firstItem, secondItem] })
      if (url.pathname.endsWith('/series/')) return json(series(url.pathname.includes('1002') ? '230' : '130'))
    })
    await page.goto('/market')
    const toggle = page.getByRole('button', { name: '切换物品', exact: true })
    const search = page.getByRole('searchbox', { name: '搜索物品' })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toHaveAttribute('aria-controls', 'market-catalog-content')
    await expect(toggle).toContainText('三钛合金')
    await expect(search).not.toBeVisible()
    await expect(page.locator('.market-trend-svg-wrap')).toBeVisible()
    expect((await page.locator('.market-trend-svg-wrap').boundingBox()).y).toBeLessThan(700)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await toggle.focus()
    await page.keyboard.press('Tab')
    await expect(page.getByRole('button', { name: '双边走势', exact: true })).toBeFocused()
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(search).toBeVisible()
    await expect(page.getByRole('button', { name: /矿物 2/ })).toBeVisible()
    await page.getByRole('button', { name: /光泽合金/ }).click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(toggle).toBeFocused()
    await expect(toggle).toContainText('光泽合金')
    await expect(search).not.toBeVisible()
    await expect(page.getByRole('heading', { name: '光泽合金' })).toBeVisible()
    await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('230 ISK')
    await page.screenshot({ path: testInfo.outputPath(`market-mobile-disclosure-${width}.png`), fullPage: true })
    await page.keyboard.press('Space')
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(search).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 960 })
    await expect(toggle).not.toBeVisible()
    await expect(search).toBeVisible()
    await expect(page.getByRole('button', { name: /三钛合金/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /光泽合金/ })).toBeVisible()
  })
}

test('market catalog retains keyboard focus across both 767px disclosure boundaries', async ({ page }) => {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 2 }])
    if (url.pathname === '/api/market/items/') return json({ count: 2, results: [firstItem, secondItem] })
    if (url.pathname.endsWith('/series/')) return json(series(url.pathname.includes('1002') ? '230' : '130'))
  })
  await page.setViewportSize({ width: 390, height: 960 })
  await page.goto('/market')
  const toggle = page.getByRole('button', { name: '切换物品', exact: true })
  const search = page.getByRole('searchbox', { name: '搜索物品' })
  const refresh = page.getByRole('button', { name: '刷新市场价格' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await refresh.focus()
  await page.keyboard.press('Tab')
  await expect(toggle).toBeFocused()
  await page.setViewportSize({ width: 768, height: 960 })
  await expect(toggle).toBeHidden()
  await expect(search).toBeFocused()
  await expect(search).toBeVisible()
  await page.setViewportSize({ width: 767, height: 960 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(search).toBeVisible()
  await expect(search).toBeFocused()
  await page.setViewportSize({ width: 760, height: 960 })
  await expect(search).toBeFocused()
  await search.press('Shift+Tab')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await page.keyboard.press('Tab')
  const chartControl = page.getByRole('button', { name: '双边走势', exact: true })
  await expect(chartControl).toBeFocused()
  await page.setViewportSize({ width: 768, height: 960 })
  await expect(chartControl).toBeFocused()
  await page.setViewportSize({ width: 767, height: 960 })
  await expect(chartControl).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeHidden()
})

test('a series request failure is distinct from a successful empty history', async ({ page }) => {
  let failSeries = true
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [firstItem] })
    if (url.pathname.endsWith('/series/')) return failSeries ? json({ detail: '无法读取' }, 503) : json({ count: 0, points: [] })
  })
  await page.goto('/market')
  await expect(page.locator('.market-chart-frame')).toContainText('走势图暂时无法加载')
  await expect(page.locator('.market-trend-empty')).toHaveCount(0)
  await expect(page.getByRole('status', { name: '走势读取状态' }).locator('time')).toHaveCount(0)
  failSeries = false
  await page.getByRole('button', { name: '刷新市场价格' }).click()
  await expect(page.locator('.market-trend-empty')).toContainText('暂无有效报价曲线')
  await expect(page.locator('.market-chart-frame')).not.toContainText('暂时无法加载')
  await expect(page.getByRole('status', { name: '走势读取状态' })).toContainText('已读取')
})

test('mobile instrument summary preserves a long Chinese name and a huge exact quote', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 })
  const name = '受损的旗舰级先进复合材料制造与跃迁推进系统装配组件'
  const price = '987654321012345678.90'
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ ...firstItem, name, best_sell: price, sell_prices: [price] }] })
    if (url.pathname.endsWith('/series/')) return json(series(price))
  })
  await page.goto('/market')
  const summary = page.getByRole('button', { name: '切换物品', exact: true })
  await expect(summary).toContainText(name)
  await expect(summary).toHaveAttribute('aria-describedby', 'market-mobile-selected-item')
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  await expect(page.locator('.market-current-quote--sell .market-quote-value')).toHaveAttribute('title', '987,654,321,012,345,678.90 ISK')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  expect(await summary.locator('strong').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
})

for (const snapshot of [
  { name: 'confirmed empty observation', item: { ...firstItem, best_sell: null, best_buy: null, sell_prices: [], buy_prices: [], status: 'empty' }, expected: '暂无挂单' },
  { name: 'uncollected instrument', item: { ...firstItem, best_sell: null, best_buy: null, sell_prices: [], buy_prices: [], observed_at: null, status: 'uncollected' }, expected: '尚未采集' },
  { name: 'legacy quote without depth levels', item: { ...firstItem, sell_prices: undefined, buy_prices: undefined }, expected: '未提供多档报价' },
]) {
  test(`${snapshot.name} has accurate order book copy`, async ({ page }) => {
    await installApiMock(page, ({ url }) => {
      if (url.pathname === '/api/market/categories/') return json([])
      if (url.pathname === '/api/market/items/') return json({ count: 1, results: [snapshot.item] })
      if (url.pathname.endsWith('/series/')) return json({ count: 0, points: [] })
    })
    await page.goto('/market')
    await expect(page.locator('.market-book-empty')).toHaveCount(2)
    for (const empty of await page.locator('.market-book-empty').all()) await expect(empty).toHaveText(snapshot.expected)
    await expect(page.locator('.market-chart-frame')).not.toContainText('暂时无法加载')
    if (snapshot.item.observed_at) await expect(page.locator('.market-snapshot-meta time')).toHaveAttribute('datetime', observedAt)
    else await expect(page.locator('.market-snapshot-meta')).toContainText('尚未采集')
  })
}
