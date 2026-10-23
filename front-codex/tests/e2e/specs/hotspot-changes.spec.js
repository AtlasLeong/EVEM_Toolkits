import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { createFakeJwt, seedAuthenticatedSession } from '../helpers/auth'
import { formatAnomalyUpdatedAt } from '../../../src/utils/anomalyHotspots.js'

const start = Date.UTC(2026, 9, 15, 1)
const interval = (id, end = start + 25 * 60_000) => ({ id, start_at_ms: start, end_at_ms: end, elapsed_ms: end - start })
const metric = { kind: 'activity_level', range_version: 1 }
const deltaRow = (id, delta, name) => ({ solar_system_id: id, system_name: name, previous_destroy_num: 1,
  destroy_num: 1 + delta, delta, region_id: 10, region_name: '测试区域' })
const privateData = { version: 2, metric, status: 'ok', statistics_window: null, interval: interval(3000),
  coverage: { comparable: 2, new: 1, missing: 2, negative: 3, unchanged: 0 },
  systems: [deltaRow(2, 3, '私密贝塔'), deltaRow(1, 4, '私密阿尔法'), deltaRow(3, -1, '回落星系'), deltaRow(4, 0, '未变星系')],
  intervals: [interval(3000), interval(2000)], next_before: 2000 }
const user = { id: 2, username: '获准用户', email: 'viewer@example.com', grant: { enabled: false, version: 0 } }
async function setup(page, { role = 'viewer', changes, api } = {}) {
  if (role !== 'guest') await seedAuthenticatedSession(page, { user_id: role === 'owner' ? 1 : 2 })
  const requests = []
  await installApiMock(page, async context => {
    const { url, method, body } = context
    requests.push(url.pathname + url.search)
    const custom = await api?.(context)
    if (custom !== undefined) return custom
    if (url.pathname === '/api/control-center/access/') return json({ can_manage: role === 'owner', can_view_hotspot_changes: ['viewer', 'owner'].includes(role) })
    if (url.pathname === '/api/anomaly-hotspots/changes/') return typeof changes === 'function' ? changes(context) : json(changes || privateData)
    if (url.pathname === '/api/anomaly-hotspots/') return json({ version: 2, metric, collected_at_ms: start, last_attempt_at_ms: start,
      status: 'ok', statistics_window: null, systems: [{ solar_system_id: 1, destroy_num: 3, system_name: '公开星系', region_id: 10, region_name: '测试区域' }] })
    if (url.pathname === '/api/boardsystems') return json([{ system_id: 1, zh_name: '阿尔法', en_name: 'ALPHA-1', x: 0, y: 0, z: 0, security_status: .5 },
      { system_id: 2, zh_name: '贝塔', en_name: 'BETA-2', x: 9.461e15, y: 0, z: 0, security_status: .1 }])
    if (url.pathname === '/api/boardregions') return json([{ region_id: 10, zh_name: '测试区域' }])
    if (url.pathname === '/api/boardconstellations' || url.pathname === '/api/boardstargate') return json([])
    if (url.pathname === '/api/control-center/users/') return json({ results: [user] })
    if (url.pathname === '/api/control-center/grants/' && method === 'GET') return json({ results: [{ ...user, grant: { enabled: true, version: 1 } }], next_before: null })
    if (url.pathname === '/api/control-center/grants/2/' && method === 'PUT') return json({ ...user, grant: { enabled: body.enabled, version: body.version + 1 } })
    if (url.pathname === '/api/control-center/audit/') return json({ results: [{ id: 1, actor: { id: 1, username: '管理员' }, target: { id: 2, username: '获准用户' },
      before: { enabled: false, version: 0 }, after: { enabled: true, version: 1 }, reason: '测试授权', created_at: '2026-10-15T01:00:00Z', request_id: 'safe-id' }], next_before: null })
    if (url.pathname === '/api/control-center/overview/') return json({ collection: { status: 'ok', collected_at_ms: start, last_attempt_at_ms: start,
      system_count: 2142, history_status: 'ok', latest_interval: interval(3000), attempts: [{ at_ms: start, status: 'network_error', system_count: 0, reason: 'network_error' }] },
      modules: [{ key: 'market', label: '市场管理', path: '/market/admin', allowed: true }, { key: 'license', label: '许可管理', path: '/licenseadmin', allowed: false }] })
    if (url.pathname === '/api/killboard/access/') return json({ enabled: false, can_view: false })
    if (url.pathname === '/api/tactical/usage/access/') return json({ can_view_usage: false })
  })
  return requests
}
const panelFor = (page, mobile = false) => page.locator(mobile ? '.anomaly-hotspots-mobile' : '.anomaly-hotspots-map-overlay').getByRole('region', { name: '犁地热点排行榜' })
async function installPollProbe(page) {
  await page.addInitScript(() => {
    const originalSet = window.setInterval.bind(window), originalClear = window.clearInterval.bind(window)
    const polls = new Map()
    window.setInterval = (callback, delay, ...args) => {
      const id = originalSet(callback, delay, ...args)
      if (delay === 30_000) polls.set(id, () => callback(...args))
      return id
    }
    window.clearInterval = id => { polls.delete(id); return originalClear(id) }
    window.__runControlPolls = () => [...polls.values()].forEach(callback => callback())
  })
}

