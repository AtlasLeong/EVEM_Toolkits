import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js'
import { installApiMock, json } from '../e2e/helpers/api.js'

const observedAt = '2026-09-24T04:00:00Z'

function sighting(index, { oneTarget = false } = {}) {
  const characterName = oneTarget ? '同一目标' : `目标 ${String(index).padStart(4, '0')}`
  return {
    id: index + 1,
    version: 1,
    character_name: characterName,
    ship_type: '夜神级',
    target_key: [characterName, '夜神级'],
    location_kind: 'system',
    location_id: 101,
    location_name: '德里克一',
    observed_at: new Date(Date.parse(observedAt) - index * 1000).toISOString(),
    activity_start_utc: null,
    activity_end_utc: null,
    notes: '',
    status: 'active',
    author_id: 23,
    author_name: 'atlas123',
  }
}

async function openBoard(page, sightings, mapData = null) {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'scout', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({
      board: { id: 71, name: '夜巡', kind: 'pirate' },
      role: 'scout', user_id: 23, permission_version: 1,
      scope: { region_ids: mapData ? [1] : [], border_hops: 0, version: 1 },
      target_count: new Set(sightings.map(row => JSON.stringify(row.target_key))).size,
      server_time: observedAt, sightings,
    })
    if (url.pathname.endsWith('/boards/71/map/')) return json(mapData)
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await expect(page.getByRole('heading', { name: '海盗情报板' })).toBeVisible()
}

test('5000 targets keep one bounded page while search still covers all targets', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await openBoard(page, Array.from({ length: 5000 }, (_, index) => sighting(index)))
  const rows = page.locator('.pirate-target-row')
  await expect(rows).toHaveCount(80)
  await expect(page.getByText('已显示 1–80 / 5000')).toBeVisible()
  await expect(page.getByRole('button', { name: '成员管理' })).toHaveCount(0)
  const previous = page.getByRole('button', { name: '上一页目标' })
  const next = page.getByRole('button', { name: '下一页目标' })
  await expect(previous).toBeDisabled()
  const [panelBox, nextBox] = await Promise.all([
    page.getByRole('complementary', { name: '目标线索列表' }).boundingBox(), next.boundingBox(),
  ])
  expect(nextBox.x).toBeGreaterThanOrEqual(panelBox.x)
  expect(nextBox.x + nextBox.width).toBeLessThanOrEqual(panelBox.x + panelBox.width)
  await next.focus()
  await expect(next).toBeFocused()
  await next.press('Enter')
  await expect(rows).toHaveCount(80)
  await expect(rows.first()).toContainText('目标 0080')
  await expect(page.getByText('已显示 81–160 / 5000')).toBeVisible()
  await expect(previous).toBeEnabled()
  for (let pageNumber = 3; pageNumber <= 63; pageNumber += 1) {
    await next.click()
    expect(await rows.count()).toBeLessThanOrEqual(80)
  }
  await expect(rows).toHaveCount(40)
  await expect(page.getByText('已显示 4961–5000 / 5000')).toBeVisible()
  await expect(next).toBeDisabled()
  await previous.click()
  await expect(rows).toHaveCount(80)
  await expect(page.getByText('已显示 4881–4960 / 5000')).toBeVisible()

  await page.getByRole('searchbox', { name: '搜索目标线索' }).fill('目标 4999')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('目标 4999')
  await expect(next).toHaveCount(0)
  await rows.first().click()
  await expect(page.getByRole('region', { name: '目标详情' })).toContainText('目标 4999')

  await page.getByRole('searchbox', { name: '搜索目标线索' }).fill('')
  await expect(rows).toHaveCount(80)
  await expect(rows.first()).toContainText('目标 0000')
  await expect(page.getByText('已显示 1–80 / 5000')).toBeVisible()
})

test('5000 sightings for one target keep one bounded history page', async ({ page }) => {
  await openBoard(page, Array.from({ length: 5000 }, (_, index) => sighting(index, { oneTarget: true })))
  await expect(page.locator('.pirate-target-row')).toHaveCount(1)
  await page.locator('.pirate-target-row').click()
  const detail = page.getByRole('region', { name: '目标详情' })
  await expect(detail).toContainText('目击记录 · 5000')
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await expect(detail.getByText('已显示 1–80 / 5000')).toBeVisible()
  const next = detail.getByRole('button', { name: '下一页目击记录' })
  await next.focus()
  await expect(next).toBeFocused()
  await next.press('Enter')
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await expect(detail.getByText('已显示 81–160 / 5000')).toBeVisible()
  const historyRows = detail.locator('.pirate-history-row')
  for (let pageNumber = 3; pageNumber <= 63; pageNumber += 1) {
    await next.click()
    expect(await historyRows.count()).toBeLessThanOrEqual(80)
  }
  await expect(historyRows).toHaveCount(40)
  await expect(detail.getByText('已显示 4961–5000 / 5000')).toBeVisible()
  await expect(next).toBeDisabled()
  await detail.getByRole('button', { name: '上一页目击记录' }).click()
  await expect(historyRows).toHaveCount(80)
  await expect(detail.getByText('已显示 4881–4960 / 5000')).toBeVisible()
})

