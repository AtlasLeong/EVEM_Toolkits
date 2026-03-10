import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../helpers/auth'

test('用户设置中新密码不一致时阻止提交并提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await page.goto('/usersetting')

  const passwordInputs = page.locator('input[type="password"]')
  await passwordInputs.nth(0).fill('OldPwd_1')
  await passwordInputs.nth(1).fill('NewPwd_1')
  await passwordInputs.nth(2).fill('Mismatch_1')
  await page.getByRole('button', { name: '保存密码' }).click()

  await expect(page.locator('.form-error')).toContainText('两次输入的新密码不一致')
})
