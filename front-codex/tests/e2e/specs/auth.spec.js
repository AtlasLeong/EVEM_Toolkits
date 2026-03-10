import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { createFakeJwt } from '../helpers/auth'

test('登录成功后跳转到防诈名单并显示用户名', async ({ page }) => {
  const access = createFakeJwt({ userName: 'atlas123' })
  const refresh = createFakeJwt({ userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/login') {
      return json({ access, refresh })
    }
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
  })

  await page.goto('/login')
  await page.locator('input[type="email"]').fill('atlas@example.com')
  await page.locator('input[type="password"]').fill('Password_123')
  await page.locator('form').getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.locator('.top-user-name')).toHaveText('atlas123')
})

test('注册流程可发送验证码并注册后进入站点', async ({ page }) => {
  const access = createFakeJwt({ userName: 'new_user' })
  const refresh = createFakeJwt({ userName: 'new_user' })

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/signupcheck') {
      return json({ duplicate: null })
    }
    if (method === 'POST' && url.pathname === '/api/user/emailcode') {
      return json({ ok: true })
    }
    if (method === 'POST' && url.pathname === '/api/user/register') {
      expect(body).toMatchObject({
        userName: 'new_user',
        email: 'new_user@example.com',
        verificationCode: '246810',
      })
      return json({ access, refresh })
    }
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  await registerForm.locator('input[type="text"]').first().fill('new_user')
  await registerForm.locator('input[type="email"]').fill('new_user@example.com')
  await registerForm.locator('.auth-code-btn').click()
  await expect(registerForm.locator('.auth-code-btn')).toContainText('60s')

  await registerForm.locator('input[type="text"]').nth(1).fill('246810')
  await registerForm.locator('input[type="password"]').nth(0).fill('Password_123')
  await registerForm.locator('input[type="password"]').nth(1).fill('Password_123')
  await registerForm.locator('button.primary-btn').click()

  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.locator('.top-user-name')).toHaveText('new_user')
})

test('找回密码流程可发送验证码并重置成功', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/forgetemailcheck') {
      expect(body).toMatchObject({ email: 'atlas@example.com' })
      return json({ ok: true })
    }
    if (method === 'POST' && url.pathname === '/api/user/emailcode') {
      return json({ ok: true })
    }
    if (method === 'POST' && url.pathname === '/api/user/forgetPassword') {
      expect(body).toMatchObject({
        forgetEmail: 'atlas@example.com',
        forgetEmailVerification: '135790',
      })
      return json({ ok: true })
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  await resetForm.locator('input[type="email"]').fill('atlas@example.com')
  await resetForm.locator('.auth-code-btn').click()
  await expect(resetForm.locator('.auth-code-btn')).toContainText('60s')

  await resetForm.locator('input[type="text"]').fill('135790')
  await resetForm.locator('input[type="password"]').nth(0).fill('NewPassword_1')
  await resetForm.locator('input[type="password"]').nth(1).fill('NewPassword_1')
  await resetForm.locator('button.primary-btn').click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('form.auth-section input[type="email"]')).toHaveValue('atlas@example.com')
  await expect(page.locator('form.auth-section button.primary-btn')).toBeVisible()
})
