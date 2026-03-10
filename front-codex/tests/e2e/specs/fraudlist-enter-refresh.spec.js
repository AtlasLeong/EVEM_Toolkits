import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

function createJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`
}

test('防诈查询支持回车触发', async ({ page }) => {
  let searchCalls = 0

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/fraudsearch') {
      searchCalls += 1
      expect(body).toEqual({ searchNumber: 'enter-target' })
      return json([
        {
          id: 1,
          account_type: 'QQ',
          fraud_account: '99887766',
          remark: '-',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会--927154656',
        },
      ])
    }
  })

  await page.goto('/fraudlist')
  await page.locator('.search-input').fill('enter-target')
  await page.locator('.search-input').press('Enter')

  await expect(page.locator('tbody tr').first()).toContainText('99887766')
  expect(searchCalls).toBe(1)
})

test('登录态请求会在 access 过期时先刷新 token 再拉取举报记录', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000)
  const expiredAccess = createJwt({ userName: 'atlas123', exp: now - 60 })
  const validRefresh = createJwt({ userName: 'atlas123', exp: now + 3600 })
  const refreshedAccess = createJwt({ userName: 'atlas123', exp: now + 3600 })

  let refreshCalls = 0
  let reportCalls = 0

  await page.addInitScript(
    ({ accessToken, refreshToken }) => {
      window.localStorage.setItem('access_token', accessToken)
      window.localStorage.setItem('refresh_token', refreshToken)
    },
    { accessToken: expiredAccess, refreshToken: validRefresh },
  )

  await installApiMock(page, async ({ url, method, request }) => {
    if (method === 'POST' && url.pathname === '/api/user/token/refresh') {
      refreshCalls += 1
      return json({ access: refreshedAccess })
    }

    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      reportCalls += 1
      expect(await request.headerValue('authorization')).toBe(`Bearer ${refreshedAccess}`)
      return json([
        {
          id: 1,
          fraud_account: '998877',
          account_type: 'QQ',
          report_status: 'pending',
          approver_group: '',
          create_time: '2026-03-09 12:00:00',
        },
      ])
    }
  })

  await page.goto('/fraudlist')
  await expect(page.getByText('我的举报记录 1')).toBeVisible()
  expect(refreshCalls).toBe(1)
  expect(reportCalls).toBe(1)
})
