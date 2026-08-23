import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

async function installPlanetaryMultiMock(page) {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([
        {
          label: '船菜',
          options: [
            { label: '光泽合金', value: '光泽合金', icon: TINY_ICON },
            { label: '光彩合金', value: '光彩合金', icon: TINY_ICON },
          ],
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/regions') return json([])
    if (method === 'GET' && url.pathname === '/api/constellations') return json([])
    if (method === 'GET' && url.pathname === '/api/solarsystem') return json([])
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') return json([])
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      return json([
        {
          resource_name: '光泽合金',
          resource_type: '船菜',
          region: '德里克',
          region_security: 0.5,
          constellation: '静寂谷',
          constellation_security: 0.4,
          solar_system: 'Q-TBHW',
          solar_system_security: -0.8,
          planet_id: 'P1',
          resource_level: 4,
          resource_yield: 120,
          fuel_value: 240,
          icon: TINY_ICON,
        },
        {
          resource_name: '光彩合金',
          resource_type: '船菜',
          region: '德里克',
          region_security: 0.5,
          constellation: '静寂谷',
          constellation_security: 0.4,
          solar_system: 'Q-TBHW',
          solar_system_security: -0.8,
          planet_id: 'P2',
          resource_level: 3,
          resource_yield: 96,
          fuel_value: 180,
          icon: TINY_ICON,
        },
      ])
    }
  })
}

async function openCalculatorWithTwoRows(page) {
  await installPlanetaryMultiMock(page)
  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '光彩合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('thead .table-check-trigger').click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()
  return modal
}

test('计算器数值列支持升降序排序并保留编辑后的排序状态', async ({ page }) => {
  const modal = await openCalculatorWithTwoRows(page)
  const rows = modal.locator('tbody tr')

  await expect(rows.nth(0)).toContainText('光泽合金')
  await expect(rows.nth(1)).toContainText('光彩合金')

  const sortableLabels = ['产量', '单位热值', '阵列数量', '计算时长', '总热值', '总产量', '单价', '总价']
  for (const label of sortableLabels) {
    await expect(modal.getByRole('button', { name: `${label}排序`, exact: true })).toBeVisible()
  }
  await expect(modal.locator('thead th').nth(0).getByRole('button')).toHaveCount(0)
  await expect(modal.locator('thead th').nth(1).getByRole('button')).toHaveCount(0)
  await expect(modal.locator('thead th').nth(10).getByRole('button')).toHaveCount(0)

  const yieldSort = modal.getByRole('button', { name: '产量排序', exact: true })
  await yieldSort.click()
  await expect(yieldSort.locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.nth(0)).toContainText('光彩合金')
  await expect(rows.nth(1)).toContainText('光泽合金')

  await yieldSort.click()
  await expect(yieldSort.locator('..')).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.nth(0)).toContainText('光泽合金')
  await expect(rows.nth(1)).toContainText('光彩合金')

  const unitPriceSort = modal.getByRole('button', { name: '单价排序', exact: true })
  await unitPriceSort.click()
  await expect(unitPriceSort.locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.nth(0)).toContainText('光泽合金')
  await expect(rows.nth(1)).toContainText('光彩合金')
  await unitPriceSort.click()
  await expect(unitPriceSort.locator('..')).toHaveAttribute('aria-sort', 'descending')
  await expect(rows.nth(0)).toContainText('光泽合金')
  await expect(rows.nth(1)).toContainText('光彩合金')

  const highYieldRow = rows.filter({ hasText: '光泽合金' })
  const lowYieldRow = rows.filter({ hasText: '光彩合金' })
  await highYieldRow.locator('.table-inline-input').nth(0).fill('1')
  await highYieldRow.locator('.table-inline-input').nth(1).fill('1')
  await highYieldRow.locator('.table-inline-input').nth(2).fill('100')
  await lowYieldRow.locator('.table-inline-input').nth(0).fill('1')
  await lowYieldRow.locator('.table-inline-input').nth(1).fill('1')
  await lowYieldRow.locator('.table-inline-input').nth(2).fill('100')

  await modal.getByRole('button', { name: '总价排序', exact: true }).click()
  await expect(modal.getByRole('button', { name: '总价排序', exact: true }).locator('..')).toHaveAttribute('aria-sort', 'ascending')
  await expect(rows.nth(0)).toContainText('光彩合金')
  await expect(rows.nth(1)).toContainText('光泽合金')

  await rows.nth(0).locator('.table-inline-input').nth(0).fill('3')
  await expect(rows.nth(0)).toContainText('光泽合金')
})
