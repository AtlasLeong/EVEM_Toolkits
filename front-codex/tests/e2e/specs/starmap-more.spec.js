import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

function installStarMapMock(page) {
  return installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/boardsystems') {
      return json([
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
      ])
    }
    if (method === 'GET' && url.pathname === '/api/boardregions') {
      return json([{ region_id: 10, zh_name: '德里克' }])
    }
    if (method === 'GET' && url.pathname === '/api/boardconstellations') {
      return json([{ constellation_id: 100, region_id: 10, zh_name: '静寂谷', x: 4.7305e15, y: 0, z: 0 }])
    }
    if (method === 'GET' && url.pathname === '/api/boardstargate') {
      return json([{ system_id: 1, destination_system_id: 2 }])
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
}

test('星系导航设置起终点后显示直线距离', async ({ page }) => {
  await installStarMapMock(page)
  await page.goto('/starmap')

  const searchInput = page.locator('.tactical-map-search-input')
  await searchInput.fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').first().click()

  await searchInput.fill('beta')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').nth(1).click()

  await expect(page.locator('.tactical-map-hud')).toContainText('直线 1.00 光年')
})

test('星系导航重置视图后缩放不再停留在定位倍率', async ({ page }) => {
  await installStarMapMock(page)
  await page.goto('/starmap')

  const searchInput = page.locator('.tactical-map-search-input')
  await searchInput.fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await expect(page.locator('.tactical-map-hud')).toContainText('缩放 7.56x')

  await page.getByRole('button', { name: '重置视图' }).click()
  await expect(page.locator('.tactical-map-hud')).not.toContainText('缩放 7.56x')
})
