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

for (const [error, message] of [
  ['Email verification code has expired.', '验证码已过期，请重新获取'],
  ['Email verification code not found.', '请先获取邮箱验证码'],
]) {
  for (const mode of ['register', 'reset']) {
    test(`${mode} ${error} is attached to the verification field without sending mail`, async ({ page }) => {
      let mailRequests = 0
      await installApiMock(page, ({ url, method }) => {
        if (url.pathname === '/api/user/emailcode') mailRequests += 1
        if (method === 'POST' && url.pathname === (mode === 'register' ? '/api/user/register' : '/api/user/forgetPassword')) return json({ error }, 400)
        return json({ duplicate: null })
      })
      await page.goto('/login')
      await page.getByRole('tab', { name: mode === 'register' ? '注册' : '找回密码', exact: true }).click()
      const form = page.locator('form.auth-section')
      if (mode === 'register') await page.getByLabel('用户名', { exact: true }).fill('newpilot')
      await form.locator('input[type="email"]').fill('new-pilot@example.com')
      const verification = page.getByLabel('邮箱验证码', { exact: true })
      await verification.fill('123456')
      await form.locator('input[type="password"]').nth(0).fill('ValidPass_1')
      await form.locator('input[type="password"]').nth(1).fill('ValidPass_1')
      await form.getByRole('button', { name: mode === 'register' ? '注册并登录' : '重置密码', exact: true }).click()
      const errorId = mode === 'register' ? 'register-code-error' : 'reset-code-error'
      await expect(page.locator(`#${errorId}`)).toHaveText(message)
      await expect(verification).toHaveAttribute('aria-invalid', 'true')
      await expect(verification).toHaveAttribute('aria-describedby', errorId)
      await expect(verification).toHaveValue('123456')
      expect(mailRequests).toBe(0)
    })
  }
}
