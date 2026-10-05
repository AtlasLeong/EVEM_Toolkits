import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const catalog = {
  schemaVersion: 1, scope: ['ship', 'material', 'building'],
  recipes: [{ productId: '10100000101', name: '采购路线样本', category: 'ship', outputNum: 1, materials: [{ itemId: '41000000000', quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 }],
  items: [{ itemId: '41000000000', name: '三钛合金' }],
}

const navigationItems = Array.from({ length: 8 }, (_, index) => ({
  itemId: `4100000000${index}`, name: index === 0 ? '三钛合金' : `导航测试材料 ${index + 1}`,
}))
const navigationCatalog = {
  ...catalog,
  items: navigationItems,
  recipes: [
    { ...catalog.recipes[0], materials: navigationItems.map((item, index) => ({ itemId: item.itemId, quantity: index + 2 })) },
    { ...catalog.recipes[0], productId: '10100000102', name: '导航方案第二目标', money: 11, materials: navigationItems.map(item => ({ itemId: item.itemId, quantity: 3 })) },
  ],
}

async function navigationFixture(page, { delayQuotes = false } = {}) {
  let releaseQuotes
  const quotesReady = delayQuotes ? new Promise(resolve => { releaseQuotes = resolve }) : Promise.resolve()
  const quoteRequests = []
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/industry/manufacturing-scope.json', route => route.fulfill(json(navigationCatalog)))
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([])
    if (url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q')
      quoteRequests.push(itemId)
      await quotesReady
      const item = navigationItems.find(candidate => candidate.itemId === itemId)
      return json({ count: item ? 1 : 0, results: item ? [{
        item_id: item.itemId, name: item.name, status: 'fresh', best_sell: '1.25', observed_at: new Date().toISOString(),
      }] : [] })
    }
    return json([])
  })
  return { quoteRequests, releaseQuotes: () => releaseQuotes?.() }
}

function workflow(page) {
  const journey = page.getByRole('navigation', { name: '市场到采购流程' })
  return {
    journey,
    estimate: journey.getByRole('link', { name: '估制造成本', exact: true }),
    purchase: journey.getByRole('link', { name: '带走采购清单', exact: true }),
    main: page.locator('main.manufacturing-page'),
    heading: page.locator('.manufacturing-page-header h1'),
    quantity: page.getByTestId('manufacturing-quantity-value'),
    price: page.getByRole('textbox', { name: '采购单价 三钛合金', exact: true }),
    purchaseSection: page.getByTestId('manufacturing-purchase-list'),
  }
}

async function readNavigationLayout(page) {
  return page.evaluate(() => {
    const main = document.querySelector('main.manufacturing-page')
    const rectangle = element => {
      const { x, y, width, height, bottom } = element.getBoundingClientRect()
      return { x, y, width, height, bottom }
    }
    const outer = []
    for (let element = main.parentElement; element; element = element.parentElement) {
      outer.push({ name: `${element.tagName}.${element.className}`, top: element.scrollTop, left: element.scrollLeft })
    }
    return {
      top: main.scrollTop,
      windowTop: window.scrollY,
      outer,
      main: rectangle(main),
      journey: rectangle(document.querySelector('.industry-journey')),
      footer: rectangle(document.querySelector('.site-footer')),
      rails: ['manufacturing-config-rail', 'manufacturing-route-workspace', 'manufacturing-cost-rail'].map(id => (
        rectangle(document.querySelector(`[data-testid="${id}"]`))
      )),
    }
  })
}

function expectDesktopShellUnchanged(before, after) {
  expect(after.outer.length).toBe(before.outer.length)
  after.outer.forEach((ancestor, index) => {
    expect(ancestor.name).toBe(before.outer[index].name)
    expect(Math.abs(ancestor.top - before.outer[index].top), `${ancestor.name} vertical scroll`).toBeLessThanOrEqual(1)
    expect(Math.abs(ancestor.left - before.outer[index].left), `${ancestor.name} horizontal scroll`).toBeLessThanOrEqual(1)
  })
  expect(Math.abs(after.windowTop - before.windowTop)).toBeLessThanOrEqual(1)
  for (const field of ['x', 'y', 'width', 'height']) {
    expect(Math.abs(after.journey[field] - before.journey[field]), `journey ${field}`).toBeLessThanOrEqual(1)
    expect(Math.abs(after.main[field] - before.main[field]), `main ${field}`).toBeLessThanOrEqual(1)
  }
  after.rails.forEach((rail, index) => {
    expect(Math.abs(rail.width - before.rails[index].width), `rail ${index} width`).toBeLessThanOrEqual(1)
    expect(Math.abs(rail.x - before.rails[index].x), `rail ${index} horizontal position`).toBeLessThanOrEqual(1)
  })
}

