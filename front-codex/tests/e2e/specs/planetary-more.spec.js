import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

async function installPlanetaryMultiMock(page) {
  await installApiMock(page, async ({ url, method, body }) => {
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
    if (method === 'GET' && url.pathname === '/api/regions') {
      return json([{ r_id: 1, r_title: '德里克', r_safetylvl: 0.5 }])
    }
    if (method === 'GET' && url.pathname === '/api/constellations') {
      return json([{ co_id: 11, co_title: '静寂谷', co_safetylvl: 0.4 }])
    }
    if (method === 'GET' && url.pathname === '/api/solarsystem') {
      return json([{ ss_id: 21, ss_title: 'Q-TBHW', ss_safetylvl: -0.8 }])
    }
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      return json([])
    }
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      expect(Array.isArray(body.planetaryResources)).toBeTruthy()
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

test('行星资源取消上级筛选会清空下级选择', async ({ page }) => {
  await installPlanetaryMultiMock(page)

  await page.goto('/planetary')
  const regionPicker = page.locator('.picker-field').nth(0)
  const constellationPicker = page.locator('.picker-field').nth(1)

  await regionPicker.locator('.picker-option').first().click()
  await constellationPicker.locator('.picker-option').first().click()

  await expect(regionPicker.locator('.picker-tag')).toContainText('德里克')
  await expect(constellationPicker.locator('.picker-tag')).toContainText('静寂谷')

  await regionPicker.locator('.picker-tag').click()

  await expect(regionPicker.locator('.picker-tag')).toHaveCount(0)
  await expect(constellationPicker.locator('.picker-tag')).toHaveCount(0)
  await expect(page.locator('.picker-field').nth(2).locator('.picker-input')).toBeDisabled()
})

test('行星资源结果支持全选和取消全选', async ({ page }) => {
  await installPlanetaryMultiMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()

  const selectAll = page.locator('thead .table-check-trigger')
  await selectAll.click()
  await expect(page.getByText('已选 2 项')).toBeVisible()

  await selectAll.click()
  await expect(page.getByText('已选 2 项')).toHaveCount(0)
  await expect(page.getByText('勾选结果加入计算器')).toBeVisible()
})

test('计算器支持批量复制计算时长和单价', async ({ page }) => {
  await installPlanetaryMultiMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('thead .table-check-trigger').click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()

  await modal.locator('input[placeholder="统一按小时输入"]').fill('6')
  await modal.locator('input[placeholder="统一资源单价"]').fill('1999')
  await modal.locator('.calculator-copy-btn').nth(1).click()
  await modal.locator('.calculator-copy-btn').nth(2).click()

  const rows = modal.locator('tbody tr')
  await expect(rows.nth(0).locator('.table-inline-input').nth(1)).toHaveValue('6')
  await expect(rows.nth(1).locator('.table-inline-input').nth(1)).toHaveValue('6')
  await expect(rows.nth(0).locator('.table-inline-input').nth(2)).toHaveValue('1999')
  await expect(rows.nth(1).locator('.table-inline-input').nth(2)).toHaveValue('1999')
})
