import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

async function installPlanetaryFilterMock(page) {
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

test('资源搜索框会过滤资源卡片', async ({ page }) => {
  await installPlanetaryFilterMock(page)

  await page.goto('/planetary')
  await page.locator('.planetary-resource-search input').fill('重水')

  await expect(page.getByRole('button', { name: '重水' })).toBeVisible()
  await expect(page.getByRole('button', { name: '光泽合金' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '光彩合金' })).toHaveCount(0)
})

test('结果列表支持按等级筛选', async ({ page }) => {
  await installPlanetaryFilterMock(page)

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()

  const rows = page.locator('tbody tr')
  await expect(rows).toHaveCount(2)

  await page.locator('select.table-filter-input').selectOption('4')

  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('光泽合金')
  await expect(rows.first()).not.toContainText('光彩合金')
})
