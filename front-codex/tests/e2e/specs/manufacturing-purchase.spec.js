import { expect, test } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { installApiMock, json } from '../helpers/api'

const catalog = {
  schemaVersion: 1,
  scope: ['ship', 'material', 'building'],
  recipes: [
    { productId: '100', name: '采购样本', category: 'ship', outputNum: 1, materials: [{ itemId: '101', quantity: 2 }, { itemId: '200', quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 },
    { productId: '101', name: '中间件', category: 'material', outputNum: 2, materials: [{ itemId: '200', quantity: 1 }, { itemId: '201', quantity: 3 }, { itemId: '202', quantity: 4 }, { itemId: '203', quantity: 5 }, { itemId: '204', quantity: 6 }], money: 11, time: 30, maxInstallQuantity: 10 },
  ],
  items: [
    { itemId: '101', name: '中间件' },
    { itemId: '200', name: '新价材料' },
    { itemId: '201', name: '旧价材料' },
    { itemId: '202', name: '未采集材料' },
    { itemId: '203', name: '空卖盘材料' },
    { itemId: '204', name: '无效报价材料' },
  ],
}

async function installPurchaseFixture(page, { copyFails = false, catalogDelay = 0 } = {}) {
  const requests = []
  await page.addInitScript(({ copyFails }) => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async text => {
        if (copyFails) throw new Error('clipboard unavailable')
        window.copiedPurchaseList = text
      },
    } })
  }, { copyFails })
  await page.route('**/industry/manufacturing-scope.json', async route => {
    if (catalogDelay) await new Promise(resolve => setTimeout(resolve, catalogDelay))
    await route.fulfill(json(catalog))
  })
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q')
      requests.push(itemId)
      const quotes = {
        '200': { best_sell: '9007199254740993.125', status: 'fresh', observed_at: new Date().toISOString() },
        '201': { best_sell: '2.5', status: 'stale', observed_at: '2020-01-01T00:00:00Z' },
        '203': { best_sell: null, best_buy: '999', status: 'empty', observed_at: '2021-03-02T04:05:06Z' },
        '204': { best_sell: '-4.5', status: 'fresh', observed_at: '2022-04-03T05:06:07Z' },
      }
      return json({ count: quotes[itemId] ? 1 : 0, results: quotes[itemId] ? [{ item_id: itemId, ...quotes[itemId] }] : [] })
    }
    return json({})
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return requests
}

const list = page => page.getByTestId('manufacturing-purchase-list')
const row = (page, id) => list(page).locator(`tbody tr[data-item-id="${id}"]`)

