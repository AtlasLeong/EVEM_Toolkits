import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

for (const route of ['/fraudlist', '/planetary', '/starmap', '/infocenter', '/usersetting', '/fraudadmin', '/licenseadmin', '/login', '/fraudlogin']) {
  test(`${route} 使用统一深色表面与可读文字`, async ({ page }) => {
    const runtimeErrors = []
    page.on('pageerror', error => runtimeErrors.push(error.message))
    page.on('console', message => { if (message.type() === 'error') runtimeErrors.push(message.text()) })
    if (['/usersetting', '/fraudadmin', '/licenseadmin'].includes(route)) await seedAuthenticatedSession(page)
    await installApiMock(page, async ({ url }) => {
      if (url.pathname === '/api/fraudadmincheck') return json({ message: 'Authorized Users' })
      if (url.pathname === '/api/license/codes/') return json({ count: 0, results: [] })
      return json([])
    })
    await page.goto(route)
    await expect(page.locator('.panel, .login-card').first()).toHaveCSS('background-color', 'rgb(19, 28, 36)')
    await expect(page.locator('body')).toHaveCSS('color', 'rgb(231, 238, 245)')
    const fields = page.locator('.text-input:visible, .search-box:visible, .auth-input-shell:visible')
    if (await fields.count()) {
      const color = await fields.first().evaluate(el => getComputedStyle(el).backgroundColor)
      expect(['rgb(11, 17, 23)', 'rgba(0, 0, 0, 0)']).toContain(color)
    }
    expect(runtimeErrors).toEqual([])
  })
}

test('主操作对比度与键盘焦点、减少动画偏好', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/login')
  const action = page.locator('form .primary-btn')
  await expect(action).toHaveCSS('background-color', 'rgb(24, 191, 220)')
  await expect(action).toHaveCSS('color', 'rgb(7, 21, 29)')
  await action.focus()
  await expect(action).toHaveCSS('outline-style', 'solid')
  await expect(action).toHaveCSS('transition-duration', '0s')
})
