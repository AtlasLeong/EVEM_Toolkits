import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('计算器关闭再打开后仍保留当前方案并可更新', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  let programmes = []
  let updatePayload = null

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
    if (method === 'GET' && url.pathname === '/api/regions') return json([])
    if (method === 'GET' && url.pathname === '/api/constellations') return json([])
    if (method === 'GET' && url.pathname === '/api/solarsystem') return json([])
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
      const selected = (body.planetaryResources || []).map((item) => item.value).sort()
      if (selected.length === 1 && selected[0] === '光泽合金') {
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

      if (selected.length === 1 && selected[0] === '光彩合金') {
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

      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/programme' && !url.searchParams.has('programme_id')) {
      return json(programmes.map(({ programme_id, programme_name, programme_desc }) => ({ programme_id, programme_name, programme_desc })))
    }
    if (method === 'POST' && url.pathname === '/api/programme') {
      const next = {
        programme_id: 700,
        programme_name: body.programmeName,
        programme_desc: body.programmeDesc,
        programme_element: body.data,
      }
      programmes = [next]
      return json({ programme_id: 700 })
    }
    if (method === 'PATCH' && url.pathname === '/api/programme') {
      updatePayload = body
      programmes = programmes.map((item) =>
        String(item.programme_id) === String(body.programme_id)
          ? { ...item, programme_element: body.element }
          : item,
      )
      return json({ ok: true })
    }
    if (method === 'GET' && url.pathname === '/api/programme' && url.searchParams.has('programme_id')) {
      const target = programmes.find((item) => String(item.programme_id) === url.searchParams.get('programme_id'))
      return json(target ? [target] : [])
    }
  })

  await page.goto('/planetary')

  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  const modal = page.locator('.calculator-card')
  await expect(modal).toBeVisible()
  await modal.locator('input[placeholder="输入方案名称"]').fill('保留方案')
  await modal.getByRole('button', { name: '保存新方案' }).click()
  await expect(modal.getByText('方案已保存')).toBeVisible()
  await expect(modal.locator('.calculator-programme-current-inline strong')).toHaveText('保留方案')

  await modal.getByRole('button', { name: '关闭' }).click()
  await expect(modal).toBeHidden()

  await page.getByRole('button', { name: '光泽合金' }).click()
  await page.getByRole('button', { name: '光彩合金' }).click()
  await page.getByRole('button', { name: '搜索' }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()

  await expect(modal).toBeVisible()
  await expect(modal.locator('.calculator-programme-current-inline strong')).toHaveText('保留方案')

  await modal.getByRole('button', { name: '更新当前方案' }).click()
  await expect(modal.getByText('当前方案已更新')).toBeVisible()

  expect(updatePayload).toMatchObject({ programme_id: '700' })
  expect(Array.isArray(updatePayload.element)).toBeTruthy()
  expect(updatePayload.element).toHaveLength(2)
})
