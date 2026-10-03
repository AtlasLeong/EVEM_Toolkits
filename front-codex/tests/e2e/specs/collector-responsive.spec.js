import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

// Existing collector-admin unit fixture, including parsed/saved/filter counts.
const collector = {
  configured: true, collection_enabled: false, latest_kill_id: '20044042',
  cursor: { pause_reason: 'rate_limited', strategy: { phase: 'locate', newest_candidate_id: '20050000',
    historical_next_id: '20044044', pending_id_count: 1003, pending_range_count: 2, deferred_id_count: 1 } },
  runs: [{ id: 1, status: 'stopped', request_count: 5, report_count: 4, empty_count: 1, stop_reason: 'rate_limited',
    diagnostics: { session_slot: 'B', rpc_count: 8, stage: 'identity', failure_rpc_method: 'get_public_info',
      created_count: 1, updated_count: 0, filtered_value_count: 3, enrichment_deferred_count: 1 } }],
  events: [{ id: 1, kill_id: '20044042', status: 'report', diagnostics: { session_slot: 'B', stage: 'identity',
    last_rpc_method: 'get_public_info', disposition: 'created' } }],
}

test('collector phone cards identify every count and log field while desktop retains table headings', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 7 })
  await installApiMock(page, ({ url }) => url.pathname === '/api/killboard/access/'
    ? json({ can_view_killboard: true })
    : url.pathname === '/api/killboard/collector/logs/' ? json(collector) : json({}))
  await page.goto('/killboard/admin')
  const tables = page.locator('.market-admin-table')
  await expect(tables).toHaveCount(2)
  const labels = [
    ['开始时间', '状态 / 会话槽位', '探测 / 解析 / 空结果', '实际 RPC', '新增 / 更新', '价值过滤 / NPC 过滤', '身份待补', '阶段 / RPC 方法', '停止原因'],
    ['时间', 'KM ID', '会话槽位', '结果 / 收录处理', '阶段 / RPC 方法', '错误'],
  ]
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 960 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    for (const [index, expected] of labels.entries()) {
      const table = tables.nth(index)
      await expect(table.locator('thead th')).toHaveText(expected)
      await expect(table.locator('tbody tr')).toHaveCount(1)
      const cells = table.locator('tbody td')
      await expect(cells).toHaveCount(expected.length)
      if (width === 1440) await expect(table.locator('thead')).toBeVisible()
      else {
        // Mobile keeps the table headings available to assistive technology.
        for (const [column, label] of expected.entries()) {
          const cell = cells.nth(column)
          await expect(cell).toBeVisible()
          const renderedLabel = await cell.evaluate(element => {
            const style = getComputedStyle(element, '::before')
            return { content: style.content, display: style.display, width: parseFloat(style.width) }
          })
          expect(renderedLabel.content).toBe(JSON.stringify(label))
          expect(renderedLabel.display).not.toBe('none')
          expect(renderedLabel.width).toBeGreaterThan(0)
        }
      }
    }
    await expect(tables.first().locator('tbody td').nth(2)).toHaveText('5 / 4 / 1')
    await expect(tables.first().locator('tbody td').nth(3)).toHaveText('8')
    await expect(tables.first().locator('tbody td').nth(4)).toHaveText('1 / 0')
    await expect(tables.last().locator('tbody td').nth(1)).toHaveText('20044042')
  }
})
