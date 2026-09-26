import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const oldSample = '2026-09-23T08:00:00Z'
const freshSample = new Date().toISOString()

test('empty public catalog explains that collection items are not enabled', async ({ page }) => {
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/categories/') return json([])
    if (method === 'GET' && url.pathname === '/api/market/items/') return json({ count: 0, results: [] })
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByText('尚无已启用物品')).toBeVisible()
  await expect(page.locator('.market-trend-path')).toHaveCount(0)
})

test('terminal filters categories, switches items and retains selection on refresh', async ({ page }) => {
  const requests = []
  await installApiMock(page, ({ method, url }) => {
    requests.push(`${method} ${url.pathname}${url.search}`)
    if (method === 'GET' && url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 2 }, { id: 'other', label: '其他', count: 1 }])
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      if (url.searchParams.get('q') === '测试') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, scope: 'global', best_sell: '1234567.5', best_buy: '1100000', observed_at: oldSample, status: 'stale' }] })
      if (url.searchParams.get('category_id') === 'other') return json({ count: 1, results: [{ item_id: '1003', name: '未分类物品', category: '未知', category_id: null, scope: 'global', best_sell: null, best_buy: null, observed_at: null, status: 'uncollected' }] })
      return json({ count: 2, results: [
        { item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, scope: 'global', best_sell: '1234567.5', best_buy: '1100000', observed_at: oldSample, status: 'stale' },
        { item_id: '1002', name: '高价舰船', category: '战列舰', category_id: 1000, scope: 'global', best_sell: '987654321012345678.90', best_buy: null, observed_at: freshSample, status: 'fresh' },
      ] })
    }
    if (method === 'GET' && url.pathname.endsWith('/series/')) return json({ count: 2, points: [{ observed_at: oldSample, best_sell: '1200000', best_buy: '1000000' }, { observed_at: freshSample, best_sell: '1234567.5', best_buy: '1100000' }], change: { best_sell: { absolute: '34567.5', percent: '2.88' }, best_buy: { absolute: '100000', percent: '10' } } })
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '市场价格' })).toBeVisible()
  await expect(page.getByRole('button', { name: /测试舰船/ })).toHaveAttribute('aria-current', 'true')
  await expect(page.getByRole('heading', { name: '测试舰船' })).toBeVisible()
  await page.getByRole('button', { name: /高价舰船/ }).click()
  await expect(page.getByRole('heading', { name: '高价舰船' })).toBeVisible()
  await page.getByRole('button', { name: '刷新市场价格' }).click()
  await expect(page.getByRole('heading', { name: '高价舰船' })).toBeVisible()
  await expect(page.locator('.market-quote-value', { hasText: '987,654,321,012,345,678.90 ISK' })).toBeVisible()
  await page.getByRole('button', { name: /其他 1/ }).click()
  await expect.poll(() => requests.some(value => value.includes('category_id=other'))).toBeTruthy()
  await expect(page.getByRole('heading', { name: '未分类物品' })).toBeVisible()
  await page.getByRole('searchbox', { name: '搜索物品' }).fill('测试')
  await expect.poll(() => requests.some(value => value.includes('q=%E6%B5%8B%E8%AF%95'))).toBeTruthy()
  await expect(page.getByRole('heading', { name: '测试舰船' })).toBeVisible()
})

test('market terminal hides internal ids and explanatory footnotes', async ({ page }) => {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global' }] })
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 1, points: [{ observed_at: freshSample, best_sell: '130', best_buy: '100' }], change: { best_sell: { absolute: null, percent: null }, best_buy: { absolute: null, percent: null } } })
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '测试舰船' })).toBeVisible()
  await expect(page.locator('.market-choice-meta')).not.toContainText('ID')
  await expect(page.locator('.market-instrument-head')).not.toContainText('ID')
  await expect(page.locator('.market-chart-footnote')).toHaveCount(0)
  await expect(page.locator('.market-summary-note')).toHaveCount(0)
})

