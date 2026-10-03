import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('guest administrator login shows the form without a disabled-query loading message or access request', async ({ page }) => {
  let accessRequests = 0
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/fraudadmincheck') accessRequests += 1
    return json({ message: 'UnAuthorized Users' })
  })
  await page.goto('/fraudlogin')
  await expect(page.locator('input[type="email"]')).toBeVisible()
  await expect(page.getByRole('button', { name: '管理员登录', exact: true })).toBeEnabled()
  await expect(page.getByText('正在验证当前账号的管理员权限...')).toHaveCount(0)
  expect(accessRequests).toBe(0)
})

test('authenticated administrator checks show progress only until the permission response settles', async ({ page }) => {
  await seedAuthenticatedSession(page)
  let release
  const responseReady = new Promise(resolve => { release = resolve })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/fraudadmincheck') {
      await responseReady
      return json({ message: 'UnAuthorized Users' })
    }
    return json([])
  })
  await page.goto('/fraudlogin')
  await expect(page.getByText('正在验证当前账号的管理员权限...')).toBeVisible()
  release()
  await expect(page.getByRole('alert')).toHaveText('当前登录账号没有管理员权限')
  await expect(page.getByText('正在验证当前账号的管理员权限...')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '切换账号', exact: true })).toBeVisible()
})
