import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('行星资源可搜索、加入计算器并管理方案', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  let programmes = [
    {
      programme_id: 100,
      programme_name: '默认方案',
      programme_desc: '旧方案',
      programme_element: [],
    },
  ]

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
      return json([{ co_id: 11, co_title: '静寂谷', co_safetylvl: 0.5 }])
    }
    if (method === 'GET' && url.pathname === '/api/solarsystem') {
      return json([{ ss_id: 21, ss_title: 'Q-TBHW', ss_safetylvl: -0.8 }])
    }
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      return json([
        {
          resource_name: '光泽合金',
          resource_type: '船菜',
          region: '德里克',
          region_security: 0.5,
          constellation: '静寂谷',
          constellation_security: 0.5,
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
      return json([
        { resource_name: '光泽合金', resource_type: '船菜', resource_price: 1200 },
        { resource_name: '光彩合金', resource_type: '船菜', resource_price: 900 },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/programme' && !url.searchParams.has('programme_id')) {
      return json(programmes.map(({ programme_id, programme_name, programme_desc }) => ({ programme_id, programme_name, programme_desc })))
    }
    if (method === 'GET' && url.pathname === '/api/programme' && url.searchParams.has('programme_id')) {
      const target = programmes.find((item) => String(item.programme_id) === url.searchParams.get('programme_id'))
      return json(target ? [target] : [])
    }
    if (method === 'POST' && url.pathname === '/api/programme') {
      const next = {
        programme_id: 501,
        programme_name: body.programmeName,
        programme_desc: body.programmeDesc,
        programme_element: body.data,
      }
      programmes = [...programmes, next]
      return json({ programme_id: 501 })
    }
    if (method === 'PATCH' && url.pathname === '/api/programme') {
      programmes = programmes.map((item) =>
        String(item.programme_id) === String(body.programme_id)
          ? { ...item, programme_element: body.element }
          : item,
      )
      return json({ ok: true })
    }
    if (method === 'DELETE' && url.pathname === '/api/programme') {
      programmes = programmes.filter((item) => String(item.programme_id) !== String(body.programme_id))
      return json({ ok: true })
    }
  })

  await page.goto('/planetary')
  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()

  await expect(page.getByText('结果列表')).toBeVisible()
  await expect(page.getByText('Q-TBHW')).toBeVisible()

  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()

  await modal.locator('input[placeholder="输入方案名称"]').fill('测试方案')
  await modal.getByRole('button', { name: '保存新方案' }).click()
  await expect(modal.getByText('方案已保存')).toBeVisible()

  await modal.getByRole('button', { name: '加载预设价格' }).click()
  await expect(modal.getByText('预设价格已加载')).toBeVisible()

  await modal.locator('input[placeholder="填入统一阵列数"]').fill('3')
  await modal.locator('.calculator-batch-grid .calculator-copy-btn').first().click()
  await expect(modal.locator('.calculator-table tbody .table-inline-input').first()).toHaveValue('3')

  await modal.getByRole('button', { name: '更新当前方案' }).click()
  await expect(modal.getByText('当前方案已更新')).toBeVisible()

  await modal.getByRole('button', { name: '删除方案' }).click()
  await expect(modal.getByText('方案已删除')).toBeVisible()
})
