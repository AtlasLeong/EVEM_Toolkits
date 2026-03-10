import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

function createJwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.sig`
}

test('举报记录请求刷新 token 失败后会回退到访客态', async ({ page }) => {
  const now = Math.floor(Date.now() / 1000)
  const expiredAccess = createJwt({ userName: 'atlas123', exp: now - 60 })
  const validRefresh = createJwt({ userName: 'atlas123', exp: now + 3600 })

  let refreshCalls = 0
  let reportCalls = 0

  await page.addInitScript(
    ({ accessToken, refreshToken }) => {
      window.localStorage.setItem('access_token', accessToken)
      window.localStorage.setItem('refresh_token', refreshToken)
    },
    { accessToken: expiredAccess, refreshToken: validRefresh },
  )

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'POST' && url.pathname === '/api/user/token/refresh') {
      refreshCalls += 1
      return json({ error: 'refresh expired' }, 401)
    }

    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      reportCalls += 1
      return json({ error: 'unauthorized' }, 401)
    }
  })

  await page.goto('/fraudlist')

  await expect(page.getByRole('button', { name: '登录 \\ 注册' })).toBeVisible()
  await expect(page.locator('.report-open-btn')).toHaveCount(0)
  await expect(page.getByText(/我的举报记录/)).toHaveCount(0)

  const tokens = await page.evaluate(() => ({
    access: window.localStorage.getItem('access_token'),
    refresh: window.localStorage.getItem('refresh_token'),
  }))

  expect(refreshCalls).toBe(1)
  expect(reportCalls).toBe(1)
  expect(tokens.access).toBeNull()
  expect(tokens.refresh).toBeNull()
})
