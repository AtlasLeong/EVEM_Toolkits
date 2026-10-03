import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const DEFAULT_CONFIG = {
  enabled: true,
  min_interval_seconds: 2100,
  max_interval_seconds: 3060,
  session_status: 'ready',
  next_due_at_ms: null,
  last_success_at: null,
  last_run_failure_count: 0,
  enabled_item_count: 131,
  configured_max_items_per_run: 80,
  max_items_per_run: 80,
  batch_fallback_until_ms: null,
  batch_fallback_reason: '',
  query_delay_min_seconds: 2,
  query_delay_max_seconds: 3,
  run_time_budget_seconds: 480,
}

function fallbackConfig() {
  return {
    max_items_per_run: 40,
    batch_fallback_reason: 'runtime_budget',
    batch_fallback_until_ms: Date.now() + 6 * 60 * 60 * 1000,
  }
}

async function marketAdmin(page, { config = {}, runs = [], denyPatch = false } = {}) {
  const state = { config: { ...DEFAULT_CONFIG, ...config }, patches: [] }
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ method, url, body }) => {
    if (url.pathname === '/api/market/admin/config/') {
      if (method === 'PATCH') {
        state.patches.push(body)
        if (denyPatch) return json({ detail: '没有修改权限' }, 403)
        state.config = { ...state.config, ...body }
        if (Object.hasOwn(body, 'max_items_per_run')) {
          state.config = {
            ...state.config,
            configured_max_items_per_run: body.max_items_per_run,
            batch_fallback_until_ms: null,
            batch_fallback_reason: '',
          }
        }
      }
      return json(state.config)
    }
    if (method === 'GET' && url.pathname === '/api/market/admin/items/') return json({ count: 0, results: [] })
    if (method === 'GET' && url.pathname === '/api/market/admin/runs/') return json({ count: runs.length, results: runs })
    return undefined
  })
  await page.goto('/market/admin')
  await expect(page.getByRole('heading', { name: '采集设置' })).toBeVisible()
  return state
}

test('admin shows the 80 item setting, pacing and a qualified rotation estimate', async ({ page }) => {
  await marketAdmin(page)

  await expect(page.getByRole('combobox', { name: '单次数量' })).toHaveValue('80')
  await expect(page.getByRole('combobox', { name: '单次数量' }).locator('option')).toHaveText(['40 件', '80 件'])
  await expect(page.locator('.market-status-strip')).toContainText('当前每轮上限80 件')
  await expect(page.locator('.market-status-strip')).toContainText('2–3 秒，逐件查询')
  await expect(page.locator('.market-capacity')).toContainText('当前启用 131 件；单次最多 80 件')
  await expect(page.locator('.market-capacity')).toContainText('70–102 分钟')
  await expect(page.locator('.market-capacity')).toContainText('不含本轮采集时长与调度误差')
  await expect(page.locator('.market-batch-fallback')).toHaveCount(0)
  await page.screenshot({ path: 'output/playwright/market-capacity-desktop.png', fullPage: true })
})

test('admin can switch to 40 and back to 80 without changing the round interval', async ({ page }) => {
  const state = await marketAdmin(page)

  for (const value of ['40', '80']) {
    await page.getByRole('combobox', { name: '单次数量' }).selectOption(value)
    await page.getByRole('button', { name: '保存采集设置' }).click()
    await expect.poll(() => state.patches.at(-1)).toEqual({
      enabled: true, min_interval_seconds: 2100, max_interval_seconds: 3060, max_items_per_run: Number(value),
    })
    await expect(page.locator('.market-status-strip')).toContainText(`当前每轮上限${value} 件`)
    await expect(page.getByRole('combobox', { name: '单次数量' })).toHaveValue(value)
  }
  expect(state.patches).toHaveLength(2)
  await expect(page.getByLabel('最短间隔（分钟）')).toHaveValue('35')
  await expect(page.getByLabel('最长间隔（分钟）')).toHaveValue('51')
})

