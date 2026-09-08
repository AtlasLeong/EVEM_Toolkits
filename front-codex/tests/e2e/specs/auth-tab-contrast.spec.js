import { test, expect } from '@playwright/test'

test('认证模式选中方块为黑底白字，其他区域保持原色', async ({ page }) => {
  await page.goto('/login')
  const tabs = page.locator('.auth-tabs')
  for (const name of ['登录', '注册', '找回密码']) {
    await tabs.getByRole('button', { name, exact: true }).click()
    const active = tabs.locator('.auth-tab.active')
    await expect(active).toHaveText(name)
    await expect(active).toHaveCSS('background-color', 'rgb(36, 36, 34)')
    await expect(active).toHaveCSS('color', 'rgb(255, 255, 255)')
    for (const inactive of await tabs.locator('.auth-tab:not(.active)').all()) {
      await expect(inactive).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(inactive).toHaveCSS('color', 'rgb(108, 106, 99)')
    }
    await expect(page.locator('.login-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    const fields = page.locator('.login-card .text-input:not(.auth-input):visible, .login-card .auth-input-shell:visible')
    expect(await fields.count()).toBeGreaterThan(0)
    for (const field of await fields.all()) {
      await expect(field).toHaveCSS('background-color', 'rgb(250, 249, 246)')
    }
  }
})
