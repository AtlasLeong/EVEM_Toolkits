import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('星系导航计算后显示分段预览与聚合结果', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/boardsystems') {
      return json([
        { system_id: 1, zh_name: '阿尔法', en_name: 'ALPHA-1', x: 0, y: 0, z: 0, security_status: 0.5 },
        { system_id: 2, zh_name: '贝塔', en_name: 'BETA-2', x: 9.461e15, y: 0, z: 0, security_status: 0.1 },
        { system_id: 3, zh_name: '伽马', en_name: 'GAMMA-3', x: 1.8922e16, y: 0, z: 0, security_status: -0.1 },
        { system_id: 4, zh_name: '德尔塔', en_name: 'DELTA-4', x: 2.8383e16, y: 0, z: 0, security_status: -0.4 },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/boardregions') {
      return json([{ region_id: 10, zh_name: '德里克' }])
    }
    if (method === 'GET' && url.pathname === '/api/boardconstellations') {
      return json([{ constellation_id: 100, region_id: 10, zh_name: '静寂谷', x: 1.41915e16, y: 0, z: 0 }])
    }
    if (method === 'GET' && url.pathname === '/api/boardstargate') {
      return json([
        { system_id: 1, destination_system_id: 2 },
        { system_id: 2, destination_system_id: 3 },
        { system_id: 3, destination_system_id: 4 },
      ])
    }
    if (method === 'POST' && url.pathname === '/api/jumppath') {
      expect(body).toMatchObject({ start_system: '阿尔法', end_system: '德尔塔' })
      return json([
        {
          start: { system_id: 1, zh_name: '阿尔法', move_type: '常规跳跃' },
          end: { system_id: 2, zh_name: '贝塔', move_type: '常规跳跃' },
          distance: '1.00',
        },
        {
          start: { system_id: 2, zh_name: '贝塔', move_type: '常规跳跃' },
          end: { system_id: 3, zh_name: '伽马', move_type: '常规跳跃' },
          distance: '1.20',
        },
        {
          start: { system_id: 3, zh_name: '伽马', move_type: '诱导跃迁' },
          end: { system_id: 4, zh_name: '德尔塔', move_type: '诱导跃迁' },
          distance: '3.50',
        },
      ])
    }
  })

  await page.goto('/starmap')
  await page.locator('input[list="systems-list"]').nth(0).fill('阿尔法')
  await page.locator('input[list="systems-list"]').nth(1).fill('德尔塔')
  await page.getByRole('button', { name: '计算路径' }).click()

  const summaryPanel = page
    .locator('.panel')
    .filter({ has: page.getByRole('heading', { name: '分段预览' }) })
    .first()

  await expect(summaryPanel).toBeVisible()
  await expect(summaryPanel.getByText(/常规跳跃/)).toBeVisible()
  await expect(summaryPanel.getByText(/2 段/)).toBeVisible()
  await expect(summaryPanel.getByText(/诱导跃迁/)).toBeVisible()
  await expect(page.getByText(/总距离 5\.70/)).toBeVisible()
})
