import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

function installPlanetaryBaseMock(page, resolver = () => undefined) {
  return installApiMock(page, async (ctx) => {
    const { url, method } = ctx

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

    return resolver(ctx)
  })
}

test('行星资源全空搜索时显示提示', async ({ page }) => {
  await installPlanetaryBaseMock(page)
  await page.goto('/planetary')
  await page.getByRole('button', { name: '搜索' }).click()
  await expect(page.getByText('请至少选择一个星域或资源')).toBeVisible()
})

test('只选资源不选地点时直接把资源对象交给后端', async ({ page }) => {
  await installPlanetaryBaseMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      expect(body).toMatchObject({
        regionValue: [],
        constellationValue: [],
        systemValue: [],
      })
      expect(Array.isArray(body.planetaryResources)).toBeTruthy()
      expect(body.planetaryResources[0]).toMatchObject({
        label: '光泽合金',
        value: '光泽合金',
        icon: TINY_ICON,
        group: '船菜',
      })

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
  })

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toContainText('Q-TBHW')
  await expect(firstRow).toContainText('德里克')
})

test('只选地点不选资源时由后端返回该地点结果', async ({ page }) => {
  await installPlanetaryBaseMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      expect(body).toMatchObject({
        regionValue: [1],
        constellationValue: [],
        systemValue: [],
        planetaryResources: [],
      })

      return json([
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
          resource_yield: 95,
          fuel_value: 190,
          icon: TINY_ICON,
        },
      ])
    }
  })

  await page.goto('/planetary')
  const regionPicker = page.locator('.picker-field').first()
  await regionPicker.locator('.picker-option').first().click()
  await page.getByRole('button', { name: '搜索' }).click()

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toContainText('光彩合金')
  await expect(firstRow).toContainText('Q-TBHW')
})

test('同时选到星系时只把最深一级 systemValue 发给后端', async ({ page }) => {
  await installPlanetaryBaseMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      expect(body).toMatchObject({
        regionValue: [],
        constellationValue: [],
        systemValue: [21],
        planetaryResources: [],
      })

      return json([
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
          resource_yield: 95,
          fuel_value: 190,
          icon: TINY_ICON,
        },
      ])
    }
  })

  await page.goto('/planetary')

  const regionPicker = page.locator('.picker-field').nth(0)
  const constellationPicker = page.locator('.picker-field').nth(1)
  const systemPicker = page.locator('.picker-field').nth(2)

  await regionPicker.locator('.picker-option').first().click()
  await constellationPicker.locator('.picker-option').first().click()
  await systemPicker.locator('.picker-option').first().click()
  await page.getByRole('button', { name: '搜索' }).click()

  const firstRow = page.locator('tbody tr').first()
  await expect(firstRow).toContainText('Q-TBHW')
  await expect(firstRow).toContainText('光彩合金')
})