test('switching market items keeps the terminal chart mounted while the next series loads', async ({ page }) => {
  let seriesCalls = 0
  let releaseSecondSeries
  const secondSeries = new Promise(resolve => { releaseSecondSeries = resolve })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 2 }])
    if (url.pathname === '/api/market/items/') return json({ count: 2, results: [
      { item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global' },
      { item_id: '1002', name: '另一艘舰船', category: '战列舰', category_id: 1000, best_sell: '230', best_buy: '200', observed_at: freshSample, status: 'fresh', scope: 'global' },
    ] })
    if (url.pathname.endsWith('/series/')) {
      seriesCalls += 1
      if (seriesCalls > 1) await secondSeries
      return json({ count: 1, points: [{ observed_at: freshSample, best_sell: '130', best_buy: '100' }], change: { best_sell: { absolute: null, percent: null }, best_buy: { absolute: null, percent: null } } })
    }
    return undefined
  })

  await page.goto('/market')
  await expect(page.locator('.market-trend-panel--sell .market-trend-svg')).toBeVisible()
  await page.getByRole('button', { name: /另一艘舰船/ }).click()
  await expect(page.getByRole('heading', { name: '另一艘舰船' })).toBeVisible()
  await expect(page.locator('.market-terminal-main')).toBeVisible()
  await expect(page.locator('.market-trend-panel--sell .market-trend-svg')).toBeVisible()
  releaseSecondSeries()
})

test('market terminal fills the desktop viewport and keeps chart and order book in view', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global', sell_prices: ['130', '131'], buy_prices: ['100', '99'] }] })
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 2, points: [{ observed_at: oldSample, best_sell: '120', best_buy: '90' }, { observed_at: freshSample, best_sell: '130', best_buy: '100' }], change: { best_sell: { absolute: '10', percent: '8.3' }, best_buy: { absolute: '10', percent: '11.1' } } })
    return undefined
  })

  await page.goto('/market')
  await expect(page.locator('.market-terminal')).toBeVisible()
  await expect(page.locator('.market-trend-panel--sell .market-trend-svg')).toBeVisible()
  await expect(page.getByRole('region', { name: '盘口深度' })).toBeVisible()
  await expect(page.getByRole('contentinfo').getByRole('link', { name: '粤ICP备2024264329号' })).toBeVisible()

  const metrics = await page.evaluate(() => {
    const terminal = document.querySelector('.market-terminal').getBoundingClientRect()
    const layout = document.querySelector('.market-terminal-layout').getBoundingClientRect()
    const chart = document.querySelector('.market-chart-frame').getBoundingClientRect()
    const depth = document.querySelector('.market-depth-panel').getBoundingClientRect()
    const footer = document.querySelector('.site-footer').getBoundingClientRect()
    return {
      terminalWidth: terminal.width,
      viewportWidth: window.innerWidth,
      layoutHeight: layout.height,
      viewportHeight: window.innerHeight,
      chartBottom: chart.bottom,
      chartRight: chart.right,
      depthTop: depth.top,
      depthLeft: depth.left,
      depthBottom: depth.bottom,
      layoutBottom: layout.bottom,
      footerTop: footer.top,
      footerBottom: footer.bottom,
      scrollHeight: document.documentElement.scrollHeight,
      clientHeight: document.documentElement.clientHeight,
    }
  })

  expect(metrics.terminalWidth).toBeGreaterThan(1400)
  expect(metrics.layoutHeight).toBeGreaterThan(700)
  expect(metrics.layoutHeight).toBeLessThan(metrics.viewportHeight)
  expect(metrics.depthTop).toBeLessThan(metrics.viewportHeight)
  expect(metrics.chartRight).toBeLessThanOrEqual(metrics.depthLeft)
  expect(metrics.chartBottom).toBeLessThanOrEqual(metrics.layoutBottom)
  expect(metrics.depthBottom).toBeLessThanOrEqual(metrics.layoutBottom)
  expect(metrics.depthBottom).toBeLessThanOrEqual(metrics.footerTop + 1)
  expect(metrics.footerBottom).toBeLessThanOrEqual(metrics.viewportHeight + 1)
  expect(metrics.scrollHeight).toBeLessThanOrEqual(metrics.clientHeight + 1)
})

