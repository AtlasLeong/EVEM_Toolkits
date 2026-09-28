import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('manufacturing estimator selects a target and exposes make/buy route controls', async ({ page }) => {
  const quoteRequests = []
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q') || '41000000000'
      quoteRequests.push(itemId)
      return json({ count: 1, results: [{ item_id: itemId, name: `市场物品 ${itemId}`, best_sell: '1200', status: 'fresh', observed_at: new Date().toISOString() }] })
    }
    return undefined
  })

  await page.goto('/manufacturing')
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
  await expect(page.getByRole('heading', { name: '制造估价' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索制造目标' })).toBeVisible()
  await expect(page.getByTestId('manufacturing-summary').getByText('效率公式待核实')).toBeVisible()
  await expect(page.getByRole('heading', { name: '制造目标' })).toBeVisible()
  await expect(page.getByTestId('manufacturing-total-compact')).toContainText(/万|亿/)
  await expect(page.getByRole('button', { name: '展开全部层级' })).toBeVisible()
  await expect(page.getByRole('group', { name: '技能与效率' })).toBeVisible()
  await expect(page.getByRole('button', { name: '全部自造' })).toBeVisible()
  await expect(page.getByRole('button', { name: '购买中间件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复默认' })).toBeVisible()
  const efficiencyRate = page.getByRole('spinbutton', { name: '制造效率百分比' })
  await efficiencyRate.fill('12.5')
  await expect(efficiencyRate).toHaveValue('12.5')

  const search = page.getByRole('searchbox', { name: '搜索制造目标' })
  await search.fill('组装车间模块 II')
  const targetOption = page.getByRole('option').filter({ hasText: '组装车间模块 II' }).filter({ hasText: '24041000020' })
  await expect(targetOption).toBeVisible()
  await targetOption.click()
  await expect(page.getByRole('heading', { name: '组装车间模块 II' })).toBeVisible()
  await expect(page.getByRole('button', { name: '切换制造目标' })).toBeVisible()

  const quantity = page.getByRole('spinbutton', { name: '制造数量' })
  await expect(quantity).toHaveValue('1')
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await expect(quantity).toHaveValue('2')

  await expect(page.getByRole('tree', { name: '制造链路' })).toBeVisible()
  await page.getByRole('button', { name: '购买中间件' }).click()
  await expect(page.getByText('已应用：购买中间件（根目标保持自造）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect(page.getByText('已恢复默认路线（全部节点按配方自造）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '展开全部层级' }).click()
  const firstRoute = page.getByRole('group', { name: /生产方式/ }).first()
  await expect(firstRoute).toBeVisible()
  await expect(firstRoute.getByRole('button', { name: '自造', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '收起全部层级' }).click()
  await expect(page.getByRole('treeitem').first()).toBeVisible()
  const routeGroup = page.getByRole('group', { name: /生产方式/ }).first()
  const routeToggle = routeGroup.getByRole('button', { name: '购买', exact: true })
  await expect(routeToggle).toBeVisible()
  await routeToggle.click()
  await expect.poll(() => quoteRequests.includes('24041000020')).toBeTruthy()
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveCSS('background-color', 'rgb(246, 188, 105)')
  await expect(page.locator('[data-testid="manufacturing-tree-row"][data-selected="true"]')).toBeVisible()
  await expect(page.getByText('市场参考价')).toBeVisible()

  const manualPrice = page.getByRole('textbox', { name: '方案手填单价' })
  await expect(manualPrice).toBeVisible()
  await manualPrice.fill('99.5')
  await expect(page.getByText('方案内手填')).toBeVisible()
  await expect(page.getByTestId('manufacturing-summary')).toContainText(/已覆盖小计|总成本/)
})
