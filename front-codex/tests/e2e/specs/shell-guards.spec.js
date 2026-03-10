import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('未登录访问用户设置会跳转到登录页', async ({ page }) => {
  await page.goto('/usersetting')
  await expect(page).toHaveURL(/\/login$/)
})

test('未登录访问诈骗后台会先被鉴权守卫拦到登录页', async ({ page }) => {
  await page.goto('/fraudadmin')
  await expect(page).toHaveURL(/\/login$/)
})

test('登录态顶栏可退出并清空会话', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
  })

  await page.goto('/fraudlist')
  await expect(page.locator('.top-user-name')).toHaveText('atlas123')

  await page.getByRole('button', { name: '退出' }).click()

  await expect(page.locator('.top-user-name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '登录 \\ 注册' })).toBeVisible()

  const tokens = await page.evaluate(() => ({
    access: window.localStorage.getItem('access_token'),
    refresh: window.localStorage.getItem('refresh_token'),
  }))

  expect(tokens.access).toBeNull()
  expect(tokens.refresh).toBeNull()
})