test('market terminal remains available and stacks the summary at tablet width', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global', sell_prices: ['130'], buy_prices: ['100'] }] })
    if (url.pathname.endsWith('/series/')) return json({ count: 1, points: [{ observed_at: freshSample, best_sell: '130', best_buy: '100' }], change: { best_sell: { absolute: null, percent: null }, best_buy: { absolute: null, percent: null } } })
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '测试舰船' })).toBeVisible()
  await expect(page.locator('.desktop-only-mask')).toBeHidden()
  await expect(page.getByRole('contentinfo').getByRole('link', { name: '粤ICP备2024264329号' })).toBeVisible()

  const boxes = await page.evaluate(() => {
    const layout = document.querySelector('.market-terminal-layout').getBoundingClientRect()
    const main = document.querySelector('.market-terminal-main').getBoundingClientRect()
    const summary = document.querySelector('.market-terminal-summary').getBoundingClientRect()
    return { layout, main, summary, scrollWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth }
  })
  expect(Math.abs(boxes.summary.x - boxes.layout.x)).toBeLessThanOrEqual(2)
  expect(Math.abs(boxes.summary.width - boxes.layout.width)).toBeLessThanOrEqual(2)
  expect(boxes.summary.y).toBeGreaterThanOrEqual(boxes.main.bottom - 1)
  expect(boxes.scrollWidth).toBeLessThanOrEqual(boxes.viewportWidth)
})

test('trend supports ranges, independent legends, keyboard detail and breaks missing price segments', async ({ page }) => {
  const requests = []
  await installApiMock(page, ({ url }) => {
    requests.push(`${url.pathname}${url.search}`)
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global' }] })
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 5, points: [
      { observed_at: '2026-09-22T00:00:00Z', best_sell: '100', best_buy: '80' },
      { observed_at: '2026-09-22T01:00:00Z', best_sell: '110', best_buy: '85' },
      { observed_at: '2026-09-22T02:00:00Z', best_sell: null, best_buy: '90' },
      { observed_at: '2026-09-22T03:00:00Z', best_sell: '120', best_buy: '95' },
      { observed_at: '2026-09-22T04:00:00Z', best_sell: '130', best_buy: '100' },
    ], change: { best_sell: { absolute: '30', percent: '30' }, best_buy: { absolute: '20', percent: '25' } } })
    return undefined
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-path--sell')).toHaveCount(2)
  await expect(page.locator('.market-trend-path--buy')).toHaveCount(1)
  await page.getByRole('button', { name: '隐藏卖价曲线' }).click()
  await expect(page.locator('.market-trend-path--sell')).toHaveCount(0)
  await expect(page.locator('.market-trend-path--buy')).toHaveCount(1)
  await page.getByRole('button', { name: '显示卖价曲线' }).click()
  await page.getByRole('button', { name: '7 天' }).click()
  await expect.poll(() => requests.some(value => value.includes('/series/?days=7'))).toBeTruthy()
  await page.getByRole('button', { name: '30 天' }).click()
  await expect.poll(() => requests.some(value => value.includes('/series/?days=30'))).toBeTruthy()
  await page.getByRole('button', { name: '24 小时' }).click()
  await expect.poll(() => requests.some(value => value.includes('/series/?days=1'))).toBeTruthy()
  await page.locator('.market-trend-panel--sell').getByRole('button', { name: /卖价第 3 次观测/ }).focus()
  await expect(page.getByRole('status', { name: '当前观测报价' })).toContainText('暂无报价')
  await expect(page.getByRole('table', { name: '走势图数据' })).toContainText('暂无报价')
})

