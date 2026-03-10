import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function installPlanetaryUiMock(page) {
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
        {
          label: '燃料',
          options: [{ label: '重水', value: '重水', icon: TINY_ICON }],
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
      return json([
        { resource_name: '光泽合金', resource_price: 2100 },
        { resource_name: '光彩合金', resource_price: 3200 },
      ])
    }
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
    if (method === 'GET' && url.pathname === '/api/programme') {
      return json([])
    }
  })
}

test('清空筛选会重置资源与地点选择', async ({ page }) => {
  await installPlanetaryUiMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()

  const regionPicker = page.locator('.picker-field').nth(0)
  const constellationPicker = page.locator('.picker-field').nth(1)
  const systemPicker = page.locator('.picker-field').nth(2)

  await regionPicker.locator('.picker-option').first().click()
  await constellationPicker.locator('.picker-option').first().click()
  await systemPicker.locator('.picker-option').first().click()

  await expect(regionPicker.locator('.picker-tag')).toHaveCount(1)
  await expect(constellationPicker.locator('.picker-tag')).toHaveCount(1)
  await expect(systemPicker.locator('.picker-tag')).toHaveCount(1)
  await expect(page.getByRole('button', { name: '光泽合金' })).toHaveClass(/active/)

  await page.getByRole('button', { name: '清空筛选' }).click()

  await expect(regionPicker.locator('.picker-tag')).toHaveCount(0)
  await expect(constellationPicker.locator('.picker-tag')).toHaveCount(0)
  await expect(systemPicker.locator('.picker-tag')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '光泽合金' })).not.toHaveClass(/active/)
  await expect(constellationPicker.locator('.picker-input')).toBeDisabled()
  await expect(systemPicker.locator('.picker-input')).toBeDisabled()
})

test('加载预设价格会回填计算器单价列', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  await installPlanetaryUiMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '光彩合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('thead .table-check-trigger').click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await modal.getByRole('button', { name: '加载预设价格' }).click()

  await expect(modal.getByText('预设价格已加载')).toBeVisible()
  await expect(modal.locator('tbody tr').nth(0).locator('.table-inline-input').nth(2)).toHaveValue('2100')
  await expect(modal.locator('tbody tr').nth(1).locator('.table-inline-input').nth(2)).toHaveValue('3200')
})

test('计算器支持批量复制阵列数量', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  await installPlanetaryUiMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '光彩合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('thead .table-check-trigger').click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await modal.locator('input[placeholder="填入统一阵列数"]').fill('5')
  await modal.locator('.calculator-copy-btn').first().click()

  await expect(modal.getByText('批量值已复制到全部行')).toBeVisible()
  await expect(modal.locator('tbody tr').nth(0).locator('.table-inline-input').first()).toHaveValue('5')
  await expect(modal.locator('tbody tr').nth(1).locator('.table-inline-input').first()).toHaveValue('5')
})
