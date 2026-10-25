import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function historyMock(page, { legacy = false, legacyRows, failNext = false, denyNext = false, nextGate } = {}) {
  const calls = []
  await seedAuthenticatedSession(page, { userName: 'historyAdmin' })
  await installApiMock(page, async ({ url, method }) => {
    if (method !== 'GET') return undefined
    if (url.pathname === '/api/fraudadmincheck') return json({ message: 'Authorized Users' })
    if (url.pathname === '/api/fraudadmingroup' || url.pathname === '/api/fraudadminlist' || url.pathname === '/api/fraudadminlistreport') return json([])
    if (url.pathname === '/api/fraudbehaviorflow') {
      calls.push(url.search)
      if (legacyRows) return json(legacyRows)
      const pageNumber = Number(url.searchParams.get('page') || 1)
      if (pageNumber === 2 && nextGate) await nextGate
      if (pageNumber === 2 && failNext) return json({ error: '读取操作流水失败，请重试。' }, 503)
      if (pageNumber === 2 && denyNext) return json({ message: 'UnAuthorized Users' }, 401)
      const results = [{ id: pageNumber * 10, operation_id: `operation-${pageNumber}`, change: 'B', action_type: 'update', username: 'historyAdmin', fraud_account: `page-${pageNumber}-account`, remark: `page-${pageNumber}-before` },
        { id: pageNumber * 10 + 1, operation_id: `operation-${pageNumber}`, change: 'F', action_type: 'update', username: 'historyAdmin', fraud_account: `page-${pageNumber}-updated`, remark: `page-${pageNumber}-after` }]
      return json(legacy ? results : { count: 21, page: pageNumber, page_size: 20, has_next: pageNumber < 2, results })
    }
  })
  return calls
}

test('history loads only on demand and explicit bounded pages preserve paired details', async ({ page }) => {
  const calls = await historyMock(page)
  await page.goto('/fraudadmin')
  await expect(page.getByRole('heading', { name: '诈骗名单管理' })).toBeVisible()
  expect(calls).toHaveLength(0)
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  expect(calls).toEqual(['?page=1&page_size=20'])
  await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled()
  await expect(page.getByText('共 21 条变更', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('page-2-account', { exact: true })).toBeVisible()
  await expect(page.getByText('page-1-account', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await expect(page.locator('.admin-modal')).toContainText('page-2-before')
  await expect(page.locator('.admin-modal')).toContainText('page-2-after')
  await page.locator('.admin-modal').getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  expect(calls.every(query => /\?page=[12]&page_size=20/.test(query))).toBeTruthy()
})

test('legacy arrays remain readable without inventing an additional page', async ({ page }) => {
  await historyMock(page, { legacy: true })
  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  await expect(page.getByText('本页 1 条变更', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
  await page.getByRole('button', { name: '查看详情', exact: true }).click()
  await expect(page.locator('.admin-modal')).toContainText('page-1-after')
})

test('legacy blank operation IDs never pair while nonblank IDs keep their exact identity', async ({ page }) => {
  const legacyRows = []
  let id = 1
  for (const operationId of [null, '', '   ', ' op ', ' valid ', 100]) {
    legacyRows.push({ id: id++, operation_id: operationId, change: 'B', action_type: 'update', fraud_account: `anchor-${id}` })
    legacyRows.push({ id: id++, operation_id: operationId === ' op ' ? 'op' : operationId, change: 'F', action_type: 'update', fraud_account: `after-${id}` })
  }
  await historyMock(page, { legacyRows })
  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.locator('.data-table tbody tr')).toHaveCount(6)
  await expect(page.getByRole('button', { name: '查看详情', exact: true })).toHaveCount(2)
  await expect(page.getByText('无后置版本', { exact: true })).toHaveCount(4)
})

test('a failed page does not display the previous page as current or eagerly request more pages', async ({ page }) => {
  const calls = await historyMock(page, { failNext: true })
  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('读取操作流水失败，请重试。')
  await expect(page.getByText('总数暂不可用', { exact: true })).toBeVisible()
  await expect(page.getByText('page-1-account', { exact: true })).toHaveCount(0)
  await expect(page.getByText('暂无变更流水', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
  expect(calls).toEqual(['?page=1&page_size=20', '?page=2&page_size=20'])
  await page.getByRole('button', { name: '上一页', exact: true }).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
})

test('page navigation is disabled during loading and the phone pager fits', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  let release
  const nextGate = new Promise(resolve => { release = resolve })
  await historyMock(page, { nextGate })
  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  try {
    await expect(page.getByRole('button', { name: '上一页', exact: true })).toBeDisabled()
    await expect(page.getByRole('button', { name: '下一页', exact: true })).toBeDisabled()
    await expect(page.getByText('page-1-account', { exact: true })).toHaveCount(0)
  } finally { release() }
  await expect(page.getByText('page-2-account', { exact: true })).toBeVisible()
  const pager = page.getByRole('navigation', { name: '修改流水分页' })
  await expect(pager).toBeVisible()
  const bounds = await pager.boundingBox()
  expect(bounds.x).toBeGreaterThanOrEqual(0)
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(391)
  await page.screenshot({ path: 'output/playwright/phase3-fraud-history-mobile.png', fullPage: true })
})

test('revoked private history access cannot keep showing the previous page', async ({ page }) => {
  const calls = await historyMock(page, { denyNext: true })
  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.getByText('page-1-account', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await expect(page.getByText('page-1-account', { exact: true })).toHaveCount(0)
  await expect(page.getByText('page-2-account', { exact: true })).toHaveCount(0)
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByRole('button', { name: '登录', exact: true })).toBeVisible()
  expect(calls.filter(query => query === '?page=2&page_size=20')).toHaveLength(1)
})
