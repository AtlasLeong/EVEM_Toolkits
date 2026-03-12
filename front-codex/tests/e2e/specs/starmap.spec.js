import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('星系导航支持英文搜索定位并计算路径', async ({ page }) => {
  const systems = [
    {
      system_id: 1,
      zh_name: '阿尔法',
      en_name: 'ALPHA-1',
      x: 0,
      y: 0,
      z: 0,
      security_status: 0.5,
    },
    {
      system_id: 2,
      zh_name: '贝塔',
      en_name: 'BETA-2',
      x: 9.461e15,
      y: 0,
      z: 0,
      security_status: 0.1,
    },
    {
      system_id: 3,
      zh_name: '伽马',
      en_name: 'GAMMA-3',
      x: 1.8922e16,
      y: 0,
      z: 0,
      security_status: -0.2,
    },
  ]

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/boardsystems') return json(systems)
    if (method === 'GET' && url.pathname === '/api/boardregions') {
      return json([{ region_id: 10, zh_name: '德里克' }])
    }
    if (method === 'GET' && url.pathname === '/api/boardconstellations') {
      return json([
        { constellation_id: 100, region_id: 10, zh_name: '静寂谷', x: 3.1536e15, y: 0, z: 0 },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/boardstargate') {
      return json([
        { system_id: 1, destination_system_id: 2 },
        { system_id: 2, destination_system_id: 3 },
      ])
    }
    if (method === 'POST' && url.pathname === '/api/jumppath') {
      expect(body).toMatchObject({ start_system: '阿尔法', end_system: '贝塔', dict_road: false })
      return json([
        {
          start: { system_id: 1, zh_name: '阿尔法', move_type: '常规跳跃' },
          end: { system_id: 2, zh_name: '贝塔', move_type: '常规跳跃' },
          distance: '1.00',
        },
      ])
    }
  })

  await page.goto('/starmap')
  await expect(page.locator('.tactical-system-card strong')).toHaveText('交互星图')

  const searchInput = page.getByLabel('搜索并定位星系')
  await searchInput.fill('alpha')
  await expect(page.locator('.tactical-search-option em')).toContainText('ALPHA-1')
  await page.locator('.tactical-search-option').first().click()
  await expect(page.getByText('缩放 7.56x')).toBeVisible({ timeout: 2000 })
  await page.locator('.tactical-system-card .ghost-btn').first().click()

  await searchInput.fill('beta')
  await expect(page.locator('.tactical-search-option em')).toContainText('BETA-2')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').nth(1).click()

  await expect(page.getByLabel('起点星系')).toHaveValue('阿尔法')
  await expect(page.getByLabel('终点星系')).toHaveValue('贝塔')

  await page.getByRole('button', { name: '计算路径' }).click()
  await expect(page.getByText('路径结果')).toBeVisible()
  await expect(page.locator('tbody tr').first()).toContainText('阿尔法')
  await expect(page.locator('tbody tr').first()).toContainText('贝塔')
  await expect(page.locator('tbody tr').first().locator('.route-type-badge')).toContainText('常规跳跃')

  await page.getByRole('button', { name: '清除起终点' }).click()
  await expect(page.getByLabel('起点星系')).toHaveValue('')
  await expect(page.getByLabel('终点星系')).toHaveValue('')
  await expect(page.locator('.tactical-map-hud')).not.toContainText('直线')
})

test('星系导航勾选是否走土路时会把开关传给后端', async ({ page }) => {
  let requestBody = null

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/boardsystems') {
      return json([
        { system_id: 1, zh_name: '阿尔法', en_name: 'ALPHA-1', x: 0, y: 0, z: 0, security_status: 0.5 },
        { system_id: 2, zh_name: '贝塔', en_name: 'BETA-2', x: 9.461e15, y: 0, z: 0, security_status: 0.1 },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/boardregions') return json([])
    if (method === 'GET' && url.pathname === '/api/boardconstellations') return json([])
    if (method === 'GET' && url.pathname === '/api/boardstargate') return json([])
    if (method === 'POST' && url.pathname === '/api/jumppath') {
      requestBody = body
      return json([])
    }
  })

  await page.goto('/starmap')
  await page.getByLabel('起点星系').fill('阿尔法')
  await page.getByLabel('终点星系').fill('贝塔')
  await page.getByLabel('终点星系').press('Tab')
  await page.getByLabel('是否走土路').check()
  await page.getByRole('button', { name: '计算路径' }).click()

  expect(requestBody).not.toBeNull()
  expect(requestBody.dict_road).toBe(true)
})