test('chart hover details stay readable and keyboard reachable inside the framed terminal', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '巡洋舰', category_id: 1000, best_sell: '130', best_buy: '100', observed_at: freshSample, status: 'fresh', scope: 'global' }] })
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 2, points: [
      { observed_at: oldSample, best_sell: '120', best_buy: '90' },
      { observed_at: freshSample, best_sell: '130', best_buy: '100' },
    ], change: { best_sell: { absolute: '10', percent: '8.3' }, best_buy: { absolute: '10', percent: '11.1' } } })
    return undefined
  })

  await page.goto('/market')
  await expect(page.locator('.market-trend-panel--sell .market-trend-svg')).toBeVisible()
  const target = page.locator('.market-trend-panel--sell').getByRole('button', { name: '卖价第 2 次观测' })
  await expect(target).toHaveAttribute('tabindex', '0')
  await target.hover()
  await expect(page.locator('.market-trend-tooltip')).toBeVisible()
  await target.focus()
  await expect(page.locator('.market-trend-tooltip')).toBeVisible()
  await expect(page.locator('.market-trend-tooltip')).toContainText('最低卖价')
  await expect(page.locator('.market-trend-tooltip')).toContainText('最高买价')
  await expect(page.getByRole('status', { name: '当前观测报价' })).toBeVisible()

  const frame = await page.locator('.market-terminal-layout').boundingBox()
  expect(frame.x).toBeGreaterThan(0)
  expect(frame.width).toBeLessThan(1920)
})

test('a single observed sample shows insufficient change without inventing a trend', async ({ page }) => {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 'other', label: '其他', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '孤立报价', category: '', best_sell: null, best_buy: '19.25', observed_at: freshSample, status: 'fresh', scope: 'global' }] })
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 1, points: [{ observed_at: freshSample, best_sell: null, best_buy: '19.25' }], change: { best_sell: { absolute: null, percent: null }, best_buy: { absolute: null, percent: null } } })
    return undefined
  })
  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '孤立报价' })).toBeVisible()
  await expect(page.getByText('样本不足').first()).toBeVisible()
  await expect(page.locator('.market-trend-path')).toHaveCount(0)
  await expect(page.getByText('19.25 ISK').first()).toBeVisible()
  await expect(page.getByText('暂无报价').first()).toBeVisible()
})

test('public market remains usable if collection API fails', async ({ page }) => {
  await installApiMock(page, ({ url }) => url.pathname === '/api/market/items/' ? json({ detail: 'collector offline' }, 503) : undefined)
  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '市场价格' })).toBeVisible()
  await expect(page.getByText(/价格暂时无法加载/)).toBeVisible()
})

test('market administration requires login and displays server permission denial', async ({ page }) => {
  await page.goto('/market/admin')
  await expect(page).toHaveURL(/\/login$/)

  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ url }) => url.pathname.startsWith('/api/market/admin/') ? json({ detail: '没有市场管理权限' }, 403) : undefined)
  await page.goto('/market/admin')
  await expect(page.getByRole('heading', { name: '市场采集管理' })).toBeVisible()
  await expect(page.getByText(/没有市场管理权限/)).toBeVisible()
  await expect(page.getByRole('button', { name: '立即采集' })).toHaveCount(0)
})

test('market administration becomes read-only after a write permission denial', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ method, url }) => {
    if (url.pathname === '/api/market/admin/config/') return method === 'PATCH' ? json({ detail: '没有修改权限' }, 403) : json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, next_run_at: null, session_status: 'unconfigured' })
    if (url.pathname === '/api/market/admin/items/') return json({ count: 0, results: [] })
    if (url.pathname === '/api/market/admin/runs/') return json({ count: 0, results: [] })
    return undefined
  })
  await page.goto('/market/admin')
  await expect(page.getByText('会话未配置')).toBeVisible()
  await page.getByRole('button', { name: '保存采集设置' }).click()
  await expect(page.getByRole('status')).toContainText('没有修改权限')
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '立即采集' })).toBeDisabled()
})