for (const role of ['guest', 'ordinary']) test(`${role} 只看到热度且不请求私有榜`, async ({ page }) => {
  const requests = await setup(page, { role })
  await page.goto('/starmap')
  await expect(panelFor(page)).toContainText('公开星系')
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '管理中心', exact: true })).toHaveCount(0)
  expect(requests.some(path => path.includes('/changes/'))).toBe(false)
})

test('授权私榜等级上升排序、搜索、历史分页与历史星系定位不重置相机', async ({ page }) => {
  const requests = await setup(page, { api: ({ url }) => {
    if (url.pathname !== '/api/anomaly-hotspots/changes/') return undefined
    if (url.searchParams.has('before')) return json({ ...privateData, intervals: [interval(1000)], next_before: null })
    if (url.searchParams.get('interval') === '1000') return json({ ...privateData, interval: interval(1000), systems: [deltaRow(2, 2, '历史私密贝塔')] })
    return json(privateData)
  } })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel.locator('.anomaly-hotspots-row').first()).toContainText('私密阿尔法')
  await expect(panel).toContainText('25 分钟')
  await expect(panel).toContainText('1级 → 5级')
  await expect(panel).toContainText('升4级')
  await expect(panel).not.toContainText('净增量')
  await expect(panel).not.toContainText('回落星系')
  await expect(panel).not.toContainText('未变星系')
  const camera = await page.locator('.tactical-map-hud').textContent()
  const staticCalls = requests.filter(path => path.includes('/board')).length
  await panel.getByRole('searchbox', { name: '变化榜内搜索' }).fill('私密贝塔')
  await expect(panel.locator('.anomaly-hotspots-row')).toHaveCount(1)
  await expect(page.locator('.tactical-map-hud')).toHaveText(camera)
  await panel.getByRole('button', { name: '清空变化榜搜索' }).click()
  await panel.getByRole('button', { name: '加载更早区间' }).click()
  await expect(panel.getByRole('combobox')).toContainText('2026/10/15 09:25:00')
  await panel.getByRole('combobox').selectOption('1000')
  await expect(panel).toContainText('历史私密贝塔')
  const locate = panel.getByRole('button', { name: /定位星系 历史私密贝塔/ })
  await expect(locate).toBeEnabled()
  await locate.click()
  await expect(page.locator('.tactical-system-head strong')).toHaveText('贝塔')
  expect(requests.filter(path => path.includes('/board')).length).toBe(staticCalls)
})

