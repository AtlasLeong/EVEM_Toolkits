import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const MINUTE = 60 * 1000
const DATASETS = {
  '/api/boardsystems': [
    { system_id: 1, zh_name: '阿尔法', en_name: 'ALPHA-1', region_id: 10, constellation_id: 100, x: 0, y: 0, z: 0, security_status: 0.5 },
    { system_id: 2, zh_name: '贝塔', en_name: 'BETA-2', region_id: 10, constellation_id: 100, x: 9.461e15, y: 0, z: 0, security_status: 0.1 },
  ],
  '/api/boardregions': [{ region_id: 10, zh_name: '德里克' }],
  '/api/boardconstellations': [{ constellation_id: 100, region_id: 10, zh_name: '静寂谷', x: 0, y: 0, z: 0 }],
  '/api/boardstargate': [{ system_id: 1, destination_system_id: 2 }],
}

async function installMapData(page, shouldFail = () => false) {
  const requests = Object.fromEntries(Object.keys(DATASETS).map(path => [path, 0]))
  await installApiMock(page, async ({ url, method }) => {
    if (method !== 'GET' || !(url.pathname in DATASETS)) return
    requests[url.pathname] += 1
    if (shouldFail(url.pathname)) return json({ error: 'Temporarily unavailable' }, 503)
    return json(DATASETS[url.pathname])
  })
  return requests
}

async function expectMapReady(page) {
  await expect(page.locator('.tactical-map-hud')).toContainText('星系 2')
  await expect(page.locator('.page-head')).toContainText('星域 1')
  await expect(page.locator('.page-head')).toContainText('星座 1')
  await expect(page.locator('.page-head')).toContainText('星门 1')
}

async function leaveMap(page) {
  await page.getByRole('link', { name: '需求与反馈', exact: true }).click()
  await expect(page).toHaveURL(/\/feedback$/)
  await expect(page.locator('canvas')).toHaveCount(0)
}

async function returnToMap(page) {
  await page.getByRole('link', { name: '星系导航', exact: true }).click()
  await expect(page).toHaveURL(/\/starmap$/)
  await expectMapReady(page)
  // Let mount effects and any unintended background requests finish before counting.
  await page.clock.runFor(250)
}

test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-09-18T00:00:00Z') })
})

for (const awayMinutes of [4, 6]) {
  test(`星图离开 ${awayMinutes} 分钟后重访复用四组静态数据`, async ({ page }) => {
    const requests = await installMapData(page)
    await page.goto('/starmap')
    await expectMapReady(page)
    expect(Object.values(requests)).toEqual([1, 1, 1, 1])

    await leaveMap(page)
    await page.clock.fastForward(awayMinutes * MINUTE)
    await returnToMap(page)

    expect(Object.values(requests)).toEqual([1, 1, 1, 1])
    await page.getByLabel('起点星系').fill('alpha')
    await expect(page.locator('.route-system-dropdown')).toContainText('阿尔法')
  })
}

test('星图数据超过一小时后重访会重新验证', async ({ page }) => {
  const requests = await installMapData(page)
  await page.goto('/starmap')
  await expectMapReady(page)

  // Keep the queries mounted while they become stale, so this verifies freshness,
  // not just refetching after an inactive cache entry has been garbage-collected.
  await page.clock.fastForward(61 * MINUTE)
  expect(Object.values(requests)).toEqual([1, 1, 1, 1])
  await leaveMap(page)
  await returnToMap(page)

  expect(Object.values(requests)).toEqual([2, 2, 2, 2])
})

test('星图失败的请求在重访时可以恢复而不会作为一小时有效数据复用', async ({ page }) => {
  let failing = true
  const requests = await installMapData(page, path => failing && path === '/api/boardsystems')
  await page.goto('/starmap')
  await expect.poll(() => requests['/api/boardsystems']).toBe(1)

  // Exhaust the existing retry policy before remounting the failed query.
  for (let attempt = 2; attempt <= 4; attempt += 1) {
    await page.clock.runFor(50)
    await page.clock.fastForward(8000)
    await expect.poll(() => requests['/api/boardsystems']).toBe(attempt)
  }
  await expect(page.locator('.tactical-map-hud')).toContainText('星系 0')

  await leaveMap(page)
  failing = false
  await returnToMap(page)

  expect(Object.values(requests)).toEqual([5, 1, 1, 1])
})
