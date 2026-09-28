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
  await expect(page.getByRole('heading', { name: '制造估价' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索制造目标' })).toBeVisible()
  await expect(page.getByTestId('manufacturing-summary').getByText('效率公式待核实')).toBeVisible()

  const search = page.getByRole('searchbox', { name: '搜索制造目标' })
  await search.fill('组装车间模块 II')
  const targetOption = page.getByRole('option').filter({ hasText: '组装车间模块 II' }).filter({ hasText: '24041000020' })
  await expect(targetOption).toBeVisible()
  await targetOption.click()
  await expect(page.getByRole('heading', { name: '组装车间模块 II' })).toBeVisible()

  const quantity = page.getByRole('spinbutton', { name: '制造数量' })
  await expect(quantity).toHaveValue('1')
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await expect(quantity).toHaveValue('2')

  await expect(page.getByRole('tree', { name: '制造链路' })).toBeVisible()
  const routeToggle = page.getByRole('button', { name: /切换为购买/ }).first()
  await expect(routeToggle).toBeVisible()
  await routeToggle.click()
  await expect.poll(() => quoteRequests.includes('24041000020')).toBeTruthy()
  await expect(page.getByRole('button', { name: /切换为自造/ }).first()).toBeVisible()
  await expect(page.getByText('市场参考价')).toBeVisible()

  const manualPrice = page.getByRole('textbox', { name: '方案手填单价' })
  await expect(manualPrice).toBeVisible()
  await manualPrice.fill('99.5')
  await expect(page.getByText('方案内手填')).toBeVisible()
  await expect(page.getByTestId('manufacturing-summary')).toContainText(/已覆盖小计|总成本/)
})