test('历史分页503只警告不抹掉有效区间，同一cursor可直接重试成功', async ({ page }) => {
  const cursors = []
  await setup(page, { api: ({ url }) => {
    if (url.pathname !== '/api/anomaly-hotspots/changes/' || !url.searchParams.has('before')) return undefined
    cursors.push(url.searchParams.get('before'))
    return cursors.length === 1 ? json({ detail: 'temporary private failure' }, 503)
      : json({ ...privateData, intervals: [interval(1000)], next_before: null })
  } })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel).toContainText('私密阿尔法')
  await panel.getByRole('button', { name: '加载更早区间', exact: true }).click()
  await expect(panel.getByRole('alert')).toContainText('历史区间加载失败')
  await expect(panel).toContainText('私密阿尔法')
  await expect(panel).not.toContainText('变化榜暂时无法读取')
  await panel.getByRole('button', { name: /加载更早区间/ }).click()
  await expect(panel.getByRole('combobox').locator('option[value="1000"]')).toHaveCount(1)
  await expect(panel.getByRole('alert')).toHaveCount(0)
  expect(cursors).toEqual(['2000', '2000'])
})

test('混合口径历史区间保留时间和选择器但不伪造数量变化榜', async ({ page }) => {
  await setup(page, { api: ({ url }) => url.pathname === '/api/anomaly-hotspots/changes/' && url.searchParams.get('interval') === '2000'
    ? json({ ...privateData, metric: { kind: 'legacy_unclassified', range_version: null }, status: 'incomparable',
      interval: interval(2000), systems: [], coverage: { comparable: 0, new: 0, missing: 0, negative: 0, unchanged: 0 } }) : undefined })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel).toContainText('升4级')
  await panel.getByRole('combobox').selectOption('2000')
  await expect(panel).toContainText('口径不兼容')
  await expect(panel).toContainText('实际间隔 25 分钟')
  await expect(panel.locator('.anomaly-hotspots-row')).toHaveCount(0)
  await expect(panel.getByRole('combobox')).toBeVisible()
  await expect(panel).not.toContainText('净增量')
})

test('最新区间陈旧可见但选择历史区间不误报当前采集延迟', async ({ page }) => {
  const end = Date.now() - 21 * 60_000
  await setup(page, { changes: { ...privateData, interval: { id: 3000, start_at_ms: end - 25 * 60_000, end_at_ms: end, elapsed_ms: 25 * 60_000 } } })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel).toContainText('最新区间已超过 20 分钟未更新')
  await expect(panel.locator('.anomaly-hotspots-updated')).toContainText(formatAnomalyUpdatedAt(end))
  await panel.getByRole('combobox').selectOption('2000')
  await expect(panel).toContainText('私密阿尔法')
  await expect(panel).not.toContainText('最新区间已超过 20 分钟未更新')
})

test('403 撤权清除私榜并阻止稍后 capability 成功恢复入口', async ({ page }) => {
  let denied = false
  await setup(page, { changes: () => denied ? json({ detail: 'secret' }, 403) : json(privateData) })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel).toContainText('私密阿尔法')
  denied = true
  await panel.getByRole('combobox').selectOption('2000')
  await expect(panel.getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('私密阿尔法')
  await page.evaluate(() => { window.dispatchEvent(new Event('focus')) })
  await expect(panel.getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
})

test('200 能力撤权取消旧私榜请求且后续成功能力不能恢复访问', async ({ page }) => {
  await installPollProbe(page)
  let accessCalls = 0, privateStarted = false, release
  const gate = new Promise(resolve => { release = resolve })
  await setup(page, { api: async ({ url }) => {
    if (url.pathname === '/api/control-center/access/') {
      accessCalls += 1
      return json({ can_manage: false, can_view_hotspot_changes: accessCalls !== 2 })
    }
    if (url.pathname === '/api/anomaly-hotspots/changes/') { privateStarted = true; await gate; return json(privateData) }
  } })
  await page.goto('/starmap')
  await panelFor(page).getByRole('tab', { name: '变化', exact: true }).click()
  await expect.poll(() => privateStarted).toBe(true)
  await page.evaluate(() => window.__runControlPolls())
  await expect.poll(() => accessCalls).toBeGreaterThanOrEqual(2)
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  release()
  await page.evaluate(() => window.__runControlPolls())
  await expect.poll(() => accessCalls).toBe(2)
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('私密阿尔法')
})

test('初始普通账号可以在下一次能力检查发现新授权', async ({ page }) => {
  await installPollProbe(page)
  let granted = false
  await setup(page, { role: 'ordinary', api: ({ url }) => url.pathname === '/api/control-center/access/'
    ? json({ can_manage: false, can_view_hotspot_changes: granted }) : undefined })
  await page.goto('/starmap')
  await expect(panelFor(page)).toContainText('公开星系')
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  granted = true
  await page.evaluate(() => window.__runControlPolls())
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toBeVisible()
})

for (const width of [1440, 800, 390]) test(`变化榜 ${width}px 不溢出且移动端不含定位`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 })
  await setup(page)
  await page.goto('/starmap')
  const panel = panelFor(page, width < 768)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel).toContainText('私密阿尔法')
  expect(await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  if (width < 768) await expect(panel.getByRole('button', { name: /定位星系/ })).toHaveCount(0)
  await page.screenshot({ path: test.info().outputPath(`changes-${width}.png`), fullPage: true })
})

