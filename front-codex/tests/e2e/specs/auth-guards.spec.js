import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('authenticated user visiting login is redirected to fraud list', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
  })

  await page.goto('/login')
  await expect(page).toHaveURL(/\/fraudlist$/)
})

test('admin login failure stays on page and shows chinese error', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/login') {
      return json({ error: 'Invalid credentials' }, 401)
    }
  })

  await page.goto('/fraudlogin')
  await page.locator('input[type="email"]').fill('admin@example.com')
  await page.locator('input[type="password"]').fill('WrongPassword')
  await page.locator('form.auth-section .primary-btn').click()

  await expect(page).toHaveURL(/\/fraudlogin$/)
  await expect(page.locator('.form-error')).toContainText('管理员邮箱或密码错误')
})
