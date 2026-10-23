import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const catalog = {
  schemaVersion: 1, scope: ['ship', 'material', 'building'],
  recipes: [{ productId: '10100000101', name: '缓存目录样本', category: 'ship', outputNum: 1,
    materials: [{ itemId: '41000000000', quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 }],
  items: [{ itemId: '41000000000', name: '三钛合金' }],
}

async function prepare(page, { failFirst = false } = {}) {
  const reads = []
  let failing = failFirst
  let currentCatalog = catalog
  await page.route('**/industry/manufacturing-scope.json', route => {
    reads.push(route.request().url())
    return route.fulfill(failing
      ? { status: 503, body: 'temporarily unavailable' } : json(currentCatalog))
  })
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && ['/api/market/quotes/', '/api/market/items/'].includes(url.pathname)) {
      const ids = (url.searchParams.get('ids') || url.searchParams.get('q') || '41000000000').split(',')
      return json({ count: ids.length, results: ids.map(item_id => ({ item_id, name: '三钛合金',
        status: 'fresh', best_sell: '10', observed_at: new Date().toISOString() })) })
    }
    return undefined
  })
  return { reads, recover: () => { failing = false }, replaceCatalog: value => { currentCatalog = value } }
}

async function returnThroughMarket(page) {
  await page.getByRole('link', { name: '市场价格', exact: true }).click()
  await expect(page).toHaveURL(/\/market$/)
  await page.getByRole('link', { name: '制造估价', exact: true }).click()
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
}

test('manufacturing reuses its successful catalog across SPA routes but revalidates in a new document', async ({ page }) => {
  const { reads } = await prepare(page)
  await page.goto('/manufacturing')
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
  const initialReads = reads.length // Dev StrictMode may abort/restart the first request.
  await returnThroughMarket(page)
  expect(reads).toHaveLength(initialReads)
  await page.reload()
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
  expect(reads.length).toBeGreaterThan(initialReads)
})

test('a failed catalog can be explicitly retried and only successful data is reused', async ({ page }) => {
  const { reads, recover } = await prepare(page, { failFirst: true })
  await page.goto('/manufacturing')
  await expect(page.getByText('制造目录暂时无法加载，请稍后重试。')).toBeVisible()
  const failedReads = reads.length
  recover()
  await page.getByRole('button', { name: '重新加载目录' }).click()
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
  expect(reads).toHaveLength(failedReads + 1)
  await returnThroughMarket(page)
  expect(reads).toHaveLength(failedReads + 1)
})

for (const keepSelection of [false, true]) {
  test(`a refreshed catalog ${keepSelection ? 'preserves a valid' : 'replaces a removed'} selected target without rendering an invalid plan`, async ({ page }) => {
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    const { reads, replaceCatalog } = await prepare(page)
    const second = { ...catalog.recipes[0], productId: '10100000102', name: '目录第二目标' }
    replaceCatalog({ ...catalog, recipes: [...catalog.recipes, second] })
    await page.goto('/manufacturing')
    const target = page.getByRole('button', { name: '切换制造目标' })
    await target.click()
    await page.getByRole('option', { name: second.name, exact: true }).click()
    await expect(page.locator('.manufacturing-selected-target')).toContainText(second.name)
    const previousReads = reads.length
    replaceCatalog({ ...catalog, recipes: keepSelection ? [...catalog.recipes, { ...second, money: 8 }] : catalog.recipes })
    // Advance data age without firing an hour of unrelated quote timers.
    await page.evaluate(() => {
      const now = Date.now
      Date.now = () => now() + 3600001
      window.dispatchEvent(new Event('offline'))
      window.dispatchEvent(new Event('online'))
    })
    await expect.poll(() => reads.length).toBeGreaterThan(previousReads)
    await expect(page.locator('.manufacturing-selected-target')).toContainText(keepSelection ? second.name : catalog.recipes[0].name)
    expect(errors).toEqual([])
  })
}
