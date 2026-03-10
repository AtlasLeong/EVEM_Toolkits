import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('星系导航未设置起终点时阻止计算并显示提示', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/boardsystems') return json([])
    if (method === 'GET' && url.pathname === '/api/boardregions') return json([])
    if (method === 'GET' && url.pathname === '/api/boardconstellations') return json([])
    if (method === 'GET' && url.pathname === '/api/boardstargate') return json([])
  })

  await page.goto('/starmap')
  await page.getByRole('button', { name: '计算路径' }).click()

  await expect(page.locator('.form-error')).toContainText('请先选择起点和终点星系')
})