test('complete procurement list aggregates shared leaves, keeps missing rows, and edits prices in the current plan', async ({ page }) => {
  const requests = await installPurchaseFixture(page)
  await page.goto('/manufacturing')
  await page.getByRole('spinbutton', { name: '制造效率百分比' }).fill('100')
  await expect(list(page).locator('tbody tr')).toHaveCount(5)
  await expect(row(page, '200')).toContainText('9,007,199,254,740,993.125 ISK')
  await expect(row(page, '200').locator('.manufacturing-purchase-quantity')).toHaveText('3')
  await expect(row(page, '200')).toContainText('小计 27,021,597,764,222,979.375 ISK')
  await expect(row(page, '201')).toContainText('市场旧价 · 已计入')
  await expect(row(page, '201')).toContainText('2020/1/1')
  await expect(row(page, '202')).toContainText('未找到市场报价')
  await expect(row(page, '203').locator('.manufacturing-purchase-unit-price')).toHaveText('待补价格')
  await expect(row(page, '203')).not.toContainText('999 ISK')
  await expect(row(page, '203').locator('time')).toHaveAttribute('dateTime', '2021-03-02T04:05:06.000Z')
  await expect(row(page, '204')).toContainText('市场报价无效')
  await expect(row(page, '204').locator('time')).toHaveAttribute('dateTime', '2022-04-03T05:06:07.000Z')
  await expect(row(page, '204').locator('.manufacturing-purchase-unit-price')).toHaveText('待补价格')
  await expect(row(page, '202').locator('time')).toHaveCount(0)
  await expect(row(page, '202')).toContainText('采集时间未知')
  const marketLink = row(page, '202').getByRole('link', { name: '查看 未采集材料 行情（新标签页）' })
  await expect(marketLink).toHaveAttribute('href', '/market')
  await expect(marketLink).toHaveAttribute('target', '_blank')
  await expect(marketLink).toHaveAttribute('rel', 'noopener noreferrer')
  await expect(list(page)).toContainText('请按材料名称或 ID 搜索')

  const requestCount = requests.length
  const manual = row(page, '202').getByRole('textbox', { name: '采购单价 未采集材料' })
  await expect(manual).toHaveAttribute('maxlength', '64')
  await manual.fill('1.25')
  await expect(manual).toBeFocused()
  await expect(row(page, '202')).toContainText('方案内手填')
  await expect(row(page, '202')).toContainText('小计 5 ISK')
  await expect(list(page)).toContainText('待补 2 项价格')
  await expect.poll(() => requests.length).toBe(requestCount)
  await manual.fill('-2')
  await expect(manual).toHaveAttribute('aria-invalid', 'true')
  await expect(row(page, '202')).toContainText('修正或清空手填单价')
  await manual.fill('')
  await expect(manual).toHaveAttribute('aria-invalid', 'false')
  await expect(row(page, '202')).toContainText('未找到市场报价')

  await page.getByRole('group', { name: '生产方式 中间件', exact: true }).getByRole('button', { name: '购买', exact: true }).click()
  await expect(list(page).locator('tbody tr')).toHaveCount(2)
  await expect(row(page, '101')).toContainText('中间件')
  await expect(row(page, '200').locator('.manufacturing-purchase-quantity')).toHaveText('2')
  await expect(row(page, '201')).toHaveCount(0)
})

