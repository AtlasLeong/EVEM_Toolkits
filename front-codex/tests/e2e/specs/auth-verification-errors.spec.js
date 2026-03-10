import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('register wrong verification code shows chinese field error', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/register') {
      expect(body).toMatchObject({
        userName: 'atlas123',
        email: 'atlas@example.com',
        verificationCode: '000000',
      })
      return json({ error: 'Wrong Email verification code.' }, 400)
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  const textInputs = registerForm.locator('input[type="text"]')
  const emailInput = registerForm.locator('input[type="email"]')
  const passwordInputs = registerForm.locator('input[type="password"]')

  await textInputs.nth(0).fill('atlas123')
  await emailInput.fill('atlas@example.com')
  await textInputs.nth(1).fill('000000')
  await passwordInputs.nth(0).fill('ValidPass_1')
  await passwordInputs.nth(1).fill('ValidPass_1')
  await registerForm.getByRole('button', { name: '注册并登录' }).click()

  await expect(registerForm.locator('.form-error')).toContainText('邮箱验证码错误')
})

test('reset password wrong verification code shows chinese field error', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/forgetPassword') {
      expect(body).toMatchObject({
        forgetEmail: 'atlas@example.com',
        forgetEmailVerification: '000000',
      })
      return json({ error: 'Wrong Email verification code.' }, 400)
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  const emailInput = resetForm.locator('input[type="email"]')
  const textInput = resetForm.locator('input[type="text"]')
  const passwordInputs = resetForm.locator('input[type="password"]')

  await emailInput.fill('atlas@example.com')
  await textInput.fill('000000')
  await passwordInputs.nth(0).fill('ValidPass_1')
  await passwordInputs.nth(1).fill('ValidPass_1')
  await resetForm.getByRole('button', { name: '重置密码' }).click()

  await expect(resetForm.locator('.form-error')).toContainText('邮箱验证码错误')
})
