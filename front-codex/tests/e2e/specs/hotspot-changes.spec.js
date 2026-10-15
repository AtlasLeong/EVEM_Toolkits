import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { createFakeJwt, seedAuthenticatedSession } from '../helpers/auth'

const start = Date.UTC(2026, 9, 15, 1)
const interval = (id, end = start + 25 * 60_000) => ({ id, start_at_ms: start, end_at_ms: end, elapsed_ms: end - start })
const deltaRow = (id, delta, name) => ({ solar_system_id: id, system_name: name, previous_destroy_num: 20,
  destroy_num: 20 + delta, delta, region_id: 10, region_name: '测试区域' })
const privateData = { version: 1, status: 'ok', statistics_window: null, interval: interval(3000),
  coverage: { comparable: 2, new: 1, missing: 2, negative: 3, unchanged: 0 },
  systems: [deltaRow(2, 80, '私密贝塔'), deltaRow(1, 90, '私密阿尔法'), deltaRow(3, -10, '回落星系'), deltaRow(4, 0, '未变星系')],
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
    if (url.pathname === '/api/anomaly-hotspots/') return json({ version: 1, collected_at_ms: start, last_attempt_at_ms: start,
      status: 'ok', statistics_window: null, systems: [{ solar_system_id: 1, destroy_num: 50, system_name: '公开星系', region_id: 10, region_name: '测试区域' }] })
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

for (const role of ['guest', 'ordinary']) test(`${role} 只看到总量且不请求私有榜`, async ({ page }) => {
  const requests = await setup(page, { role })
  await page.goto('/starmap')
  await expect(panelFor(page)).toContainText('公开星系')
  await expect(panelFor(page).getByRole('tab', { name: '变化', exact: true })).toHaveCount(0)
  await expect(page.getByRole('link', { name: '管理中心', exact: true })).toHaveCount(0)
  expect(requests.some(path => path.includes('/changes/'))).toBe(false)
})

test('授权私榜正增长排序、搜索、历史分页与历史星系定位不重置相机', async ({ page }) => {
  const requests = await setup(page, { api: ({ url }) => {
    if (url.pathname !== '/api/anomaly-hotspots/changes/') return undefined
    if (url.searchParams.has('before')) return json({ ...privateData, intervals: [interval(1000)], next_before: null })
    if (url.searchParams.get('interval') === '1000') return json({ ...privateData, interval: interval(1000), systems: [deltaRow(2, 44, '历史私密贝塔')] })
    return json(privateData)
  } })
  await page.goto('/starmap')
  const panel = panelFor(page)
  await panel.getByRole('tab', { name: '变化', exact: true }).click()
  await expect(panel.locator('.anomaly-hotspots-row').first()).toContainText('私密阿尔法')
  await expect(panel).toContainText('25 分钟')
  await expect(panel).toContainText('20 → 110')
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
