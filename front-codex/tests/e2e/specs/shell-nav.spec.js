import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('顶栏导航高亮正确且点击 Logo 返回防诈名单', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([])
    }
  })

  await page.goto('/planetary')

  await expect(page.locator('.nav-item.active')).toContainText('行星资源')
  await page.locator('.brand').click()
  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.locator('.nav-item.active')).toContainText('防诈名单')
})
