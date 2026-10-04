import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const now = new Date('2026-10-04T12:00:00Z')
const oldObservation = '2026-10-03T12:00:00.000Z'
const materialA = '41000000000'
const materialB = '41000000001'
const catalog = {
  schemaVersion: 1, scope: ['ship', 'material', 'building'],
  recipes: [
    { productId: '10100000101', name: 'Quote target A', category: 'ship', outputNum: 2, materials: [{ itemId: materialA, quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 },
    { productId: '10100000103', name: 'Quote target B', category: 'ship', outputNum: 1, materials: [{ itemId: materialB, quantity: 2 }], money: 11, time: 60, maxInstallQuantity: 10 },
  ],
  items: [{ itemId: materialA, name: 'Quote material A' }, { itemId: materialB, name: 'Quote material B' }],
}
const total = page => page.locator('.manufacturing-total-card > strong')
const completeState = page => page.getByTestId('manufacturing-cost-rail').locator('.manufacturing-complete-state')
const refreshButton = page => page.getByRole('button', { name: '\u5237\u65b0\u8d2d\u4e70\u9879\u884c\u60c5', exact: true })

function quote(itemId, overrides = {}) {
  return { item_id: itemId, best_sell: '1200', status: 'fresh', observed_at: now.toISOString(), ...overrides }
}

async function fixture(page, resolveQuote, { sharedPurchase = false, catalogOverride } = {}) {
  const requests = []
  const data = catalogOverride ?? (sharedPurchase ? { ...catalog, recipes: catalog.recipes.map(recipe => recipe.name === 'Quote target B' ? { ...recipe, materials: [{ itemId: materialA, quantity: 2 }] } : recipe) } : catalog)
  await page.route('**/industry/manufacturing-scope.json', route => route.fulfill(json(data)))
  await installApiMock(page, async ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q')
      const request = { itemId, count: requests.filter(entry => entry.itemId === itemId).length + 1 }
      requests.push(request)
      const resolved = await resolveQuote(request)
      return resolved ?? json({ count: 1, results: [quote(itemId)] })
    }
    return json({ detail: 'Unknown API is prohibited in this sealed fixture' }, 501)
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return requests
}

function deferred() {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

async function selectTarget(page, name) {
  await page.getByRole('button', { name: '\u5207\u6362\u5236\u9020\u76ee\u6807', exact: true }).click()
  await page.getByRole('option', { name, exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
}

const warning = page => page.getByTestId('manufacturing-cost-rail').getByTestId('manufacturing-quote-warning')
const reference = page => page.locator('.manufacturing-market-reference')

async function selectMaterial(page, name = 'Quote material A') {
  await page.getByRole('button', { name: `\u67e5\u770b ${name}`, exact: true }).click()
  await expect(page.getByRole('textbox', { name: '\u65b9\u6848\u624b\u586b\u5355\u4ef7', exact: true })).toBeVisible()
}

test('a valid stale latest sell quote contributes to the complete cost and exposes its collection time', async ({ page }) => {
  await page.clock.setFixedTime(now)
  await fixture(page, ({ itemId }) => json({ count: 1, results: [quote(itemId, { status: 'stale', observed_at: oldObservation })] }))
  await page.goto('/manufacturing')
  // One batch: ceil(2 * 150%) materials * 1200 plus the 7 ISK manufacture fee.
  await expect(total(page)).toHaveText('3,607 ISK')
  await expect(completeState(page)).toHaveText('\u53ef\u8ba1\u7b97')
  await selectMaterial(page)
  await expect(warning(page)).toContainText('\u4f7f\u7528 1 \u9879\u8fc7\u671f\u62a5\u4ef7')
  await expect(reference(page)).toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  await expect(reference(page).locator('time')).toHaveAttribute('datetime', oldObservation)
})

test('an explicit expired quote remains usable with a visible age warning rather than a missing or zero material price', async ({ page }) => {
  await page.clock.setFixedTime(now)
  await fixture(page, ({ itemId }) => json({ count: 1, results: [quote(itemId, { status: 'expired', observed_at: oldObservation })] }))
  await page.goto('/manufacturing')
  await expect(total(page)).toHaveText('3,607 ISK')
  await expect(completeState(page)).toHaveText('\u53ef\u8ba1\u7b97')
  await selectMaterial(page)
  await expect(reference(page).locator('strong')).toHaveText('1,200 ISK')
  await expect(reference(page)).toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  await expect(reference(page).locator('time')).toHaveAttribute('datetime', oldObservation)
  await expect(warning(page)).toContainText('\u6700\u65b0\u5b58\u91cf\u5356\u4ef7')
})

test('a positive stale sell with an invalid calendar timestamp stays usable and explicitly exposes unknown collection time', async ({ page }) => {
  await page.clock.setFixedTime(now)
  await fixture(page, ({ itemId }) => json({ count: 1, results: [quote(itemId, { status: 'stale', observed_at: '2026-02-30T12:00:00Z' })] }))
  await page.goto('/manufacturing')
  await expect(total(page)).toHaveText('3,607 ISK')
  await expect(completeState(page)).toHaveText('\u53ef\u8ba1\u7b97')
  await selectMaterial(page)
  await expect(reference(page).locator('strong')).toHaveText('1,200 ISK')
  await expect(reference(page)).toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  await expect(reference(page)).toContainText('\u91c7\u96c6\u65f6\u95f4\u672a\u77e5')
  await expect(reference(page).locator('time')).toHaveCount(0)
  await expect(warning(page)).toContainText('\u4f7f\u7528 1 \u9879\u8fc7\u671f\u62a5\u4ef7')
  await expect(warning(page)).toContainText('\u5176\u4e2d 1 \u9879\u91c7\u96c6\u65f6\u95f4\u672a\u77e5')
})

for (const [state, overrides, invalid] of [
  ['empty order book', { status: 'empty', best_sell: null }, false],
  ['no sell quote', { status: 'fresh', best_sell: null, best_buy: '2000' }, false],
  ['negative invalid price', { status: 'fresh', best_sell: '-1' }, true],
  ['non-numeric invalid price', { status: 'fresh', best_sell: 'not-a-price' }, true],
]) {
  test(`successful refresh with ${state} clears the old usable price and shows an incomplete cost instead of zero`, async ({ page }) => {
    await page.clock.setFixedTime(now)
    const nextObservation = new Date(now.getTime() + 60_000)
    const requests = await fixture(page, ({ itemId, count }) => json({ count: 1, results: [quote(itemId, count === 1 ? {} : { ...overrides, observed_at: nextObservation.toISOString() })] }))
    await page.goto('/manufacturing')
    await expect(total(page)).toHaveText('3,607 ISK')
    await selectMaterial(page)
    await expect(reference(page).locator('strong')).toHaveText('1,200 ISK')
    await page.clock.setFixedTime(nextObservation)
    await refreshButton(page).click()
    await expect(total(page)).toHaveText('7 ISK')
    await expect(completeState(page)).toHaveText('\u5f85\u8865\u62a5\u4ef7')
    await expect(reference(page).locator('strong')).toHaveText('\u5f85\u8865\u4ef7\u683c')
    await expect(reference(page).locator('strong')).not.toHaveText('0 ISK')
    await expect(reference(page)).toContainText(invalid ? '\u62a5\u4ef7\u65e0\u6548\uff0c\u4e0d\u53c2\u4e0e\u4f30\u7b97' : '\u6682\u65e0\u6709\u6548\u5356\u4ef7')
    await expect(reference(page).locator('time')).toHaveAttribute('datetime', nextObservation.toISOString())
    await expect(page.locator('.manufacturing-missing')).toBeVisible()
    await expect(page.locator('.manufacturing-inline-error')).toHaveCount(0)
    expect(requests).toHaveLength(2)
  })
}

test('a failed manual refresh preserves the latest valid cached price and clearly warns about the failure', async ({ page }) => {
  await page.clock.setFixedTime(now)
  const requests = await fixture(page, ({ itemId, count }) => count === 1 ? json({ count: 1, results: [quote(itemId)] }) : json({ detail: 'sealed fixture market offline' }, 503))
  await page.goto('/manufacturing')
  await expect(total(page)).toHaveText('3,607 ISK')
  await selectMaterial(page)
  await refreshButton(page).click()
  await expect(page.locator('.manufacturing-inline-error')).toHaveText('\u5e02\u573a\u53c2\u8003\u4ef7\u5237\u65b0\u5931\u8d25\uff1b\u5df2\u4fdd\u7559\u73b0\u6709\u62a5\u4ef7\u3002\u4ecd\u53ef\u624b\u52a8\u586b\u5199\u65b9\u6848\u4ef7\u683c\u3002')
  await expect(total(page)).toHaveText('3,607 ISK')
  await expect(completeState(page)).toHaveText('\u53ef\u8ba1\u7b97')
  await expect(reference(page).locator('strong')).toHaveText('1,200 ISK')
  await expect(reference(page).locator('time')).toHaveAttribute('datetime', now.toISOString())
  await expect(refreshButton(page)).toBeEnabled()
  expect(requests).toHaveLength(2)
})

test('one failed item cancels the other in-flight quotes, leaves the ninth unscheduled, and cannot leak into a new target', async ({ page }) => {
  await page.clock.setFixedTime(now)
  const itemIds = Array.from({ length: 9 }, (_, index) => String(42000000000 + index))
  const manyItems = {
    ...catalog,
    recipes: catalog.recipes.map(recipe => recipe.name === 'Quote target A'
      ? { ...recipe, materials: itemIds.map(itemId => ({ itemId, quantity: 2 })) }
      : recipe),
    items: [...catalog.items, ...itemIds.map((itemId, index) => ({ itemId, name: `Batch material ${index + 1}` }))],
  }
  const firstFailure = deferred(), siblings = deferred()
  const abortedItems = new Set(), releasedItems = new Set(), pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  page.on('requestfailed', request => {
    const url = new URL(request.url())
    const itemId = url.searchParams.get('q')
    if (url.pathname === '/api/market/items/' && itemIds.includes(itemId)) abortedItems.add(itemId)
  })
  const requests = await fixture(page, async ({ itemId, count }) => {
    if (itemIds.includes(itemId) && count === 2) {
      if (itemId === itemIds[0]) {
        await firstFailure.promise
        return json({ detail: 'one stored quote failed' }, 503)
      }
      await siblings.promise
      releasedItems.add(itemId)
      return json({ count: 1, results: [quote(itemId, { best_sell: '999999' })] })
    }
    return json({ count: 1, results: [quote(itemId, { best_sell: itemId === materialB ? '2000' : '1200' })] })
  }, { catalogOverride: manyItems })
  try {
    await page.goto('/manufacturing')
    await expect(total(page)).toHaveText('32,407 ISK')
    expect(requests).toHaveLength(9)
    await refreshButton(page).click()
    await expect.poll(() => requests.filter(request => request.count === 2).length).toBe(8)
    firstFailure.release()
    await expect(page.locator('.manufacturing-inline-error')).toContainText('\u5df2\u4fdd\u7559\u73b0\u6709\u62a5\u4ef7')
    await expect(total(page)).toHaveText('32,407 ISK')
    await expect(refreshButton(page)).toBeEnabled()
    // These are actual browser fetch cancellations while their responses are held.
    await expect.poll(() => abortedItems.size).toBe(7)
    await selectTarget(page, 'Quote target B')
    await expect(total(page)).toHaveText('6,011 ISK')
    siblings.release()
    await expect.poll(() => releasedItems.size).toBe(7)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    expect(requests.filter(request => request.count === 2)).toHaveLength(8)
    expect(requests.some(request => request.itemId === itemIds[8] && request.count === 2)).toBe(false)
    expect(requests.filter(request => request.itemId === materialB)).toHaveLength(1)
    await expect(total(page)).toHaveText('6,011 ISK')
    await expect(refreshButton(page)).toBeEnabled()
    await expect(page.locator('.manufacturing-inline-error')).toHaveCount(0)
    expect(pageErrors).toEqual([])
  } finally {
    firstFailure.release()
    siblings.release()
  }
})

for (const oldResult of ['success', 'error']) {
  test(`late old-target ${oldResult} cannot replace a newer shared-material quote or clear its pending refresh state`, async ({ page }) => {
    await page.clock.setFixedTime(now)
    const oldGate = deferred(), oldReturned = deferred(), latestGate = deferred()
    const requests = await fixture(page, async ({ itemId, count }) => {
      if (count === 1) {
        await oldGate.promise
        oldReturned.release()
        return oldResult === 'success' ? json({ count: 1, results: [quote(itemId, { best_sell: '1200' })] }) : json({ detail: 'old target failure must stay fenced' }, 503)
      }
      if (count === 3) await latestGate.promise
      return json({ count: 1, results: [quote(itemId, { best_sell: count === 2 ? '2000' : '2500' })] })
    }, { sharedPurchase: true })
    try {
      await page.goto('/manufacturing')
      await expect.poll(() => requests.length).toBe(1)
      await selectTarget(page, 'Quote target B')
      await expect(total(page)).toHaveText('6,011 ISK')
      await selectMaterial(page)
      await refreshButton(page).click()
      await expect.poll(() => requests.length).toBe(3)
      const loading = page.getByRole('button', { name: '\u6b63\u5728\u8bfb\u53d6\u884c\u60c5', exact: true })
      await expect(loading).toBeDisabled()
      oldGate.release()
      await oldReturned.promise
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await expect(loading).toBeDisabled()
      await expect(total(page)).toHaveText('6,011 ISK')
      await expect(reference(page).locator('strong')).toHaveText('2,000 ISK')
      await expect(page.locator('.manufacturing-inline-error')).toHaveCount(0)
      latestGate.release()
      await expect(total(page)).toHaveText('7,511 ISK')
      await expect(reference(page).locator('strong')).toHaveText('2,500 ISK')
      await expect(refreshButton(page)).toBeEnabled()
      await expect(page.locator('.manufacturing-inline-error')).toHaveCount(0)
    } finally {
      oldGate.release()
      latestGate.release()
    }
  })
}

test('elapsed local time re-ages a cached sell quote without discarding its value and cache expiry fetches a newer quote', async ({ page }) => {
  await page.clock.install({ time: now })
  const observed = new Date(now.getTime() - 2 * 60 * 60 * 1000 + 15_000).toISOString()
  const newer = new Date(now.getTime() + 5 * 60 * 1000).toISOString()
  const requests = await fixture(page, ({ itemId, count }) => json({ count: 1, results: [quote(itemId, { best_sell: count === 1 ? '1200' : '1500', observed_at: count === 1 ? observed : newer })] }))
  await page.goto('/manufacturing')
  await expect(total(page)).toHaveText('3,607 ISK')
  await selectMaterial(page)
  await expect(reference(page)).not.toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  await page.clock.runFor(30_000)
  await expect(reference(page)).toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  await expect(warning(page)).toContainText('\u4f7f\u7528 1 \u9879\u8fc7\u671f\u62a5\u4ef7')
  await expect(total(page)).toHaveText('3,607 ISK')
  expect(requests).toHaveLength(1)
  await page.clock.runFor(5 * 60 * 1000)
  await expect(total(page)).toHaveText('4,507 ISK')
  await expect(reference(page).locator('time')).toHaveAttribute('datetime', newer)
  await expect(reference(page)).not.toContainText('\u62a5\u4ef7\u5df2\u8fc7\u671f')
  expect(requests).toHaveLength(2)
})

test('stale-cost mobile summaries agree across batches, charge a blueprint total once, and quantity changes never fetch quotes', async ({ page }) => {
  await page.clock.setFixedTime(now)
  await page.setViewportSize({ width: 390, height: 900 })
  const requests = await fixture(page, ({ itemId }) => json({ count: 1, results: [quote(itemId, { status: 'stale', observed_at: oldObservation })] }))
  await page.goto('/manufacturing')
  await expect(total(page)).toHaveText('3,607 ISK')
  const quick = page.getByTestId('manufacturing-mobile-overview')
  const blueprint = page.getByRole('textbox', { name: '\u84dd\u56fe\u4ef7\u683c\uff08\u672c\u6b21\u5408\u8ba1\uff09', exact: true })
  const quantity = page.getByRole('spinbutton', { name: '\u5236\u9020\u6570\u91cf', exact: true })
  await blueprint.fill('1000.10')
  await quantity.fill('2')
  await expect(total(page)).toHaveText('4,607.1 ISK')
  await expect(quick.locator('strong').first()).toHaveText('4,607.1 ISK')
  await quantity.fill('3')
  await expect(total(page)).toHaveText('8,214.1 ISK')
  await expect(quick.locator('strong').first()).toHaveText('8,214.1 ISK')
  await expect(blueprint).toHaveValue('1000.10')
  await expect(quick.getByTestId('manufacturing-quote-warning')).toContainText('\u4f7f\u7528 1 \u9879\u8fc7\u671f\u62a5\u4ef7')
  await expect(warning(page)).toContainText('\u4f7f\u7528 1 \u9879\u8fc7\u671f\u62a5\u4ef7')
  expect(requests).toHaveLength(1)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
