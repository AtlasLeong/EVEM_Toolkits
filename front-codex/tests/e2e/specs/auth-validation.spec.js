import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('login failure stays on login page and shows chinese error', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/login') {
      return json({ error: 'Invalid credentials' }, 401)
    }
  })

  await page.goto('/login')
  await page.locator('input[type="email"]').fill('atlas@example.com')
  await page.locator('input[type="password"]').fill('WrongPassword')
  await page.locator('form.auth-section .primary-btn').click()

  await expect(page).toHaveURL(/\/login$/)
  await expect(page.locator('.form-error')).toContainText('邮箱或密码错误')
})

test('register duplicate username shows chinese field error', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/signupcheck') {
      if (body.userName === 'atlas123') {
        return json({ duplicate: 'userName', message: 'Username is already taken.' })
      }
      return json({ duplicate: null })
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  const userInput = registerForm.locator('input[type="text"]').first()
  await userInput.fill('atlas123')
  await userInput.blur()

  await expect(registerForm.locator('.form-error').first()).toContainText('该用户名已被使用')
})

test('register duplicate email shows chinese field error', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/signupcheck') {
      if (body.email === 'atlas@example.com') {
        return json({ duplicate: 'email', message: 'Email is already in use.' })
      }
      return json({ duplicate: null })
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  const emailInput = registerForm.locator('input[type="email"]')
  await emailInput.fill('atlas@example.com')
  await emailInput.blur()

  await expect(registerForm.locator('.form-error').first()).toContainText('该邮箱已被使用')
})

test('reset password shows chinese error for unregistered email', async ({ page }) => {
  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/forgetemailcheck') {
      return json({ error: 'Email has not been signup.' }, 400)
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  await resetForm.locator('input[type="email"]').fill('unknown@example.com')
  await resetForm.locator('.auth-code-btn').click()

  await expect(resetForm.locator('.form-error')).toContainText('该邮箱未注册')
})

test('reset code is blocked when forget email check returns duplicate error payload', async ({ page }) => {
  let emailCodeCalled = false

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/forgetemailcheck') {
      return json({ duplicate: 'error', message: 'Email has not been signup.' })
    }
    if (method === 'POST' && url.pathname === '/api/user/emailcode') {
      emailCodeCalled = true
      return json({ ok: true })
    }
  })

  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  await resetForm.locator('input[type="email"]').fill('unknown@example.com')
  await resetForm.locator('.auth-code-btn').click()

  await expect(resetForm.locator('.form-error')).toContainText('该邮箱未注册')
  expect(emailCodeCalled).toBeFalsy()
  await expect(resetForm).not.toContainText('找回密码验证码已发送，请检查邮箱')
})