test('market administration searches the server catalog and enables a seeded item', async ({ page }) => {
  await seedAuthenticatedSession(page)
  const requests = []
  let enabled = false
  await installApiMock(page, ({ method, url, body }) => {
    requests.push({ method, path: url.pathname, search: url.search, body })
    if (url.pathname === '/api/market/admin/config/') return json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, session_status: 'ready', enabled_item_count: enabled ? 1 : 0, max_items_per_run: 40 })
    if (method === 'GET' && url.pathname === '/api/market/admin/items/') {
      const q = url.searchParams.get('q') || ''
      return json({ count: q === 'nomatch' ? 0 : q ? 51 : 5000, results: q === 'nomatch' ? [] : [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', enabled }] })
    }
    if (method === 'PATCH' && url.pathname === '/api/market/admin/items/1001/') {
      enabled = body.enabled
      return json({ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', enabled })
    }
    if (url.pathname === '/api/market/admin/runs/') return json({ count: 0, results: [] })
    return undefined
  })
  await page.goto('/market/admin')
  await expect(page.getByText('共 5000 件目录物品')).toBeVisible()
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('已停用')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('市场范围 8')
  await expect(page.locator('.market-capacity')).toContainText('当前启用 0 件')
  await page.getByRole('searchbox', { name: '搜索目录物品' }).fill('  测试 舰船  ')
  await expect.poll(() => requests.some(value => value.method === 'GET' && value.path === '/api/market/admin/items/' && value.search === '?q=%E6%B5%8B%E8%AF%95+%E8%88%B0%E8%88%B9&page=1')).toBeTruthy()
  await page.getByRole('button', { name: '下一页物品' }).click()
  await expect.poll(() => requests.some(value => value.method === 'GET' && value.search === '?q=%E6%B5%8B%E8%AF%95+%E8%88%B0%E8%88%B9&page=2')).toBeTruthy()
  await page.getByRole('searchbox', { name: '搜索目录物品' }).fill('1001')
  await expect.poll(() => requests.some(value => value.method === 'GET' && value.search === '?q=1001&page=1')).toBeTruthy()
  await page.getByRole('button', { name: '启用测试舰船' }).click()
  await expect.poll(() => requests.some(value => value.method === 'PATCH' && value.path === '/api/market/admin/items/1001/' && value.body.enabled === true)).toBeTruthy()
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('已启用')
  await expect(page.locator('.market-capacity')).toContainText('当前启用 1 件')
  await page.getByRole('searchbox', { name: '搜索目录物品' }).fill('nomatch')
  await expect(page.getByText('没有找到目录物品')).toBeVisible()
})

test('market administration edits schedule, catalog and runs collection', async ({ page }) => {
  await seedAuthenticatedSession(page)
  const requests = []
  let enabledItemCount = 1
  await installApiMock(page, ({ method, url, body }) => {
    requests.push({ method, path: url.pathname, search: url.search, body })
    if (method === 'GET' && url.pathname === '/api/market/admin/config/') {
      return json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, next_run_at: '2026-09-24T07:30:00Z', last_success_at: '2026-09-23T07:30:00Z', last_run_failure_count: 1, session_status: 'ready', enabled_item_count: enabledItemCount, max_items_per_run: 40 })
    }
    if (method === 'PATCH' && url.pathname === '/api/market/admin/config/') return json(body)
    if (method === 'GET' && url.pathname === '/api/market/admin/items/') {
      return json({ count: 51, results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', enabled: true, last_error: 'timeout' }] })
    }
    if (method === 'POST' && url.pathname === '/api/market/admin/items/') { enabledItemCount += 1; return json({ ...body, enabled: true }, 201) }
    if (method === 'PATCH' && url.pathname === '/api/market/admin/items/1001/') { enabledItemCount -= 1; return json({ item_id: '1001', enabled: false }) }
    if (method === 'GET' && url.pathname === '/api/market/admin/runs/') {
      return json({ count: 1, results: [{ id: 9, status: 'failed', trigger: 'scheduled', started_at: '2026-09-24T06:30:00Z', finished_at: '2026-09-24T06:35:00Z', success_count: 0, failure_count: 1, error_code: 'NEEDS_AUTH' }] })
    }
    if (method === 'POST' && url.pathname === '/api/market/admin/run/') return json({ id: 10, status: 'pending' }, 202)
    return undefined
  })

  await page.goto('/market/admin')
  await expect(page.getByRole('heading', { name: '市场采集管理' })).toBeVisible()
  await expect(page.getByText('会话就绪')).toBeVisible()
  await expect(page.locator('.market-status-strip strong').nth(1)).toContainText('2026')
  await expect(page.getByText('timeout')).toBeVisible()
  await expect(page.getByText('NEEDS_AUTH')).toBeVisible()
  await expect(page.getByRole('row', { name: /NEEDS_AUTH/ })).toContainText('定时')
  await expect(page.locator('.market-capacity')).toContainText('当前启用 1 件')
  await page.getByLabel('最短间隔（分钟）').fill('36')
  await page.getByLabel('最长间隔（分钟）').fill('50')
  await page.getByRole('button', { name: '保存采集设置' }).click()
  await expect.poll(() => requests.find(value => value.method === 'PATCH' && value.path === '/api/market/admin/config/')?.body).toEqual({ enabled: true, min_interval_seconds: 2160, max_interval_seconds: 3000 })

  await page.getByText('目录中没有？手动添加物品').click()
  await page.getByLabel('物品 ID').fill('2002')
  await page.getByLabel('物品名称').fill('测试模块')
  await page.getByLabel('物品类别').fill('装备')
  await page.getByLabel('市场范围').selectOption('global')
  await page.getByRole('button', { name: '添加采集物品' }).click()
  await expect.poll(() => requests.find(value => value.method === 'POST' && value.path === '/api/market/admin/items/')?.body).toEqual({ item_id: '2002', name: '测试模块', category: '装备', scope: 'global', enabled: true })
  await expect(page.locator('.market-capacity')).toContainText('当前启用 2 件')
  await page.getByRole('button', { name: '停用测试舰船' }).click()
  await expect.poll(() => requests.find(value => value.method === 'PATCH' && value.path === '/api/market/admin/items/1001/')?.body).toEqual({ enabled: false })
  await expect(page.locator('.market-capacity')).toContainText('当前启用 1 件')
  await page.getByRole('button', { name: '立即采集' }).click()
  await expect.poll(() => requests.some(value => value.method === 'POST' && value.path === '/api/market/admin/run/')).toBeTruthy()
  await page.getByRole('button', { name: '下一页物品' }).click()
  await expect.poll(() => requests.some(value => value.method === 'GET' && value.path === '/api/market/admin/items/' && value.search === '?page=2')).toBeTruthy()
})

test('market price and admin layouts do not overflow a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '987654321012345678.90', best_buy: '90', observed_at: new Date().toISOString(), status: 'fresh' }] })
    if (url.pathname === '/api/market/admin/config/') return json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, next_due_at_ms: Date.now() + 2100000, session_status: 'ready', enabled_item_count: 121, max_items_per_run: 40 })
    if (url.pathname === '/api/market/admin/items/') return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', enabled: true }] })
    if (url.pathname === '/api/market/admin/runs/') return json({ count: 0, results: [] })
    return undefined
  })
  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '市场价格' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.goto('/market/admin')
  await expect(page.getByRole('heading', { name: '市场采集管理' })).toBeVisible()
  await expect(page.locator('.market-capacity.critical')).toContainText('140–204 分钟')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('stale status and relative sample age stay on single lines at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiMock(page, ({ url }) => url.pathname === '/api/market/categories/' ? json([{ id: 1000, label: '舰船', count: 1 }]) : url.pathname === '/api/market/items/' ? json({
    count: 1,
    results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '987654321012345678.90', best_buy: null, observed_at: new Date(Date.now() - 86400000).toISOString(), status: 'stale' }],
  }) : undefined)
  await page.goto('/market')

  const status = page.locator('.market-choice-status.warning')
  const age = page.locator('.market-sample-age')
  await expect(status).toHaveText('已过期')
  await expect(age).toContainText('天前')
  expect((await status.boundingBox()).height).toBeLessThanOrEqual(28)
  expect((await age.boundingBox()).height).toBeLessThanOrEqual(20)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})