test('管理中心仅服务器确认的 owner 可见，精确搜索、授权与审计集中展示', async ({ page }) => {
  const requests = await setup(page, { role: 'owner' })
  await page.goto('/admin-console')
  await expect(page.getByRole('heading', { name: '管理中心', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '市场管理', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: '许可管理', exact: true })).toHaveCount(0)
  await page.getByRole('searchbox', { name: '完整邮箱或用户 ID' }).fill('viewer@example.com')
  await page.getByRole('button', { name: '精确查询', exact: true }).click()
  await expect(page.getByRole('region', { name: '用户查询结果' })).toContainText('viewer@example.com')
  await page.getByRole('region', { name: '用户查询结果' }).getByRole('button', { name: '授予查看权限' }).click()
  await expect(page.getByRole('status').filter({ hasText: '权限已更新' })).toBeVisible()
  await expect(page).toHaveTitle('管理中心 · EVEM 工具箱')
  await expect(page.getByRole('region', { name: '权限操作审计' })).toContainText('测试授权')
  expect(requests.some(path => path.includes('/users/?q=viewer%40example.com'))).toBe(true)
})

test('授权幂等返回同一版本时明确提示没有发生重复更新', async ({ page }) => {
  await setup(page, { role: 'owner', api: ({ url, method, body }) => url.pathname === '/api/control-center/grants/2/' && method === 'PUT'
    ? json({ ...user, grant: { enabled: body.enabled, version: body.version } }) : undefined })
  await page.goto('/admin-console')
  await page.getByRole('searchbox', { name: '完整邮箱或用户 ID' }).fill('viewer@example.com')
  await page.getByRole('button', { name: '精确查询', exact: true }).click()
  await page.getByRole('region', { name: '用户查询结果' }).getByRole('button', { name: '授予查看权限' }).click()
  await expect(page.getByRole('status').filter({ hasText: '权限未变化，无需重复更新' })).toBeVisible()
})

for (const width of [390, 800]) test(`管理中心 ${width}px 长邮箱、流水与审计仅表格自身横滚`, async ({ page }) => {
  await page.setViewportSize({ width, height: 960 })
  const longName = '管理员名称'.repeat(20)
  await setup(page, { role: 'owner', api: ({ url }) => {
    if (url.pathname === '/api/control-center/grants/') return json({ results: [{ ...user,
      username: longName, email: `${'long-email-address-'.repeat(10)}@example.com`, grant: { enabled: true, version: 1 } }], next_before: null })
    if (url.pathname === '/api/control-center/audit/') return json({ results: [{ id: 1,
      actor: { id: 1, username: longName }, target: { id: 2, username: longName },
      before: { enabled: false, version: 0 }, after: { enabled: true, version: 1 }, reason: '无空格的长审计原因'.repeat(50),
      created_at: '2026-10-15T09:00:00+08:00', request_id: 'safe-id' }], next_before: null })
  } })
  await page.goto('/admin-console')
  await expect(page.getByRole('region', { name: '采集状态与失败记录' })).toContainText('网络失败')
  await expect(page.getByRole('region', { name: '权限操作审计' })).toContainText(longName)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  const geometry = await page.locator('.admin-console').evaluate(element => {
    const bounds = node => { const rect = node.getBoundingClientRect(); return { left: rect.left, right: rect.right } }
    return { root: bounds(element), cards: [...element.querySelectorAll('.admin-console-section, .admin-console-stats > div, .admin-console-modules > a')].map(bounds),
      tables: [...element.querySelectorAll('.admin-console-table-wrap')].map(node => ({ ...bounds(node), overflow: getComputedStyle(node).overflowX,
        clientWidth: node.clientWidth, scrollWidth: node.scrollWidth })) }
  })
  for (const box of [geometry.root, ...geometry.cards, ...geometry.tables]) {
    expect(box.left).toBeGreaterThanOrEqual(0)
    expect(box.right).toBeLessThanOrEqual(width)
  }
  for (const table of geometry.tables) {
    expect(table.overflow).toBe('auto')
    if (width === 390) expect(table.scrollWidth).toBeGreaterThan(table.clientWidth)
  }
  await page.screenshot({ path: test.info().outputPath(`admin-${width}.png`), fullPage: true })
})

