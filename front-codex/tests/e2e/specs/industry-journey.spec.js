import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const catalog = {
  schemaVersion: 1, scope: ['ship', 'material', 'building'],
  recipes: [{ productId: '10100000101', name: '采购路线样本', category: 'ship', outputNum: 1, materials: [{ itemId: '41000000000', quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 }],
  items: [{ itemId: '41000000000', name: '三钛合金' }],
}

async function publicFixture(page) {
  const requests = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/industry/manufacturing-scope.json', route => route.fulfill(json(catalog)))
  await installApiMock(page, ({ method, url }) => {
    requests.push({ method, path: url.pathname })
    if (url.pathname === '/api/market/categories/') return json([])
    if (url.pathname === '/api/market/items/') return json({ count: 0, results: [] })
    return json([])
  })
  return requests
}

test('guest can follow market, manufacturing and a keyboard-accessible purchase section without private API calls', async ({ page }) => {
  const requests = await publicFixture(page)
  await page.goto('/market')
  const journey = page.getByRole('navigation', { name: '市场到采购流程' })
  await expect(journey.getByRole('link', { name: '查市场价格' })).toHaveAttribute('aria-current', 'step')
  const estimate = journey.getByRole('link', { name: '估制造成本' })
  await estimate.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/manufacturing$/)
  await expect(page.getByRole('heading', { name: '制造估价', exact: true })).toBeVisible()
  await expect(journey.getByRole('link', { name: '估制造成本' })).toHaveAttribute('aria-current', 'step')
  await journey.getByRole('link', { name: '带走采购清单' }).focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/manufacturing#manufacturing-purchase-list$/)
  await expect(page.locator('#manufacturing-purchase-list')).toBeFocused()
  await expect(journey.getByRole('link', { name: '带走采购清单' })).toHaveAttribute('aria-current', 'step')
  expect(requests.every(({ method, path }) => method === 'GET' && path.startsWith('/api/market/'))).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
})

for (const width of [320, 390, 768, 1440]) {
  test(`industry steps and module guidance remain readable and clickable at ${width}px`, async ({ page }) => {
    await publicFixture(page)
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/market')
    const journey = page.getByRole('navigation', { name: '市场到采购流程' })
    for (const link of await journey.getByRole('link').all()) {
      await expect(link).toBeVisible()
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await journey.getByRole('link', { name: '公开工具 · 使用与权限' }).click()
    await expect(page).toHaveURL(/\/infocenter$/)
    await expect(page.getByRole('heading', { name: '各模块访问条件' })).toBeVisible()
    await expect(page.getByLabel('登录与授权说明')).toContainText('普通注册不会自动取得这些权限')
    await expect(page.locator('.info-tool-card').filter({ hasText: '战术协作' })).toContainText('进入组织需成员资格')
    await expect(page.locator('.info-tool-card').filter({ hasText: '军团大厅' })).toContainText('取得军团管理权')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    if (width < 1180) {
      await page.getByRole('button', { name: '打开导航' }).click()
      await expect(page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '使用与权限', exact: true })).toBeVisible()
    } else {
      await expect(page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '使用与权限', exact: true })).toBeVisible()
    }
  })
}

test('200% text size preserves all workflow links and access explanations on a narrow screen', async ({ page }) => {
  await publicFixture(page)
  await page.setViewportSize({ width: 320, height: 960 })
  await page.goto('/market')
  await page.addStyleTag({ content: '.industry-journey { font-size: 24px; } .tool-guide p, .tool-guide a, .tool-guide-access { font-size: 24px !important; } .tool-guide h3 { font-size: 32px; }' })
  const journey = page.getByRole('navigation', { name: '市场到采购流程' })
  for (const link of await journey.getByRole('link').all()) {
    const fits = await link.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)
    expect(fits).toBe(true)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await journey.getByRole('link', { name: '公开工具 · 使用与权限' }).click()
  for (const card of await page.locator('.info-tool-card').all()) {
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true)
  }
  await expect(page.getByLabel('登录与授权说明')).toContainText('私有情报')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
