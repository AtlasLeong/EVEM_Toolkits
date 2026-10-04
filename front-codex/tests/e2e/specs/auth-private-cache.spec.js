import { test, expect } from '@playwright/test'
import { createFakeJwt, seedAuthenticatedSession } from '../helpers/auth'
import { installApiMock, json } from '../helpers/api'

const accountB = createFakeJwt({ user_id: 12, userName: 'pilot-B', email: 'new-pilot@example.com' })

function deferred() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

async function privateFixture(page, { delayedPrice } = {}) {
  const priceReads = []
  const programmeReads = []
  await installApiMock(page, async ({ url, method, request }) => {
    const authorization = await request.headerValue('authorization')
    const userId = authorization ? JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString()).user_id : null
    if (method === 'POST' && url.pathname === '/api/user/login') return json({ access: accountB, refresh: accountB })
    if (url.pathname === '/api/planetresourceprice' && method === 'GET') {
      priceReads.push({ userId, resetPrice: url.searchParams.get('resetPrice') })
      if (userId === 11 && url.searchParams.get('resetPrice') === 'user' && delayedPrice) await delayedPrice.promise
      return json([{ resource_name: '光泽合金', resource_type: '合金', resource_price: url.searchParams.get('resetPrice') === 'default' ? 10 : userId === 11 ? 111 : 222 }])
    }
    if (url.pathname === '/api/programme' && method === 'GET') {
      programmeReads.push(userId)
      return json([{ programme_id: userId * 100, programme_name: userId === 11 ? 'A 私有方案' : 'B 私有方案', programme_desc: '' }])
    }
    if (url.pathname === '/api/killboard/access/') return json({ can_view_killboard: false })
    if (url.pathname === '/api/tactical/usage/access/') return json({ can_view_usage: false })
    return json([])
  })
  return { priceReads, programmeReads }
}

async function openPrices(page) {
  await page.getByRole('button', { name: '预设价格', exact: true }).click()
  return page.getByLabel('光泽合金预设价格', { exact: true })
}

async function switchFromAnotherTab(page, token) {
  const peer = await page.context().newPage()
  await installApiMock(peer, () => json([]))
  await peer.goto('/fraudlist')
  await peer.evaluate(access => {
    localStorage.removeItem('refresh_token')
    localStorage.setItem('access_token', access)
  }, token)
  await expect(page.locator('.top-user-name')).toHaveText('pilot-B')
  await peer.close()
}

test('logout then login as B clears fresh A private price cache and edited component rows', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 11, userName: 'pilot-A' })
  const { priceReads } = await privateFixture(page)
  await page.goto('/usersetting')
  const inputA = await openPrices(page)
  await expect(inputA).toHaveValue('111')
  await inputA.fill('333')
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
  await page.getByLabel('邮箱', { exact: true }).fill('new-pilot@example.com')
  await page.getByLabel('密码', { exact: true }).fill('Password_123')
  await page.getByRole('tabpanel').getByRole('button', { name: '登录', exact: true }).click()
  await expect(page).toHaveURL(/\/usersetting$/)
  await expect(page.getByRole('button', { name: '修改密码', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const inputB = await openPrices(page)
  await expect(inputB).toHaveValue('222')
  expect(priceReads.filter(read => read.userId === 12 && read.resetPrice === 'user')).toHaveLength(1)
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('real cross-tab access-only account switch clears cached programmes and closes A modal state', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 11, userName: 'pilot-A' })
  const { programmeReads } = await privateFixture(page)
  await page.goto('/planetary')
  await page.locator('.planetary-open-btn').click()
  let modal = page.locator('.calculator-card')
  await modal.locator('.calculator-select-trigger').click()
  await expect(modal.getByRole('button', { name: 'A 私有方案', exact: true })).toBeVisible()
  await switchFromAnotherTab(page, accountB)
  await expect(modal).toHaveCount(0)
  expect(await page.evaluate(() => ({ inert: document.getElementById('root').inert, overflow: document.body.style.overflow }))).toEqual({ inert: false, overflow: '' })
  await page.locator('.planetary-open-btn').click()
  modal = page.locator('.calculator-card')
  await modal.locator('.calculator-select-trigger').click()
  await expect(modal.getByRole('button', { name: 'B 私有方案', exact: true })).toBeVisible()
  await expect(modal.getByRole('button', { name: 'A 私有方案', exact: true })).toHaveCount(0)
  expect(programmeReads).toEqual([11, 12])
})