async function waitForReferenceQuotes(page) {
  await expect(page.locator('.manufacturing-purchase-source').filter({ hasText: '市场参考价' })).toHaveCount(navigationItems.length)
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function settleNavigation(page) {
  await page.evaluate(async () => {
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
}

async function expectEditorVisible(editor) {
  // Native scrolling uses integer pixels; allow a fractional border at the
  // viewport edge while checking the editable center and bottom remain usable.
  await expect.poll(() => editor.evaluate(element => {
    const rect = element.getBoundingClientRect()
    const clip = { left: 0, top: 0, right: innerWidth, bottom: innerHeight }
    for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
      const bounds = ancestor.getBoundingClientRect()
      const style = getComputedStyle(ancestor)
      if (style.overflowX !== 'visible') {
        clip.left = Math.max(clip.left, bounds.left + ancestor.clientLeft)
        clip.right = Math.min(clip.right, bounds.left + ancestor.clientLeft + ancestor.clientWidth)
      }
      if (style.overflowY !== 'visible') {
        clip.top = Math.max(clip.top, bounds.top + ancestor.clientTop)
        clip.bottom = Math.min(clip.bottom, bounds.top + ancestor.clientTop + ancestor.clientHeight)
      }
    }
    const center = rect.left + rect.width / 2
    return {
      within: rect.left >= clip.left - 1 && rect.right <= clip.right + 1 && rect.top >= clip.top - 1 && rect.bottom <= clip.bottom + 1,
      center: document.elementFromPoint(center, rect.top + rect.height / 2) === element,
      bottom: document.elementFromPoint(center, rect.bottom - 1) === element,
    }
  })).toEqual({ within: true, center: true, bottom: true })
}

async function doublePurchaseText(page) {
  await page.evaluate(() => {
    const records = [...document.querySelectorAll('.industry-journey, .industry-journey *, #manufacturing-purchase-list, #manufacturing-purchase-list *')]
      .filter(element => [...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()) || element.matches('input'))
      .map(element => {
        const style = getComputedStyle(element)
        return { element, font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) }
      })
    for (const { element, font, line } of records) {
      if (Number.isFinite(font)) element.style.setProperty('font-size', `${font * 2}px`, 'important')
      if (Number.isFinite(line)) element.style.setProperty('line-height', `${line * 2}px`, 'important')
    }
  })
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

function marketNextLink(page, width) {
  return width < 1180
    ? page.getByRole('link', { name: '下一步：制造估价' })
    : page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '制造估价', exact: true })
}