test('switching targets resets the visible history batch', async ({ page }) => {
  const first = Array.from({ length: 160 }, (_, index) => sighting(index, { oneTarget: true }))
  const second = Array.from({ length: 160 }, (_, index) => ({
    ...sighting(index + 160, { oneTarget: true }),
    character_name: '另一目标',
    target_key: ['另一目标', '夜神级'],
  }))
  await openBoard(page, [...first, ...second])
  const rows = page.locator('.pirate-target-row')
  await rows.filter({ hasText: '同一目标' }).click()
  const detail = page.getByRole('region', { name: '目标详情' })
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await detail.getByRole('button', { name: '下一页目击记录' }).click()
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await expect(detail.getByText('已显示 81–160 / 160')).toBeVisible()
  await rows.filter({ hasText: '另一目标' }).click()
  await expect(detail).toContainText('另一目标 · 夜神级')
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await expect(detail.getByText('已显示 1–80 / 160')).toBeVisible()
})

test('target and history last pages remain bounded and can return to the previous page', async ({ page }) => {
  const targetRows = Array.from({ length: 161 }, (_, index) => sighting(index))
  const historyRows = Array.from({ length: 161 }, (_, index) => ({
    ...sighting(index + 161, { oneTarget: true }),
    character_name: '有历史的目标', target_key: ['有历史的目标', '夜神级'],
  }))
  await openBoard(page, [...targetRows, ...historyRows])
  const targetList = page.getByRole('complementary', { name: '目标线索列表' })
  const targetNext = targetList.getByRole('button', { name: '下一页目标' })
  await targetNext.click()
  await targetNext.click()
  await expect(targetList.locator('.pirate-target-row')).toHaveCount(2)
  await expect(targetList.getByText('已显示 161–162 / 162')).toBeVisible()
  await expect(targetNext).toBeDisabled()
  await targetList.getByRole('button', { name: '上一页目标' }).click()
  await expect(targetList.locator('.pirate-target-row')).toHaveCount(80)
  await expect(targetList.getByText('已显示 81–160 / 162')).toBeVisible()

  await targetList.getByRole('searchbox', { name: '搜索目标线索' }).fill('有历史的目标')
  await targetList.locator('.pirate-target-row').click()
  const detail = page.getByRole('region', { name: '目标详情' })
  const historyNext = detail.getByRole('button', { name: '下一页目击记录' })
  await historyNext.click()
  await historyNext.click()
  await expect(detail.locator('.pirate-history-row')).toHaveCount(1)
  await expect(detail.getByText('已显示 161–161 / 161')).toBeVisible()
  await expect(historyNext).toBeDisabled()
  await detail.getByRole('button', { name: '上一页目击记录' }).click()
  await expect(detail.locator('.pirate-history-row')).toHaveCount(80)
  await expect(detail.getByText('已显示 81–160 / 161')).toBeVisible()
})

test('searching the 5000th target focuses and highlights its map location', async ({ page }) => {
  const sightings = Array.from({ length: 5000 }, (_, index) => ({
    ...sighting(index), location_id: index + 1, location_name: `System ${index + 1}`,
  }))
  const systems = Array.from({ length: 5000 }, (_, index) => ({
    system_id: index + 1, constellation_id: Math.floor(index / 20) + 1,
    region_id: 1, name: `System ${index + 1}`, x: index % 100, z: Math.floor(index / 100),
  }))
  await openBoard(page, sightings, { systems, stargates: [],
    scope: { region_ids: [1], border_hops: 0, version: 1 } })
  const search = page.getByRole('searchbox', { name: '搜索目标线索' })
  await search.fill('目标 4999')
  const row = page.locator('.pirate-target-row')
  await expect(row).toHaveCount(1)
  await row.click()
  const marker = page.locator('[data-pirate-marker="system:5000"]')
  await expect(marker).toHaveClass(/pirate-map__marker--selected/)
  await expect.poll(async () => {
    const [point, frame] = await Promise.all([marker.boundingBox(), page.locator('.pirate-map-frame').boundingBox()])
    return Boolean(point && frame && point.x >= frame.x && point.x + point.width <= frame.x + frame.width &&
      point.y >= frame.y && point.y + point.height <= frame.y + frame.height)
  }).toBe(true)
})
