import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('管理员新增记录缺少必填项时显示错误提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlogin') {
      return json({ message: 'Authorized Users' })
    }
    if (method === 'GET' && url.pathname === '/api/fraudadmingroup') {
      return json([{ value: '11', label: '吉商委员会' }])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlist') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json([])
    }
  })

  await page.goto('/fraudadmin')
  await page.locator('.primary-btn').filter({ hasText: '新增记录' }).click()

  await expect(page.locator('.form-error')).toContainText('请填写账号并选择来源群组')
})