test('guest can follow market, manufacturing and a keyboard-accessible purchase section without private API calls', async ({ page }) => {
  const requests = await publicFixture(page)
  await page.setViewportSize({ width: 390, height: 960 })
  await page.goto('/market')
  const journey = page.getByRole('navigation', { name: '市场到采购流程' })
  await expect(journey).toHaveCount(0)
  const estimate = marketNextLink(page, 390)
  await estimate.focus()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/manufacturing$/)
  await expect(page.getByRole('heading', { name: '制造估价', exact: true })).toBeVisible()
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(journey.getByRole('link', { name: '估制造成本' })).toHaveAttribute('aria-current', 'step')
  await page.keyboard.press('Tab')
  await expect(journey.getByRole('link', { name: '查市场价格' })).toBeFocused()
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await expect(journey.getByRole('link', { name: '带走采购清单' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/manufacturing#manufacturing-purchase-list$/)
  await expect(page.locator('#manufacturing-purchase-list')).toBeFocused()
  await expect(journey.getByRole('link', { name: '带走采购清单' })).toHaveAttribute('aria-current', 'step')
  expect(requests.every(({ method, path }) => method === 'GET' && path.startsWith('/api/market/'))).toBe(true)
  expect(await page.evaluate(() => localStorage.getItem('access_token'))).toBeNull()
})

test('a focused market next step moves focus to the page when desktop navigation replaces the mobile header', async ({ page }) => {
  await publicFixture(page)
  await page.setViewportSize({ width: 768, height: 960 })
  await page.goto('/market')
  await marketNextLink(page, 768).focus()
  await page.setViewportSize({ width: 1440, height: 960 })
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(marketNextLink(page, 1440)).toBeVisible()
})

for (const width of [320, 390, 768, 1440]) {
  test(`industry steps and module guidance remain readable and clickable at ${width}px`, async ({ page }) => {
    await publicFixture(page)
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/market')
    const journey = page.getByRole('navigation', { name: '市场到采购流程' })
    const next = marketNextLink(page, width)
    await expect(next).toBeVisible()
    expect((await next.boundingBox()).height).toBeGreaterThanOrEqual(44)
    await expect(journey).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `output/playwright/market-next-${width}.png`, fullPage: true })
    await next.click()
    await expect(page).toHaveURL(/\/manufacturing$/)
    for (const link of await journey.getByRole('link').all()) {
      await expect(link).toBeVisible()
      expect((await link.boundingBox()).height).toBeGreaterThanOrEqual(44)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `output/playwright/industry-journey-${width}.png`, fullPage: true })
    await journey.getByRole('link', { name: '公开工具 · 使用与权限' }).click()
    await expect(page).toHaveURL(/\/infocenter$/)
    await expect(page.getByRole('heading', { name: '各模块访问条件' })).toBeVisible()
    await expect(page.getByLabel('登录与授权说明')).toContainText('普通注册不会自动取得这些权限')
    await expect(page.locator('.info-tool-card').filter({ hasText: '战术协作' })).toContainText('进入组织需成员资格')
    await expect(page.locator('.info-tool-card').filter({ hasText: '军团大厅' })).toContainText('取得军团管理权')
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: `output/playwright/tool-guide-${width}.png`, fullPage: true })
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
  await page.addStyleTag({ content: '.mobile-brand-name { font-size: 32px; } .mobile-industry-next { font-size: 26px; } .industry-journey { font-size: 24px; } .tool-guide p, .tool-guide a, .tool-guide-access { font-size: 24px !important; } .tool-guide h3 { font-size: 32px; }' })
  const next = marketNextLink(page, 320)
  await expect(next).toBeVisible()
  expect(await next.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await next.click()
  await expect(page).toHaveURL(/\/manufacturing$/)
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

for (const [width, textSize] of [1440, 2048, 1100, 1179].flatMap(width => [100, 200].map(textSize => [width, textSize]))) {
  test(`purchase navigation, wheel and keyboard preserve the desktop shell at ${width}px and ${textSize}% text`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    if (textSize === 200) await doublePurchaseText(page)
    const controls = workflow(page)
    const before = await readNavigationLayout(page)
    for (const rail of before.rails) expect(Math.abs(rail.y - before.rails[0].y)).toBeLessThanOrEqual(1)
    expect(before.main.bottom, 'manufacturing scroll surface ends above the site footer').toBeLessThanOrEqual(before.footer.y)
    await controls.quantity.fill('3')
    await controls.purchase.focus()
    await page.keyboard.press('Enter')
    await expect(controls.purchaseSection).toBeFocused()
    await expect.poll(() => controls.main.evaluate(element => element.scrollTop)).toBeGreaterThan(before.top)
    const after = await readNavigationLayout(page)
    expectDesktopShellUnchanged(before, after)
    await expect(controls.journey).toBeInViewport()
    await expect(controls.purchaseSection.locator('h2')).toBeInViewport()

    // Use physical wheel/click coordinates: locator clicks would silently scroll
    // an obscured input or its shell ancestors into view before interacting.
    await page.mouse.move(before.main.x + before.main.width / 2, before.main.bottom - 100)
    await page.mouse.wheel(0, 6000)
    await expect.poll(() => controls.main.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop)).toBeLessThanOrEqual(1)
    await page.mouse.wheel(0, 6000)
    const lastPrice = controls.purchaseSection.locator('tbody input').last()
    await expect(lastPrice).toBeInViewport({ ratio: 1 })
    const priceBounds = await lastPrice.boundingBox()
    expect(await lastPrice.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return hit === element || element.contains(hit)
    }), 'last purchase input can receive a real click').toBe(true)
    await page.mouse.click(priceBounds.x + priceBounds.width / 2, priceBounds.y + priceBounds.height / 2)
    await expect(lastPrice).toBeFocused()
    await lastPrice.fill('2.7500')
    await page.keyboard.press('Shift+Tab')
    await expect(controls.purchaseSection.locator('tbody tr').last().getByRole('link')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(lastPrice).toBeFocused()
    expectDesktopShellUnchanged(before, await readNavigationLayout(page))

    await test.step('Back returns to the estimate after a real bottom-of-list edit', async () => {
      await page.goBack()
      await expect(page).toHaveURL(/\/manufacturing$/)
      await expect(controls.heading).toBeFocused()
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
      await expect(controls.heading).toBeInViewport({ ratio: 1 })
    })
    await test.step('Forward returns to the purchase anchor without losing the plan', async () => {
      await page.goForward()
      await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
      await expect(controls.purchaseSection).toBeFocused()
      await expect(controls.purchaseSection.locator('h2')).toBeInViewport()
      await expect(lastPrice).toHaveValue('2.7500')
      await expect(controls.quantity).toHaveValue('3')
    })
    await test.step('second workflow step returns focus to the estimate', async () => {
      await controls.estimate.focus()
      await page.keyboard.press('Enter')
      await expect(page).toHaveURL(/\/manufacturing$/)
      await expect(controls.heading).toBeFocused()
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    })
    await test.step('native Back and Forward after the second step preserve the shell', async () => {
      await page.evaluate(() => history.back())
      await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
      await expect(controls.purchaseSection).toBeFocused()
      expectDesktopShellUnchanged(before, await readNavigationLayout(page))
      await page.evaluate(() => history.forward())
      await expect(page).toHaveURL(/\/manufacturing$/)
      await expect(controls.heading).toBeFocused()
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    })
    expectDesktopShellUnchanged(before, await readNavigationLayout(page))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const width of [390, 768, 1099]) {
  test(`stacked purchase navigation uses window scrolling and returns to the estimate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    const controls = workflow(page)
    const before = await readNavigationLayout(page)
    expect(before.rails[1].y).toBeGreaterThanOrEqual(before.rails[0].bottom)
    expect(before.rails[2].y).toBeGreaterThanOrEqual(before.rails[1].bottom)
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await expect.poll(async () => {
      const layout = await readNavigationLayout(page)
      return layout.windowTop + layout.outer.reduce((total, element) => total + element.top, 0)
    }).toBeGreaterThan(0)
    await expect(controls.purchaseSection.locator('h2')).toBeInViewport()
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    await page.mouse.move(width / 2, 700)
    await page.mouse.wheel(0, 6000)
    const lastPrice = controls.purchaseSection.locator('tbody input').last()
    await expect(lastPrice).toBeInViewport()
    expect(await lastPrice.evaluate(element => {
      const bounds = element.getBoundingClientRect()
      const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
      return hit === element || element.contains(hit)
    })).toBe(true)
    // Browser history reaches the return branch without Playwright first
    // scrolling the offscreen second-step link into view.
    await page.goBack()
    await expect(page).toHaveURL(/\/manufacturing$/)
    await expect(controls.heading).toBeFocused()
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(page.locator('.site-frame')).toHaveJSProperty('scrollTop', 0)
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    await expect(controls.journey).toBeInViewport()
    await expect(controls.heading).toBeInViewport({ ratio: 1 })
    expect(await controls.heading.evaluate(element => {
      const header = document.querySelector('.mobile-shell-header')
      return element.getBoundingClientRect().top >= header.getBoundingClientRect().bottom - 1
    })).toBe(true)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}

for (const [width, textSize, narrowWidth] of [[1440, 100, 390], [1100, 100, 1099], [1179, 100, null], [2048, 100, null], [1440, 200, 390]]) {
  test(`native fragment history keeps the workflow visible at ${width}px and ${textSize}% text`, async ({ page }) => {
    // Use the shipped catalog and normal API requests. Neither browser history
    // nor animation frames are replaced or paused in this integration path.
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/manufacturing')
    const controls = workflow(page)
    const firstPrice = controls.purchaseSection.locator('tbody input').first()
    await expect(firstPrice).toBeAttached()
    await settleNavigation(page)
    if (textSize === 200) { await doublePurchaseText(page); await settleNavigation(page) }
    const before = await readNavigationLayout(page)
    const physicalClick = async link => {
      await expect(link).toBeInViewport({ ratio: 1 })
      const bounds = await link.boundingBox()
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
    }
    const unchangedShell = async () => {
      await settleNavigation(page)
      expectDesktopShellUnchanged(before, await readNavigationLayout(page))
      await expect(controls.journey).toBeInViewport({ ratio: 1 })
    }
    await physicalClick(controls.purchase)
    await expect(controls.purchaseSection).toBeFocused()
    await physicalClick(controls.estimate)
    await expect(controls.heading).toBeFocused()
    for (let repeat = 0; repeat < 2; repeat++) {
      await page.evaluate(() => history.back())
      await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
      await expect(controls.purchaseSection).toBeFocused()
      await unchangedShell()
      await page.evaluate(() => history.forward())
      await expect(page).toHaveURL(/\/manufacturing$/)
      await expect(controls.heading).toBeFocused()
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
      await unchangedShell()
    }
    // Reverse again as soon as the Back route commits, without waiting for its
    // focus frame. The final route must leave the workflow and shell in place.
    await page.evaluate(() => history.back())
    await expect(controls.purchase).toHaveAttribute('aria-current', 'step')
    await page.evaluate(() => history.forward())
    await expect(controls.estimate).toHaveAttribute('aria-current', 'step')
    await expect(controls.heading).toBeFocused()
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    await unchangedShell()

    if (narrowWidth) {
      await page.evaluate(() => history.back())
      await expect(controls.purchaseSection).toBeFocused()
      await expect.poll(() => controls.main.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
      await page.setViewportSize({ width: narrowWidth, height: 960 })
      await settleNavigation(page)
      await page.evaluate(() => history.forward())
      await expect(controls.heading).toBeFocused()
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
      await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
      await expect(page.locator('.site-frame')).toHaveJSProperty('scrollTop', 0)
      await page.setViewportSize({ width, height: 960 })
      await expect(controls.main).toHaveJSProperty('scrollTop', 0)
      await expect(controls.heading).toBeFocused()
      await expect(controls.heading).toBeInViewport({ ratio: 1 })
      await unchangedShell()
      await page.evaluate(() => history.back())
      await expect(controls.purchaseSection).toBeFocused()
      await expect(controls.purchaseSection.locator('h2')).toBeInViewport()
      await unchangedShell()
    }
    await page.goto('/manufacturing#manufacturing-purchase-list')
    await expect(controls.purchaseSection).toBeFocused()
    await expect(controls.purchaseSection.locator('h2')).toBeInViewport()
    // Startup hash navigation must preserve every shell ancestor, too.
    await settleNavigation(page)
    const direct = await readNavigationLayout(page)
    expect(direct.outer.every(ancestor => ancestor.top === 0 && ancestor.left === 0)).toBe(true)
    await expect(controls.journey).toBeInViewport({ ratio: 1 })
  })
}

for (const [width, narrowWidth] of [[1440, 390], [1100, 1099]]) {
  test(`price editing keeps focus and plan values across ${width}px and ${narrowWidth}px layouts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    const controls = workflow(page)
    await controls.quantity.fill('3')
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await controls.price.fill('2.7500')
    await expect(controls.price).toBeFocused()
    await page.setViewportSize({ width: narrowWidth, height: 960 })
    await expect(controls.price).toBeFocused()
    await expectEditorVisible(controls.price)
    await expect(controls.quantity).toHaveValue('3')
    await expect(controls.price).toHaveValue('2.7500')
    await page.setViewportSize({ width, height: 960 })
    await expect(controls.price).toBeFocused()
    await expectEditorVisible(controls.price)
    await expect(controls.quantity).toHaveValue('3')
    await expect(controls.price).toHaveValue('2.7500')
    const restored = await readNavigationLayout(page)
    expect(restored.windowTop).toBe(0)
    expect(restored.outer.every(ancestor => ancestor.top === 0 && ancestor.left === 0)).toBe(true)
    await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
  })

  test(`target picker keeps keyboard focus across ${width}px and ${narrowWidth}px layouts`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    const controls = workflow(page)
    await controls.quantity.fill('3')
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    const mainBounds = await controls.main.boundingBox()
    await page.mouse.move(mainBounds.x + mainBounds.width / 2, mainBounds.y + mainBounds.height / 2)
    await page.mouse.wheel(0, -10000)
    await expect.poll(() => controls.main.evaluate(element => element.scrollTop)).toBe(0)
    const trigger = page.locator('.manufacturing-change-target')
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await trigger.click()
    const dialog = page.getByRole('dialog', { name: '选择制造目标' })
    const search = dialog.getByRole('searchbox')
    const close = dialog.getByRole('button', { name: '关闭目标选择器' })
    await expect(search).toBeFocused()
    await page.setViewportSize({ width: narrowWidth, height: 960 })
    await settleNavigation(page)
    await expect(search).toBeFocused()
    await expect(dialog).toBeInViewport({ ratio: 1 })
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    await page.keyboard.press('Shift+Tab')
    await expect(close).toBeFocused()
    await page.setViewportSize({ width, height: 960 })
    await settleNavigation(page)
    await expect(close).toBeFocused()
    await expect(dialog).toBeInViewport({ ratio: 1 })
    await expect(page.locator('#root')).toHaveJSProperty('inert', true)
    await page.keyboard.press('Shift+Tab')
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true)
    await page.keyboard.press('Tab')
    await expect(close).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).toHaveCount(0)
    await expect(trigger).toBeFocused()
    await expect(trigger).toBeInViewport({ ratio: 1 })
    await expect.poll(() => trigger.evaluate(element => {
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      return element === hit || element.contains(hit)
    })).toBe(true)
    await expect(controls.quantity).toHaveValue('3')
    await expect(page.locator('#root')).toHaveJSProperty('inert', false)
    const restored = await readNavigationLayout(page)
    expect(restored.top).toBe(0)
    expect(restored.windowTop).toBe(0)
    expect(restored.outer.every(ancestor => ancestor.top === 0 && ancestor.left === 0)).toBe(true)
  })
}

