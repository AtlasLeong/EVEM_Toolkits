import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const oldSample = '2026-09-23T08:00:00Z'
const freshSample = new Date().toISOString()

test('empty public catalog explains that collection items are not enabled', async ({ page }) => {
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') return json({ count: 0, results: [] })
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByText('管理员尚未启用采集物品。')).toBeVisible()
})

test('public market shows last known prices, missing sides, search and history', async ({ page }) => {
  const requests = []
  await installApiMock(page, ({ method, url }) => {
    requests.push(`${method} ${url.pathname}${url.search}`)
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      return json({ count: 4, results: [
        { item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '1234567.5', best_buy: null, observed_at: oldSample, status: 'stale' },
        { item_id: '1002', name: '未采集装备', category: '装备', scope: 'global', best_sell: null, best_buy: null, observed_at: null, status: 'uncollected' },
        { item_id: '1003', name: '高价舰船', category: '舰船', scope: 'global', best_sell: '987654321012345678.90', best_buy: null, observed_at: oldSample, status: 'stale' },
        { item_id: '1004', name: '暂无挂单物品', category: '装备', scope: 'global', best_sell: null, best_buy: null, observed_at: freshSample, status: 'empty' },
      ] })
    }
    if (method === 'GET' && url.pathname === '/api/market/items/1001/history/') {
      return json({ count: 51, results: [{ best_sell: '1200000', best_buy: '1100000', observed_at: oldSample }] })
    }
    return undefined
  })

  await page.goto('/market')
  await expect(page.getByRole('heading', { name: '市场价格' })).toBeVisible()
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('1,234,567.5')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('暂无报价')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('已过期')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('市场范围 8')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toContainText('2026')
  await expect(page.getByRole('row', { name: /未采集装备/ })).toContainText('尚未采集')
  await expect(page.getByRole('row', { name: /未采集装备/ })).not.toContainText('0 ISK')
  await expect(page.getByRole('row', { name: /暂无挂单物品/ }).getByText('暂无挂单', { exact: true })).toBeVisible()
  await expect(page.getByRole('row', { name: /高价舰船/ })).toContainText('987,654,321,012,345,678.90 ISK')
  await page.getByRole('searchbox', { name: '搜索物品' }).fill('测试')
  await expect.poll(() => requests.some(value => value.includes('q=%E6%B5%8B%E8%AF%95'))).toBeTruthy()
  await page.getByRole('button', { name: '查看测试舰船历史' }).click()
  await page.getByRole('button', { name: '7 天' }).click()
  await expect.poll(() => requests.some(value => value.includes('/1001/history/?days=7'))).toBeTruthy()
  await expect(page.getByText('1,200,000')).toBeVisible()
  await page.getByRole('button', { name: '下一页历史' }).click()
  await expect.poll(() => requests.some(value => value.includes('/1001/history/?days=7&page=2'))).toBeTruthy()
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
  await installApiMock(page, ({ url }) => url.pathname === '/api/market/items/' ? json({
    count: 1,
    results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '987654321012345678.90', best_buy: null, observed_at: new Date(Date.now() - 86400000).toISOString(), status: 'stale' }],
  }) : undefined)
  await page.goto('/market')

  const status = page.getByRole('row', { name: /测试舰船/ }).locator('.pill.warning')
  const age = page.getByRole('row', { name: /测试舰船/ }).locator('.market-sample-age')
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

test('visible market list refreshes every two minutes without polling history', async ({ page }) => {
  await page.clock.install()
  let listRequests = 0
  let historyRequests = 0
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/items/') {
      listRequests += 1
      return json({ count: 1, results: [{ item_id: '1001', name: '测试舰船', category: '舰船', scope: 'global', best_sell: '123', best_buy: null, observed_at: new Date().toISOString(), status: 'fresh' }] })
    }
    if (url.pathname === '/api/market/items/1001/history/') {
      historyRequests += 1
      return json({ count: 1, results: [{ best_sell: '123', best_buy: null, observed_at: new Date().toISOString() }] })
    }
    return undefined
  })
  await page.goto('/market')
  await expect(page.getByRole('row', { name: /测试舰船/ })).toBeVisible()
  await page.getByRole('button', { name: '查看测试舰船历史' }).click()
  await expect(page.locator('.market-history-entry')).toHaveCount(1)
  const listBeforeRefresh = listRequests
  const historyBeforeRefresh = historyRequests
  expect(await page.evaluate(() => document.visibilityState)).toBe('visible')
  await page.clock.fastForward(120000)
  await expect.poll(() => listRequests).toBeGreaterThan(listBeforeRefresh)
  expect(historyRequests).toBe(historyBeforeRefresh)
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
