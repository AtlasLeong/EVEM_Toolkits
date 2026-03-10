import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function installProgrammeErrorMock(page) {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([
        {
          label: '船菜',
          options: [{ label: '光泽合金', value: '光泽合金', icon: TINY_ICON }],
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/regions') {
      return json([{ r_id: 1, r_title: '德里克', r_safetylvl: 0.5 }])
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
      ])
    }
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/programme') {
      return json([])
    }
  })
}

test('未选择已保存方案时更新当前方案按钮保持禁用', async ({ page }) => {
  await installProgrammeErrorMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal.getByRole('button', { name: '更新当前方案' })).toBeDisabled()
})

test('未选择已保存方案时删除方案按钮保持禁用', async ({ page }) => {
  await installProgrammeErrorMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal.getByRole('button', { name: '删除方案' })).toBeDisabled()
})
