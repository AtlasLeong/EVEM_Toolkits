import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const privateRoutes = ['/feedback', '/usersetting', '/market/admin', '/fraudadmin', '/licenseadmin', '/corporations/manage', '/corporations/review', '/starsea/mine', '/starsea/new', '/starsea/review', '/starsea/review/12', '/starsea/12/edit', '/tactical/usage', '/killboard', '/killboard/admin', '/killboard/12']

for (const path of privateRoutes) {
  test(`guest ${path} requires login without sending a private API request`, async ({ page }) => {
    const requests = []
    await installApiMock(page, ({ url }) => {
      requests.push(url.pathname)
      return json({ detail: 'A guest must not load private resources.' }, 403)
    })
    await page.goto(path)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.getByRole('status')).toHaveText('此页面需要登录。完成登录后将返回刚才的页面。')
    await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
    expect(await page.evaluate(() => history.state?.usr?.from)).toBe(path)
    expect(requests).toEqual([])
  })
}

test('guest entry stays on the public fraud list and describes normal registration honestly', async ({ page }) => {
  await installApiMock(page, () => json([]))
  await page.goto('/login')
  await expect(page.getByText('普通工具可作为访客浏览', { exact: true })).toBeVisible()
  await expect(page.getByRole('note')).toContainText('新邮箱可通过验证码注册')
  await expect(page.getByRole('note')).toContainText('管理与协作资源还需相应授权')
  await page.getByRole('link', { name: '访客模式', exact: true }).click()
  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.getByRole('heading', { name: '诈骗名单', exact: true })).toBeVisible()
  await expect(page.locator('.report-open-btn')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
})

test('ordinary public tools render for guests without private capability calls', async ({ page }) => {
  const privateRequests = []
  await installApiMock(page, ({ url }) => {
    if (url.pathname.startsWith('/api/killboard/') || url.pathname.startsWith('/api/tactical/')) privateRequests.push(url.pathname)
    if (url.pathname === '/api/market/items/') return json({ count: 0, results: [] })
    if (url.pathname === '/api/community/corporations/' || url.pathname === '/api/starsea/posts/') return json({ count: 0, results: [] })
    return json([])
  })
  for (const [path, heading] of [['/market', '市场价格'], ['/manufacturing', '制造估价'], ['/planetary', '行星资源'], ['/corporations', '军团大厅'], ['/starsea', '星海见闻']]) {
    await page.goto(path)
    await expect(page).toHaveURL(new RegExp(`${path}$`))
    await expect(page.getByRole('heading', { name: heading, exact: true }).first()).toBeVisible()
  }
  expect(privateRequests).toEqual([])
})

test('guest tactical introduction never opens organization APIs or sockets', async ({ page }) => {
  const requests = []
  const sockets = []
  page.on('websocket', socket => {
    if (new URL(socket.url()).pathname.startsWith('/ws/tactical/')) sockets.push(socket.url())
  })
  await installApiMock(page, ({ url }) => {
    requests.push(url.pathname)
    return json({ detail: 'A guest must not load organization state.' }, 403)
  })
  await page.goto('/tactical?organization=12')
  await expect(page.getByRole('link', { name: '登录后进入战术板' })).toBeVisible()
  expect(requests).toEqual([])
  expect(sockets).toEqual([])
  await page.getByRole('link', { name: '登录后进入战术板' }).click()
  await expect(page).toHaveURL(/\/login\?next=%2Ftactical%3Forganization%3D12$/)
})