test('admin capacity estimate warns at 81 and 121 enabled items without blocking controls', async ({ page }) => {
  await seedAuthenticatedSession(page)
  let enabledCount = 80
  let includeCapacity = true
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/admin/config/') return json({
      enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, session_status: 'ready',
      ...(includeCapacity ? { enabled_item_count: enabledCount, max_items_per_run: 40 } : {}),
    })
    if (url.pathname === '/api/market/admin/items/' || url.pathname === '/api/market/admin/runs/') return json({ count: 0, results: [] })
    return undefined
  })

  await page.goto('/market/admin')
  await expect(page.locator('.market-capacity')).toContainText('当前启用 80 件')
  await expect(page.locator('.market-capacity')).toContainText('轮转重访同一物品约需 2 次采集')
  await expect(page.locator('.market-capacity')).toContainText('70–102 分钟')
  await expect(page.locator('.market-capacity')).not.toContainText('2 小时')

  enabledCount = 81
  await page.reload()
  await expect(page.locator('.market-capacity')).toContainText('105–153 分钟')
  await expect(page.locator('.market-capacity')).toContainText('最长可能超过 2 小时')
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeEnabled()

  enabledCount = 121
  await page.reload()
  await expect(page.locator('.market-capacity')).toContainText('140–204 分钟')
  await expect(page.locator('.market-capacity')).toContainText('即使按最短间隔也超过 2 小时')
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeEnabled()

  includeCapacity = false
  await page.reload()
  await expect(page.locator('.market-capacity')).toHaveCount(0)
})

