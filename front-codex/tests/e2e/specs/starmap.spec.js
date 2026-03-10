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
      expect(body).toMatchObject({ start_system: '阿尔法', end_system: '贝塔' })
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

  const searchInput = page.locator('.tactical-map-search-input')
  await searchInput.fill('alpha')
  await expect(page.locator('.tactical-search-option em')).toContainText('ALPHA-1')
  await page.locator('.tactical-search-option').first().click()
  await expect(page.getByText('缩放 7.56x')).toBeVisible({ timeout: 2000 })
  await page.locator('.tactical-system-card .ghost-btn').first().click()

  await searchInput.fill('beta')
  await expect(page.locator('.tactical-search-option em')).toContainText('BETA-2')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').nth(1).click()

  await expect(page.locator('input[list="systems-list"]').nth(0)).toHaveValue('阿尔法')
  await expect(page.locator('input[list="systems-list"]').nth(1)).toHaveValue('贝塔')

  await page.getByRole('button', { name: '计算路径' }).click()
  await expect(page.getByText('路径结果')).toBeVisible()
  await expect(page.locator('tbody tr').first()).toContainText('阿尔法')
  await expect(page.locator('tbody tr').first()).toContainText('贝塔')
})
