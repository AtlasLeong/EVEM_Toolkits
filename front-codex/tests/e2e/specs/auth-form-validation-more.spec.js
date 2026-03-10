import { test, expect } from '@playwright/test'

test('注册时密码格式错误会阻止提交并显示错误', async ({ page }) => {
  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  const textInputs = registerForm.locator('input[type="text"]')
  const emailInput = registerForm.locator('input[type="email"]')
  const passwordInputs = registerForm.locator('input[type="password"]')

  await textInputs.nth(0).fill('atlas123')
  await emailInput.fill('atlas@example.com')
  await textInputs.nth(1).fill('123456')
  await passwordInputs.nth(0).fill('bad space')
  await passwordInputs.nth(1).fill('bad space')
  await registerForm.getByRole('button', { name: '注册并登录' }).click()

  await expect(registerForm.locator('.form-error')).toContainText('仅支持字母')
})

test('注册时确认密码不一致会阻止提交并显示错误', async ({ page }) => {
  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(1).click()

  const registerForm = page.locator('form.auth-section')
  const textInputs = registerForm.locator('input[type="text"]')
  const emailInput = registerForm.locator('input[type="email"]')
  const passwordInputs = registerForm.locator('input[type="password"]')

  await textInputs.nth(0).fill('atlas123')
  await emailInput.fill('atlas@example.com')
  await textInputs.nth(1).fill('123456')
  await passwordInputs.nth(0).fill('ValidPass_1')
  await passwordInputs.nth(1).fill('Mismatch_2')
  await registerForm.getByRole('button', { name: '注册并登录' }).click()

  await expect(registerForm.locator('.form-error')).toContainText('两次输入的密码不一致')
})

test('找回密码时确认密码不一致会阻止提交并显示错误', async ({ page }) => {
  await page.goto('/login')
  await page.locator('.auth-tabs .auth-tab').nth(2).click()

  const resetForm = page.locator('form.auth-section')
  const emailInput = resetForm.locator('input[type="email"]')
  const textInput = resetForm.locator('input[type="text"]')
  const passwordInputs = resetForm.locator('input[type="password"]')

  await emailInput.fill('atlas@example.com')
  await textInput.fill('123456')
  await passwordInputs.nth(0).fill('ValidPass_1')
  await passwordInputs.nth(1).fill('Mismatch_2')
  await resetForm.getByRole('button', { name: '重置密码' }).click()

  await expect(resetForm.locator('.form-error')).toContainText('两次输入的新密码不一致')
})