test('visible market terminal refreshes every two minutes', async ({ page }) => {
  await page.clock.install()
  let listRequests = 0
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1000, label: '舰船', count: 1 }])
    if (url.pathname === '/api/market/items/') {
      listRequests += 1
      return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '123', best_buy: null, observed_at: new Date().toISOString(), status: 'fresh' }] })
    }
    if (url.pathname === '/api/market/items/1001/series/') return json({ count: 0, points: [], change: { best_buy: { absolute: null, percent: null }, best_sell: { absolute: null, percent: null } } })
    return undefined
  })
  await page.goto('/market')
  await expect(page.getByRole('button', { name: /测试舰船/ })).toBeVisible()
  const listBeforeRefresh = listRequests
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
  await page.clock.fastForward(120000)
  await expect.poll(() => listRequests).toBeGreaterThan(listBeforeRefresh)
})

test('visible admin configuration and run status refresh every two minutes', async ({ page }) => {
  await page.clock.install()
  await seedAuthenticatedSession(page)
  let configRequests = 0
  let runRequests = 0
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/admin/config/') {
      configRequests += 1
      return json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, session_status: 'ready' })
    }
    if (url.pathname === '/api/market/admin/runs/') {
      runRequests += 1
      return json({ count: 0, results: [] })
    }
    if (url.pathname === '/api/market/admin/items/') return json({ count: 0, results: [] })
    return undefined
  })
  await page.goto('/market/admin')
  await expect(page.getByRole('heading', { name: '采集任务' })).toBeVisible()
  await expect.poll(() => configRequests).toBeGreaterThan(0)
  await expect.poll(() => runRequests).toBeGreaterThan(0)
  const configBeforeRefresh = configRequests
  const runsBeforeRefresh = runRequests
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
  await page.clock.fastForward(120000)
  await expect.poll(() => configRequests).toBeGreaterThan(configBeforeRefresh)
  await expect.poll(() => runRequests).toBeGreaterThan(runsBeforeRefresh)
})