test('partial cross-tab token replacement hides A private data until the B token pair agrees', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 11, userName: 'pilot-A' })
  const { priceReads } = await privateFixture(page)
  await page.goto('/usersetting')
  await expect(await openPrices(page)).toHaveValue('111')
  const peer = await page.context().newPage()
  try {
    await installApiMock(peer, () => json([]))
    await peer.goto('/fraudlist')
    await peer.evaluate(token => localStorage.setItem('access_token', token), accountB)
    await expect(page).toHaveURL(/\/login$/)
    await expect(page.locator('.settings-price-input')).toHaveCount(0)
    expect(priceReads.filter(read => read.userId === 12)).toHaveLength(0)
    expect(await page.evaluate(() => Boolean(localStorage.getItem('access_token') && localStorage.getItem('refresh_token')))).toBe(true)
    await peer.evaluate(token => localStorage.setItem('refresh_token', token), accountB)
    await expect(page).toHaveURL(/\/usersetting$/)
    await expect(await openPrices(page)).toHaveValue('222')
    expect(priceReads.filter(read => read.userId === 12 && read.resetPrice === 'user')).toHaveLength(1)
  } finally {
    await peer.close()
  }
})

test('a delayed A response cannot repopulate B private prices after real cross-tab account switch', async ({ page }) => {
  const gate = deferred()
  try {
    await seedAuthenticatedSession(page, { user_id: 11, userName: 'pilot-A' })
    const { priceReads } = await privateFixture(page, { delayedPrice: gate })
    await page.goto('/usersetting')
    await openPrices(page)
    await expect.poll(() => priceReads.some(read => read.userId === 11 && read.resetPrice === 'user')).toBe(true)
    await switchFromAnotherTab(page, accountB)
    const inputB = await openPrices(page)
    await expect(inputB).toHaveValue('222')
    const lateResponse = page.waitForResponse(response => response.url().includes('/planetresourceprice?resetPrice=user') && response.request().headers().authorization !== `Bearer ${accountB}`)
    gate.release()
    await (await lateResponse).finished()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(inputB).toHaveValue('222')
    await expect(page.getByRole('alert')).toHaveCount(0)
    expect(priceReads.filter(read => read.userId === 12 && read.resetPrice === 'user')).toHaveLength(1)
  } finally {
    gate.release()
  }
})

test('normal token rotation for the same user preserves edited rows and fresh private queries', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 11, userName: 'pilot-A' })
  const { priceReads } = await privateFixture(page)
  await page.goto('/usersetting')
  const input = await openPrices(page)
  await expect(input).toHaveValue('111')
  await input.fill('333')
  const rotated = createFakeJwt({ user_id: 11, userName: 'pilot-A', jti: 'rotated' })
  await page.evaluate(token => {
    localStorage.setItem('access_token', token)
    localStorage.setItem('refresh_token', token)
    window.dispatchEvent(new Event('auth:changed'))
  }, rotated)
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(input).toHaveValue('333')
  expect(priceReads.filter(read => read.resetPrice === 'user')).toHaveLength(1)
})

for (const mode of ['login', 'register']) {
  test(`a pending public ${mode} cannot overwrite B credentials after a real cross-tab login`, async ({ page }) => {
    const gate = deferred()
    const accountA = createFakeJwt({ user_id: 11, userName: 'pilot-A' })
    const endpoint = `/api/user/${mode}`
    let authRequests = 0
    let mailRequests = 0
    try {
      await installApiMock(page, async ({ url, method }) => {
        if (url.pathname === '/api/user/emailcode') mailRequests += 1
        if (url.pathname === endpoint && method === 'POST') {
          authRequests += 1
          await gate.promise
          return json({ access: accountA, refresh: accountA })
        }
        if (url.pathname === '/api/user/signupcheck') return json({ duplicate: null })
        if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: false, can_view_usage: false })
        return json([])
      })
      await page.goto('/login')
      if (mode === 'register') {
        await page.getByRole('tab', { name: '注册', exact: true }).click()
        await page.getByLabel('用户名', { exact: true }).fill('pilot-A')
        await page.getByLabel('邮箱验证码', { exact: true }).fill('123456')
        await page.getByLabel('确认密码', { exact: true }).fill('ValidPass_1')
      }
      await page.getByLabel('邮箱', { exact: true }).fill('pilot-A@example.com')
      await page.getByLabel('密码', { exact: true }).fill('ValidPass_1')
      await page.getByRole('tabpanel').getByRole('button', { name: mode === 'register' ? '注册并登录' : '登录', exact: true }).click()
      await expect.poll(() => authRequests).toBe(1)
      await switchFromAnotherTab(page, accountB)
      await expect(page).toHaveURL(/\/fraudlist$/)
      const lateResponse = page.waitForResponse(response => new URL(response.url()).pathname === endpoint)
      gate.release()
      await (await lateResponse).finished()
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      expect(await page.evaluate(() => ({ access: localStorage.getItem('access_token'), refresh: localStorage.getItem('refresh_token') }))).toEqual({ access: accountB, refresh: null })
      await expect(page.locator('.top-user-name')).toHaveText('pilot-B')
      await expect(page).toHaveURL(/\/fraudlist$/)
      expect(mailRequests).toBe(0)
    } finally {
      gate.release()
    }
  })
}
