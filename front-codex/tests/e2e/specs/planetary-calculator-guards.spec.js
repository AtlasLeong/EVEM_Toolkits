import { expect, test } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

async function installPlanetaryBaseMock(page) {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([
        {
          label: '船菜',
          options: [{ label: '光泽合金', value: '光泽合金', icon: TINY_ICON }],
        },
      ])
    }

    if (method === 'GET' && url.pathname === '/api/regions') return json([])
    if (method === 'GET' && url.pathname === '/api/constellations') return json([])
    if (method === 'GET' && url.pathname === '/api/solarsystem') return json([])
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') return json([])

    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      expect(Array.isArray(body.planetaryResources)).toBeTruthy()
      return json([
        {
          resource_name: '光泽合金',
          resource_type: '船菜',
          region: '德里克',
          region_security: 0.5,
          constellation: '寂静谷',
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
  })
}

async function openCalculatorWithOneRow(page) {
  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()
  return page.locator('.calculator-card')
}

test('未登录时计算器显示方案限制提示且不展示方案管理按钮', async ({ page }) => {
  await installPlanetaryBaseMock(page)

  const modal = await openCalculatorWithOneRow(page)
  await expect(modal.locator('.calculator-auth-hint')).toContainText('未登录无法保存方案')
  await expect(modal.locator('.calculator-auth-hint')).toContainText(
    '当前仍可正常计算，但无法保存、加载或删除方案。登录后即可管理方案。',
  )
  await expect(modal.getByRole('button', { name: '保存新方案' })).toHaveCount(0)
  await expect(modal.getByRole('button', { name: '更新当前方案' })).toHaveCount(0)
  await expect(modal.getByRole('button', { name: '删除方案' })).toHaveCount(0)
})

test('已加入计算器的结果行会被禁用避免重复加入', async ({ page }) => {
  await installPlanetaryBaseMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()

  const firstCheck = page.locator('tbody .table-check-trigger').first()
  await firstCheck.click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  await expect(firstCheck).toBeDisabled()
  await expect(firstCheck).toHaveAttribute('title', '已在计算器中')
})
