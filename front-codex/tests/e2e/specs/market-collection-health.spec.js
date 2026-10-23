import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const now = Date.parse('2026-10-23T14:00:00Z')
const tier = (enabled, observed, within) => ({ enabled, observed, usable: observed, within_two_hours: within, usable_within_two_hours: within,
  within_target: within, target_ms: 7_200_000, age_median_ms: 7_260_000, age_p95_ms: 9_000_000, max_age_ms: 10_800_000 })
const health = {
  generated_at_ms: now,
  tiers: { priority: tier(4, 3, 2), ordinary: { ...tier(145, 140, 100), target_ms: 21_600_000, within_target: 140 } },
  actual_plan: { item_limit: 40, expected_count: 40, planned_at_ms: now - 3_600_000, stale: false },
  throughput: { success_count: 75, elapsed_ms: 7_200_000, per_hour: 37.5, start_at_ms: now - 7_200_000, end_at_ms: now, run_count: 2 },
  capacity: { estimated_items_per_hour: 45, priority_slots: 20, ordinary_slots: 20, priority_target_feasible: true,
    ordinary_target_feasible: false, warnings: ['ordinary_target_infeasible'] },
  pause: { code: 'invalid_material', retry_at_ms: null, last_attempt_at_ms: now - 1000 }, pool_state: 'unknown',
}

async function openAdmin(page, { denied = false, value = health, visibleLimit = 40 } = {}) {
  const item = { item_id: '42', name: '测试材料', category: '矿石', scope: 'global', enabled: true, collection_priority: false, last_failure: null }
  const state = { patches: [], item }
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ method, url, body }) => {
    if (url.pathname === '/api/market/admin/config/') return json({ enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060,
      session_status: 'needs_auth', configured_max_items_per_run: 80, max_items_per_run: visibleLimit, enabled_item_count: value.tiers.priority.enabled + value.tiers.ordinary.enabled,
      next_due_at_ms: null, last_success_at: null, collection_health: value })
    if (url.pathname === '/api/market/admin/items/') return json({ count: 1, results: [state.item] })
    if (url.pathname === '/api/market/admin/items/42/' && method === 'PATCH') {
      state.patches.push(body)
      if (denied) return json({ detail: '没有修改权限' }, 403)
      state.item = { ...state.item, ...body }
      return json(state.item)
    }
    if (url.pathname === '/api/market/admin/runs/') return json({ count: 0, results: [] })
    return undefined
  })
  await page.goto('/market/admin')
  return state
}

test('private health shows real coverage, timestamped plan, observed throughput and qualified pause', async ({ page }) => {
  await openAdmin(page)
  const panel = page.getByRole('region', { name: '采样覆盖与新鲜度' })
  await expect(panel).toContainText('2 / 4（50.0%）')
  await expect(panel).toContainText('100 / 145（69.0%）')
  await expect(panel).toContainText('37.5 件/小时')
  await expect(panel).toContainText('上限 40 件')
  await expect(panel).toContainText('不代表账号过期')
  await expect(panel).toContainText('账号池实时状态：未知')
  await expect(panel).toContainText('超过 2 小时仍标记为已过期')
  await expect(panel).toContainText('6 小时轮转目标可能无法满足')
  await expect(panel).toContainText('2026/10/23')
  await expect(page.locator('.market-capacity')).not.toContainText('140–204 分钟')
  await expect(page.locator('.market-capacity')).toContainText('分层配额')
})

test('priority changes use the existing item PATCH without touching enabled state', async ({ page }) => {
  const state = await openAdmin(page)
  await page.getByRole('button', { name: '设为重点采集：测试材料' }).click()
  await expect.poll(() => state.patches).toEqual([{ collection_priority: true }])
  await expect(page.getByRole('button', { name: '改为普通采集：测试材料' })).toBeVisible()
  expect(state.item.enabled).toBe(true)
})

test('revoked writes remain denied and cannot queue further priority or enable changes', async ({ page }) => {
  const state = await openAdmin(page, { denied: true })
  await page.getByRole('button', { name: '设为重点采集：测试材料' }).click()
  await expect(page.getByRole('button', { name: '设为重点采集：测试材料' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '停用测试材料' })).toBeDisabled()
  expect(state.patches).toHaveLength(1)
})

test('missing plan and insufficient observations remain unknown and fit phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openAdmin(page, { value: { ...health, actual_plan: null, throughput: { ...health.throughput, per_hour: null },
    capacity: { warnings: ['plan_unavailable'] }, pause: { code: '/private/secret.json' } } })
  const panel = page.getByRole('region', { name: '采样覆盖与新鲜度' })
  await expect(panel).toContainText('暂无实际计划')
  await expect(panel).toContainText('观测不足')
  await expect(panel).not.toContainText('/private/secret.json')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'output/playwright/phase2-market-health-mobile.png', fullPage: true })
})

test('ordinary-only actual shared cap cannot be replaced by an optimistic configured-cap rotation estimate', async ({ page }) => {
  await openAdmin(page, { visibleLimit: 80, value: { ...health, tiers: { priority: tier(0, 0, 0), ordinary: { ...health.tiers.ordinary, enabled: 249 } } } })
  await expect(page.locator('.market-capacity')).not.toContainText('140–204 分钟')
  await expect(page.locator('.market-capacity')).toContainText('实际共享上限')
  await expect(page.getByRole('region', { name: '采样覆盖与新鲜度' })).toContainText('上限 40 件')
})

test('public observation shows tier planning target without changing two-hour stale status', async ({ page }) => {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '42', name: '普通材料', category: '矿石', scope: 'global',
      best_sell: '100.00', best_buy: '90.00', observed_at: new Date(Date.now() - 3 * 3_600_000).toISOString(), status: 'stale',
      collection_tier: 'ordinary', collection_target_ms: 21_600_000, age_ms: 10_800_000 }] })
    if (url.pathname === '/api/market/items/42/series/') return json({ points: [], change: {} })
    return undefined
  })
  await page.goto('/market')
  const meta = page.locator('.market-snapshot-meta')
  await expect(meta).toContainText('普通 · 6 小时采样目标（非保证）')
  await expect(meta).toContainText('已过期')
})
