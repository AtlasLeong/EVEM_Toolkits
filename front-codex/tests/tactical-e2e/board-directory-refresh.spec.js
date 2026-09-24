import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js'
import { installApiMock, json } from '../e2e/helpers/api.js'

function organization(boards) {
  return { id: 7, name: '巡猎小队', role: 'founder', status: 'active', boards }
}

const originalBoard = { id: 71, name: '夜巡', kind: 'pirate', is_default: true }
const teammateBoard = { id: 72, name: '伏击线索', kind: 'pirate', is_default: false }

test('a teammate-created board appears after refocus without replacing the selected board', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let boards = [originalBoard]
  let directoryReads = 0
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') {
      directoryReads += 1
      return json({ organizations: [organization(boards)] })
    }
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({
      board: originalBoard, role: 'founder', user_id: 23, permission_version: 1,
      scope: { region_ids: [], border_hops: 0, version: 1 }, sightings: [], target_count: 0,
      server_time: new Date().toISOString(),
    })
    return json({})
  })

  await page.goto('/tactical?organization=7&board=71')
  const switcher = page.getByRole('group', { name: '选择战术板' })
  await expect(switcher.getByRole('button', { name: /夜巡/ })).toHaveAttribute('aria-pressed', 'true')
  const initialReads = directoryReads
  expect(initialReads).toBeGreaterThanOrEqual(1)

  boards = [originalBoard, teammateBoard]
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await expect(switcher.getByRole('button', { name: /伏击线索/ })).toBeVisible()
  expect(directoryReads).toBeGreaterThan(initialReads)
  await expect(switcher.getByRole('button', { name: /夜巡/ })).toHaveAttribute('aria-pressed', 'true')
  expect(new URL(page.url()).searchParams.get('board')).toBe('71')
})

test('hidden tactical pages do not poll the organization directory', async ({ page }) => {
  await page.clock.install()
  await seedAuthenticatedSession(page, { user_id: 23 })
  let directoryReads = 0
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') {
      directoryReads += 1
      return json({ organizations: [organization([originalBoard])] })
    }
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({
      board: originalBoard, role: 'founder', user_id: 23, permission_version: 1,
      scope: { region_ids: [], border_hops: 0, version: 1 }, sightings: [], target_count: 0,
      server_time: new Date().toISOString(),
    })
    return json({})
  })

  await page.goto('/tactical?organization=7&board=71')
  await expect(page.getByRole('group', { name: '选择战术板' })).toBeVisible()
  const initialReads = directoryReads
  expect(initialReads).toBeGreaterThanOrEqual(1)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await page.clock.fastForward(120_000)
  expect(directoryReads).toBe(initialReads)
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
    document.dispatchEvent(new Event('visibilitychange'))
  })
  await expect.poll(() => directoryReads).toBeGreaterThan(initialReads)
})
