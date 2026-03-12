import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('管理员登录成功后进入诈骗后台', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/login') {
      return json({
        access: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyTmFtZSI6ImFkbWluVXNlciIsImV4cCI6NDA3MDkwODgwMH0.signature',
        refresh: 'eyJhbGciOiJIUzI1NiJ9.eyJ1c2VyTmFtZSI6ImFkbWluVXNlciIsImV4cCI6NDA3MDkwODgwMH0.signature',
      })
    }
    if (method === 'GET' && url.pathname === '/api/fraudadmincheck') {
      return json({ message: 'Authorized Users' })
    }
    if (method === 'GET' && url.pathname === '/api/fraudadmingroup') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlist') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json([])
    }
  })

  await page.goto('/fraudlogin')
  await page.locator('input[type="email"]').fill('admin@example.com')
  await page.locator('input[type="password"]').fill('AdminPassword_1')
  await page.locator('form.auth-section .primary-btn').click()

  await expect(page).toHaveURL(/\/fraudadmin$/)
  await expect(page.getByRole('heading', { name: '诈骗名单管理' })).toBeVisible()
})