test('copy and CSV export carry every row, exact decimal amounts, and stale/missing status', async ({ page }) => {
  await installPurchaseFixture(page)
  await page.goto('/manufacturing#manufacturing-purchase-list')
  await page.getByRole('spinbutton', { name: '制造效率百分比' }).fill('100')
  await expect(row(page, '201')).toContainText('市场旧价 · 已计入')
  await list(page).getByRole('button', { name: '复制采购清单' }).click()
  await expect(list(page).getByRole('status')).toContainText('采购清单已复制')
  const copied = await page.evaluate(() => window.copiedPurchaseList)
  for (const name of ['新价材料', '旧价材料', '未采集材料', '空卖盘材料', '无效报价材料']) expect(copied).toContain(name)
  expect(copied).toContain('9,007,199,254,740,993.125')
  expect(copied).toContain('市场旧价 · 已计入')
  const downloadPromise = page.waitForEvent('download')
  await list(page).getByRole('button', { name: '导出 CSV' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('EVEM-采购清单-100.csv')
  const bytes = await readFile(await download.path())
  expect([...bytes.subarray(0, 3)]).toEqual([239, 187, 191])
  const csv = bytes.toString('utf8')
  expect(csv).toContain('9007199254740993.125')
  expect(csv).toContain('27021597764222979.375')
  expect(csv).toContain('市场旧价 · 已计入')
  expect(csv).toContain('未采集材料')
  expect(csv).toContain('空卖盘材料')
  expect(csv).toContain('无效报价材料')
  expect(csv).toContain('2021-03-02T04:05:06.000Z')
  expect(csv).toContain('2022-04-03T05:06:07.000Z')
  expect(csv).not.toContain('999')
})

test('clipboard failure exposes selected text, and an async hash destination focuses once', async ({ page }) => {
  await installPurchaseFixture(page, { copyFails: true, catalogDelay: 150 })
  await page.goto('/manufacturing#manufacturing-purchase-list')
  await expect(list(page)).toBeFocused()
  await expect(list(page)).toBeInViewport()
  const manual = row(page, '202').getByRole('textbox', { name: '采购单价 未采集材料' })
  await manual.fill('12.50')
  await expect(manual).toBeFocused()
  await expect(row(page, '202')).toContainText('方案内手填')
  await list(page).getByRole('button', { name: '复制采购清单' }).click()
  await expect(list(page).getByRole('status')).toContainText('自动复制未成功')
  const fallback = list(page).getByRole('textbox', { name: '可手动复制的采购清单' })
  await expect(fallback).toBeFocused()
  expect(await fallback.evaluate(node => node.selectionEnd - node.selectionStart)).toBe((await fallback.inputValue()).length)
})

test('both manual price editors preserve invalid exponents without parsing them and accept ordinary decimal forms', async ({ page }) => {
  await installPurchaseFixture(page)
  await page.goto('/manufacturing')
  await page.getByRole('button', { name: '展开全部层级' }).click()
  await page.getByRole('button', { name: '查看 未采集材料', exact: true }).click()
  const railPrice = page.getByTestId('manufacturing-cost-rail').getByRole('textbox', { name: '方案手填单价', exact: true })
  const purchasePrice = row(page, '202').getByRole('textbox', { name: '采购单价 未采集材料' })
  await expect(railPrice).toHaveAttribute('maxlength', '64')
  for (const [input, value] of [[railPrice, '1e100000000'], [purchasePrice, '1e-100000000']]) {
    await input.fill(value)
    for (const editor of [railPrice, purchasePrice]) {
      await expect(editor).toHaveValue(value)
      await expect(editor).toHaveAttribute('aria-invalid', 'true')
    }
    await expect(row(page, '202').locator('.manufacturing-purchase-unit-price')).toHaveText('待补价格')
    await expect(row(page, '202')).toContainText('手填单价无效')
  }
  for (const [value, resolved] of [['.5', '0.5'], ['1.', '1'], ['0', '0'], ['+1', '1']]) {
    await purchasePrice.fill(value)
    await expect(purchasePrice).toHaveValue(value)
    await expect(railPrice).toHaveValue(value)
    await expect(purchasePrice).toHaveAttribute('aria-invalid', 'false')
    await expect(railPrice).toHaveAttribute('aria-invalid', 'false')
    await expect(row(page, '202').locator('.manufacturing-purchase-unit-price')).toHaveText(`${resolved} ISK`)
  }
  await purchasePrice.fill('')
  await expect(row(page, '202')).toContainText('未找到市场报价')
})

for (const width of [320, 390, 768, 1440]) {
  test(`procurement list is readable without horizontal overflow at ${width}px`, async ({ page }) => {
    await installPurchaseFixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/manufacturing#manufacturing-purchase-list')
    await expect(list(page)).toBeFocused()
    await expect(row(page, '201')).toContainText('市场旧价 · 已计入')
    await row(page, '202').getByRole('textbox', { name: '采购单价 未采集材料' }).fill('1.25')
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await expect(list(page).getByRole('button', { name: '导出 CSV' })).toBeVisible()
    await expect(list(page).getByRole('columnheader')).toHaveCount(5)
    for (const button of await list(page).getByRole('button').all()) {
      expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44)
    }
    await list(page).scrollIntoViewIfNeeded()
    await page.screenshot({ path: `output/playwright/manufacturing-purchase-${width}.png`, fullPage: width < 500 })
  })
}

test('procurement text at 200 percent retains table headers and keyboard copy without horizontal overflow', async ({ page }) => {
  await installPurchaseFixture(page)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/manufacturing#manufacturing-purchase-list')
  await expect(row(page, '201')).toContainText('市场旧价 · 已计入')
  await list(page).evaluate(section => {
    const styles = [section, ...section.querySelectorAll('*')].map(node => [node, parseFloat(getComputedStyle(node).fontSize)])
    for (const [node, fontSize] of styles) node.style.fontSize = `${fontSize * 2}px`
  })
  await expect(list(page).getByRole('columnheader')).toHaveCount(5)
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await list(page).focus()
  await page.keyboard.press('Tab')
  await expect(list(page).getByRole('button', { name: '刷新清单行情' })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(list(page).getByRole('button', { name: '复制采购清单' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(list(page).getByRole('status')).toContainText('采购清单已复制')
  expect(await page.evaluate(() => window.copiedPurchaseList)).toContain('空卖盘材料')
})