test('saving the schedule preserves an active fallback until the admin explicitly restores 80', async ({ page }) => {
  const state = await marketAdmin(page, { config: fallbackConfig() })
  const until = state.config.batch_fallback_until_ms

  await expect(page.getByRole('combobox', { name: '单次数量' })).toHaveValue('80')
  await expect(page.getByRole('status', { name: '采集数量回退' })).toContainText('当前暂用 40 件/轮（设定 80 件）')
  await expect(page.getByRole('status', { name: '采集数量回退' })).toContainText('采集用时达到上限')
  await expect(page.getByRole('status', { name: '采集数量回退' })).toContainText('预计恢复时间：')
  await expect(page.locator('.market-capacity.critical')).toContainText('140–204 分钟')
  await page.getByLabel('最短间隔（分钟）').fill('36')
  await page.getByRole('checkbox', { name: '启用定时采集' }).uncheck()
  await page.getByRole('button', { name: '保存采集设置' }).click()
  await expect.poll(() => state.patches).toEqual([{ enabled: false, min_interval_seconds: 2160, max_interval_seconds: 3060 }])
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeEnabled()
  expect(state.config.batch_fallback_until_ms).toBe(until)
  expect(state.config.batch_fallback_reason).toBe('runtime_budget')
  await expect(page.getByRole('status', { name: '采集数量回退' })).toBeVisible()

  await page.getByRole('button', { name: '恢复至 80 件' }).click()
  await expect.poll(() => state.patches.at(-1)).toEqual({ max_items_per_run: 80 })
  await expect(page.locator('.market-batch-fallback')).toHaveCount(0)
  await expect(page.locator('.market-capacity')).toContainText('单次最多 80 件')
  await expect(page.getByRole('checkbox', { name: '启用定时采集' })).not.toBeChecked()
  await expect(page.getByLabel('最短间隔（分钟）')).toHaveValue('36')
})

test('a denied restore keeps fallback visible and disables subsequent writes', async ({ page }) => {
  const state = await marketAdmin(page, { config: fallbackConfig(), denyPatch: true })

  await page.getByRole('button', { name: '恢复至 80 件' }).click()

  await expect.poll(() => state.patches).toEqual([{ max_items_per_run: 80 }])
  await expect(page.getByText('没有修改权限', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复至 80 件' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeDisabled()
  await expect(page.getByRole('status', { name: '采集数量回退' })).toBeVisible()
})

test('run history distinguishes planned quantities, a fallback run and legacy unknown counts', async ({ page }) => {
  await marketAdmin(page, { runs: [
    { id: 3, trigger: 'scheduled', status: 'partial', started_at_ms: 1760000003000, item_limit: 40, expected_count: 37, success_count: 30, failure_count: 2, error_code: 'incomplete_run', batch_fallback_reason: 'timeout' },
    { id: 2, trigger: 'scheduled', status: 'partial', started_at_ms: 1760000002000, item_limit: 80, expected_count: 80, success_count: 60, failure_count: 0, error_code: 'runtime_budget', batch_fallback_reason: '' },
    { id: 1, trigger: 'manual', status: 'succeeded', started_at_ms: 1760000001000, item_limit: null, expected_count: null, success_count: 3, failure_count: 0, error_code: '', batch_fallback_reason: null },
  ] })

  await expect(page.getByRole('columnheader', { name: '计划数量' })).toBeVisible()
  await expect(page.getByRole('row', { name: /runtime_budget/ }).locator('[data-label="计划数量"]')).toHaveText('80 件上限 80 件')
  await expect(page.getByRole('row', { name: /incomplete_run/ }).locator('[data-label="计划数量"]')).toHaveText('37 件上限 40 件临时回退：查询超时')
  await expect(page.getByRole('row', { name: /手动/ }).locator('[data-label="计划数量"]')).toHaveText('未知')
})

test('fallback controls and estimates remain available at phone width', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await marketAdmin(page, { config: fallbackConfig() })

  await expect(page.getByRole('combobox', { name: '单次数量' })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复至 80 件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '保存采集设置' })).toBeEnabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  await page.screenshot({ path: 'output/playwright/market-capacity-mobile.png', fullPage: true })
})