test('普通账号直达管理中心不请求管理数据', async ({ page }) => {
  const requests = await setup(page, { role: 'ordinary' })
  await page.goto('/admin-console')
  await expect(page.getByRole('alert')).toContainText('没有管理中心权限')
  expect(requests.some(path => /\/control-center\/(users|overview|grants|audit)\//.test(path))).toBe(false)
})

test.describe('管理流水与无时区历史日期', () => {
  test.use({ timezoneId: 'America/New_York' })
  test('200 条真实流水保留每次历史写入失败与安全超时原因，审计按上海日期显示', async ({ page }) => {
    await setup(page, { role: 'owner', api: ({ url }) => {
      if (url.pathname === '/api/control-center/overview/') return json({ collection: { status: 'ok', collected_at_ms: start,
        last_attempt_at_ms: start, system_count: 2142, history_status: 'ok', latest_interval: interval(3000),
        attempts: Array.from({ length: 200 }, (_, index) => ({ at_ms: start + index, status: 'ok', system_count: 2142,
          history_status: 'unavailable', stage: 'statistics', reason: 'timeout' })) }, modules: [] })
      if (url.pathname === '/api/control-center/audit/') return json({ results: [{ id: 1, actor: { id: 1, username: '管理员' }, target: { id: 2, username: '获准用户' },
        before: { enabled: false, version: 0 }, after: { enabled: true, version: 1 }, reason: '时区测试', created_at: '2026-10-15T09:00:00', request_id: 'safe-id' }], next_before: null })
    } })
    await page.goto('/admin-console')
    const collection = page.getByRole('region', { name: '采集状态与失败记录' })
    await expect(collection.getByRole('row')).toHaveCount(201)
    await expect(collection.getByRole('cell', { name: /历史写入失败/ })).toHaveCount(200)
    await expect(collection.getByRole('cell', { name: /统计读取.*请求超时/ })).toHaveCount(200)
    await expect(page.getByRole('region', { name: '权限操作审计' })).toContainText('2026/10/15 09:00:00')
  })
})

test('切换账号时旧请求不能把私榜带入普通账号', async ({ page }) => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  await setup(page, { api: async ({ url, request }) => {
    const token = (await request.headerValue('authorization'))?.split(' ')[1]
    const id = token ? JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).user_id : null
    if (url.pathname === '/api/control-center/access/' && id === 3) return json({ can_manage: false, can_view_hotspot_changes: false })
    if (url.pathname === '/api/anomaly-hotspots/changes/') { await gate; return json(privateData) }
  } })
  await page.goto('/starmap')
  await panelFor(page).getByRole('tab', { name: '变化', exact: true }).click()
  const token = createFakeJwt({ user_id: 3 })
  await page.evaluate(token => { localStorage.setItem('access_token', token); localStorage.setItem('refresh_token', token); window.dispatchEvent(new Event('auth:changed')) }, token)
  release()
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText('私密阿尔法')
})
