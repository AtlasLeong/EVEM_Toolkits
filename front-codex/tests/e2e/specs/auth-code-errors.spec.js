import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('注册发送验证码失败时显示接口错误', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/signupcheck') {
      return json({ duplicate: null })
    }
    if (method === 'POST' && url.pathname === '/api/user/emailcode') {
      return json({ error: '验证码服务暂不可用' }, 500)
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  await registerForm.locator('input[type="email"]').fill('atlas@example.com')
  await registerForm.locator('.auth-code-btn').click()

  await expect(registerForm).toContainText('验证码服务暂不可用')
})

test('找回密码发送验证码失败时显示接口错误', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/forgetemailcheck') {
      return json({ ok: true })
    }
    if (method === 'POST' && url.pathname === '/api/user/emailcode') {
      return json({ error: '邮箱服务暂不可用' }, 500)
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  await resetForm.locator('input[type="email"]').fill('atlas@example.com')
  await resetForm.locator('.auth-code-btn').click()

  await expect(resetForm).toContainText('邮箱服务暂不可用')
})