for (const width of [1440, 390]) {
  test(`estimate, repeated purchase and history navigation retain the same plan at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    const controls = workflow(page)
    await controls.quantity.fill('3')
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await controls.price.fill('2.7500')
    await expect(controls.price).toBeFocused()
    await controls.estimate.click()
    await expect(controls.heading).toBeFocused()
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    if (width < 1100) await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
    await expect(controls.quantity).toHaveValue('3')
    await expect(controls.price).toHaveValue('2.7500')
    await expect(page.getByRole('button', { name: '当前制造目标：采购路线样本', exact: true })).toBeVisible()
    await page.goBack()
    await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
    await expect(controls.purchaseSection).toBeFocused()
    await expect(controls.price).toHaveValue('2.7500')
    await page.goForward()
    await expect(page).toHaveURL(/\/manufacturing$/)
    await expect(controls.heading).toBeFocused()
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    await expect(controls.quantity).toHaveValue('3')
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await controls.price.focus()
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await expect(controls.price).toHaveValue('2.7500')
    await expect(controls.quantity).toHaveValue('3')
  })
}

test('quantity, manual prices and target changes do not replay the active purchase anchor', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await navigationFixture(page)
  await page.goto('/manufacturing')
  await waitForReferenceQuotes(page)
  const controls = workflow(page)
  await controls.purchase.click()
  await expect(controls.purchaseSection).toBeFocused()
  await controls.price.focus()
  const priceScroll = await controls.main.evaluate(element => element.scrollTop)
  await controls.price.fill('4.125')
  await expect(controls.price).toBeFocused()
  await expect.poll(() => controls.main.evaluate(element => element.scrollTop)).toBe(priceScroll)
  await controls.quantity.focus()
  const quantityScroll = await controls.main.evaluate(element => element.scrollTop)
  await controls.quantity.fill('4')
  await expect(controls.quantity).toBeFocused()
  await expect.poll(() => controls.main.evaluate(element => element.scrollTop)).toBe(quantityScroll)
  await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
  const targetButton = page.getByRole('button', { name: '切换制造目标', exact: true })
  await targetButton.click()
  await page.getByRole('option', { name: '导航方案第二目标', exact: true }).click()
  await expect(page.getByRole('button', { name: '当前制造目标：导航方案第二目标', exact: true })).toBeVisible()
  await expect(targetButton).toBeFocused()
  await expect(controls.purchaseSection).not.toBeFocused()
  expect(await controls.main.evaluate(element => element.scrollTop)).toBeLessThan(100)
  await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
})

test('rapid Back and Forward before the next frame still restore the estimate destination', async ({ page }) => {
  const clockTime = Date.now()
  // Keep mocked browser time ahead of the fixture's Node observation timestamps.
  await page.clock.install({ time: new Date(clockTime + 60_000) })
  await page.setViewportSize({ width: 2048, height: 960 })
  await navigationFixture(page)
  await page.goto('/manufacturing')
  await waitForReferenceQuotes(page)
  const controls = workflow(page)
  await controls.quantity.fill('3')
  await controls.purchase.click()
  await expect(controls.purchaseSection).toBeFocused()
  await controls.price.fill('2.7500')
  await controls.estimate.click()
  await expect(controls.heading).toBeFocused()

  // Native hash history can restore purchase focus before our next frame.
  // Freeze frames so the intervening Back is cancelled by Forward reliably.
  await page.clock.pauseAt(new Date(clockTime + 120_000))
  await page.goBack()
  await expect(page).toHaveURL(/#manufacturing-purchase-list$/)
  await expect(controls.purchase).toHaveAttribute('aria-current', 'step')
  await expect(controls.purchaseSection).toBeFocused()
  await page.clock.runFor(0)
  await page.goForward()
  await expect(page).toHaveURL(/\/manufacturing$/)
  await expect(controls.estimate).toHaveAttribute('aria-current', 'step')
  await page.clock.runFor(32)
  await expect(controls.heading).toBeFocused()
  await expect(controls.main).toHaveJSProperty('scrollTop', 0)
  await expect(controls.quantity).toHaveValue('3')
  await expect(controls.price).toHaveValue('2.7500')
})

test('late market quotes do not move the purchase view or steal an active price input', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  const fixture = await navigationFixture(page, { delayQuotes: true })
  try {
    await page.goto('/manufacturing')
    const controls = workflow(page)
    await expect(controls.purchaseSection).toBeVisible()
    await expect.poll(() => fixture.quoteRequests.length).toBe(navigationItems.length)
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await controls.price.focus()
    await controls.price.fill('3.125')
    const before = await readNavigationLayout(page)
    fixture.releaseQuotes()
    await expect(page.locator('.manufacturing-purchase-source').filter({ hasText: '市场参考价' })).toHaveCount(navigationItems.length - 1)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await expect(controls.price).toBeFocused()
    await expect(controls.price).toHaveValue('3.125')
    const after = await readNavigationLayout(page)
    expectDesktopShellUnchanged(before, after)
    expect(Math.abs(after.top - before.top)).toBeLessThanOrEqual(1)
  } finally {
    fixture.releaseQuotes()
  }
})

for (const width of [390, 1440]) {
  test(`200% workflow and purchase text remain reachable with working return navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await navigationFixture(page)
    await page.goto('/manufacturing')
    await waitForReferenceQuotes(page)
    await doublePurchaseText(page)
    const controls = workflow(page)
    for (const link of await controls.journey.getByRole('link').all()) {
      expect(await link.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBe(true)
    }
    await controls.purchase.click()
    await expect(controls.purchaseSection).toBeFocused()
    await expect(controls.purchaseSection.locator('h2')).toBeInViewport()
    await controls.price.focus()
    await controls.price.fill('0.25')
    await expect(controls.price).toBeFocused()
    await expect(controls.price).toBeInViewport()
    await expect(controls.purchaseSection.getByRole('button', { name: '导出 CSV', exact: true })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await controls.estimate.click()
    await expect(controls.heading).toBeFocused()
    await expect(controls.main).toHaveJSProperty('scrollTop', 0)
    await expect(controls.price).toHaveValue('0.25')
  })
}
