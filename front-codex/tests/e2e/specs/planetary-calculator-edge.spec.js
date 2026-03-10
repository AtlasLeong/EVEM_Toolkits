import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function installCalculatorBaseMock(page, extraResolver = () => undefined) {
  await installApiMock(page, async (ctx) => {
    const { url, method, body } = ctx

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

    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      const selected = (body.planetaryResources || []).map((item) => item.value).sort()

      if (selected.includes('光彩合金')) {
        return json([
          {
            resource_name: '光彩合金',
            resource_type: '船菜',
            region: '德里克',
            region_security: 0.5,
            constellation: '静寂谷',
            constellation_security: 0.4,
            solar_system: 'Y-2ANO',
            solar_system_security: -0.4,
            planet_id: 'P2',
            resource_level: 3,
            resource_yield: 96,
            fuel_value: 180,
            icon: TINY_ICON,
          },
        ])
      }

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

    return extraResolver(ctx)
  })
}

async function openCalculatorWithOneRow(page) {
  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()
  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()
  return modal
}

test('计算器保存方案时未填写名称会显示错误', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  await installCalculatorBaseMock(page)

  const modal = await openCalculatorWithOneRow(page)
  await modal.getByRole('button', { name: '保存新方案' }).click()

  await expect(modal.locator('.calculator-status.error')).toContainText('请先填写方案名称')
})

test('计算器可加载已保存方案并回填当前方案名', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installCalculatorBaseMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/programme' && !url.searchParams.has('programme_id')) {
      return json([
        {
          programme_id: 901,
          programme_name: '已保存方案A',
          programme_desc: '测试描述',
        },
      ])
    }

    if (method === 'GET' && url.pathname === '/api/programme' && url.searchParams.has('programme_id')) {
      return json([
        {
          programme_id: 901,
          programme_name: '已保存方案A',
          programme_desc: '测试描述',
          programme_element: [
            {
              key: 'row-1',
              resource_name: '光彩合金',
              resource_type: '船菜',
              region: '德里克',
              region_security: 0.5,
              constellation: '静寂谷',
              constellation_security: 0.4,
              solar_system: 'Y-2ANO',
              solar_system_security: -0.4,
              planet_id: 'P2',
              resource_level: 3,
              resource_yield: 96,
              fuel_value: 180,
              unit_price: 1200,
              arrays_number: 2,
              computation_time: 3,
              total_output: 576,
              total_fuel: 1080,
              total_price: 691200,
              icon: TINY_ICON,
            },
          ],
        },
      ])
    }
  })

  const modal = await openCalculatorWithOneRow(page)
  await modal.locator('.calculator-select-trigger').click()
  await modal.locator('.calculator-dropdown-item', { hasText: '已保存方案A' }).click()

  await expect(modal.locator('.calculator-programme-current-inline strong')).toHaveText('已保存方案A')
  await expect(modal.getByText('方案已加载到计算器')).toBeVisible()
  await expect(modal.locator('tbody tr').first()).toContainText('光彩合金')
})

test('清空计算器会重置当前方案状态并显示空态', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installCalculatorBaseMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/programme') {
      return json({ programme_id: 902 })
    }
    if (method === 'GET' && url.pathname === '/api/programme' && !url.searchParams.has('programme_id')) {
      return json([
        {
          programme_id: 902,
          programme_name: '待清空方案',
          programme_desc: '',
        },
      ])
    }
  })

  const modal = await openCalculatorWithOneRow(page)
  await modal.locator('input[placeholder="输入方案名称"]').fill('待清空方案')
  await modal.getByRole('button', { name: '保存新方案' }).click()
  await expect(modal.locator('.calculator-programme-current-inline strong')).toHaveText('待清空方案')

  await modal.getByRole('button', { name: '清空计算器' }).click()

  await expect(modal.locator('.calculator-programme-current-inline strong')).toHaveText('未保存')
  await expect(modal.locator('.empty-title')).toHaveText('计算器为空')
})
