import { test, expect } from '@playwright/test'
import { createFakeJwt } from '../helpers/auth'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { openFilter } from '../helpers/planetary-ui'

const resource = '\u5149\u6cfd\u5408\u91d1'
const privatePrice = 910001
const publicPrice = 1200
const token = (id, type, extra = {}) => createFakeJwt({ user_id: id, userName: `synthetic-${id}`, token_type: type, ...extra })

async function seedPair(page, access, refresh) {
  await page.addInitScript(({ access, refresh }) => {
    localStorage.clear()
    if (access) localStorage.setItem('access_token', access)
    if (refresh) localStorage.setItem('refresh_token', refresh)
  }, { access, refresh })
}

async function priceFixture(page) {
  const calls = []
  await installApiMock(page, async ({ request, url, method }) => {
    const authorization = await request.headerValue('authorization')
    const authorized = Boolean(authorization)
    const call = { method, path: url.pathname, authorized }
    calls.push(call)
    if (method === 'GET' && url.pathname === '/api/planetresources') return json([{ label: 'synthetic resources', options: [{ label: resource, value: resource, icon: TINY_ICON }] }])
    if (method === 'GET' && url.pathname === '/api/regions') return json([{ r_id: 1, r_title: 'synthetic region', r_safetylvl: 0.5 }])
    // A read-only public query. Every authentication and business mutation POST is rejected below.
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') return json([{ resource_name: resource, resource_type: 'synthetic', region: 'synthetic region', region_security: 0.5, constellation: 'synthetic', solar_system: 'LOCAL', solar_system_security: -0.8, planet_id: 'P1', resource_level: 4, resource_yield: 120, fuel_value: 240, icon: TINY_ICON }])
    if (method === 'GET' && url.pathname === '/api/planetresourceprice/default') return json([{ resource_name: resource, resource_type: 'synthetic', resource_price: publicPrice }])
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      if (!authorized) return json({ detail: 'Authentication required' }, 401)
      const userId = JSON.parse(Buffer.from(authorization.split('.')[1], 'base64url').toString()).user_id
      return json([{ resource_name: resource, resource_type: 'synthetic', resource_price: userId === 'B' ? 920002 : privatePrice }])
    }
    if (method === 'GET' && ['/api/programme', '/api/killboard/access/', '/api/tactical/usage/access/'].includes(url.pathname)) return json([])
    return json({ detail: 'No mutation or unknown API allowed in this closed fixture' }, 405)
  })
  await page.routeWebSocket('**', socket => socket.close())
  return calls
}

async function openCalculatedPrices(page) {
  await openFilter(page.locator('.resource-disclosure'))
  await page.getByRole('button', { name: resource }).click()
  await page.getByRole('button', { name: '\u641c\u7d22', exact: true }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '\u52a0\u5165\u8ba1\u7b97\u5668' }).click()
  const modal = page.locator('.calculator-card')
  await modal.getByRole('button', { name: '\u52a0\u8f7d\u9884\u8bbe\u4ef7\u683c', exact: true }).click()
  return modal.locator('.calculator-table tbody td:nth-child(9) input')
}

for (const expiredAccess of [false, true]) {
  test(`mixed identities remain guest and load only public default prices (${expiredAccess ? 'expired' : 'valid'} access A / refresh B)`, async ({ page }) => {
    await seedPair(page, token('A', 'access', expiredAccess ? { exp: Math.floor(Date.now() / 1000) - 60 } : {}), token('B', 'refresh'))
    const calls = await priceFixture(page)
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error.message))
    await page.goto('/planetary')
    const input = await openCalculatedPrices(page)
    await expect(page.locator('.calculator-auth-hint')).toBeVisible()
    await expect(page.locator('.top-user-name')).toHaveCount(0)
    await expect(input).toHaveValue(String(publicPrice))
    expect(calls.filter(call => call.path === '/api/planetresourceprice')).toEqual([])
    expect(calls.filter(call => call.path === '/api/planetresourceprice/default')).toEqual([{ method: 'GET', path: '/api/planetresourceprice/default', authorized: false }])
    expect(calls.filter(call => call.path === '/api/user/token/refresh')).toEqual([])
    expect(calls.filter(call => call.path === '/api/programme')).toEqual([])
    expect(calls.filter(call => call.authorized)).toEqual([])
    expect(pageErrors).toEqual([])
  })
}

for (const session of ['access-only', 'same-id-rotated-pair']) {
  test(`${session} retains authenticated private preset prices`, async ({ page }) => {
    await seedPair(page, token('A', 'access', { jti: 'new-access' }), session === 'access-only' ? null : token('A', 'refresh', { jti: 'older-refresh' }))
    const calls = await priceFixture(page)
    await page.goto('/planetary')
    await expect(page.locator('.top-user-name')).toHaveText('synthetic-A')
    await expect(await openCalculatedPrices(page)).toHaveValue(String(privatePrice))
    await expect(page.locator('.calculator-auth-hint')).toHaveCount(0)
    expect(calls.filter(call => call.path === '/api/planetresourceprice')).toEqual([{ method: 'GET', path: '/api/planetresourceprice', authorized: true }])
    expect(calls.filter(call => call.path === '/api/planetresourceprice/default')).toEqual([])
    expect(calls.filter(call => call.path === '/api/user/token/refresh')).toEqual([])
  })
}

test('mixed direct private GET strips caller Authorization and remains a backend 401 without refreshing B', async ({ page }) => {
  await seedPair(page, token('A', 'access'), token('B', 'refresh'))
  const calls = await priceFixture(page)
  await page.goto('/planetary')
  await expect(page.locator('.login-btn')).toBeVisible()
  const response = await page.evaluate(async () => {
    const { default: fetchWithAuth } = await import('/src/services/fetchWithAuth.js')
    const res = await fetchWithAuth(`${location.origin}/api/planetresourceprice?resetPrice=user`, { headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` } })
    return { status: res.status, body: await res.json() }
  })
  expect(response).toEqual({ status: 401, body: { detail: 'Authentication required' } })
  expect(calls.filter(call => call.path === '/api/planetresourceprice')).toEqual([{ method: 'GET', path: '/api/planetresourceprice', authorized: false }])
  expect(calls.filter(call => call.path === '/api/user/token/refresh')).toEqual([])
  expect(await page.evaluate(() => Boolean(localStorage.getItem('access_token') && localStorage.getItem('refresh_token')))).toBe(true)
})

test('a completed B token pair restores B authentication and private price access after mixed guest state', async ({ page }) => {
  await seedPair(page, token('A', 'access'), token('B', 'refresh'))
  const calls = await priceFixture(page)
  await page.goto('/planetary')
  await expect(await openCalculatedPrices(page)).toHaveValue(String(publicPrice))
  await page.evaluate(access => {
    localStorage.setItem('access_token', access)
    window.dispatchEvent(new Event('auth:changed'))
  }, token('B', 'access', { jti: 'completed-B' }))
  await expect(page.locator('.calculator-card')).toHaveCount(0)
  await expect(page.locator('.top-user-name')).toHaveText('synthetic-B')
  await expect(await openCalculatedPrices(page)).toHaveValue('920002')
  expect(calls.filter(call => call.path === '/api/planetresourceprice/default')).toHaveLength(1)
  expect(calls.filter(call => call.path === '/api/planetresourceprice')).toEqual([{ method: 'GET', path: '/api/planetresourceprice', authorized: true }])
  expect(calls.filter(call => call.path === '/api/user/token/refresh')).toEqual([])
})
