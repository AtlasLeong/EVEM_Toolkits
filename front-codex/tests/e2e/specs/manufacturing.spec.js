import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const blueprintLabel = '蓝图价格（本次合计）'
const blueprintCatalog = {
  schemaVersion: 1, scope: ['ship', 'material', 'building'],
  recipes: [
    { productId: '10100000101', name: '蓝图批次样本', category: 'ship', outputNum: 2, materials: [{ itemId: '41000000000', quantity: 2 }], money: 7, time: 60, maxInstallQuantity: 10 },
    { productId: '10100000103', name: '蓝图另一目标', category: 'ship', outputNum: 1, materials: [{ itemId: '41000000000', quantity: 2 }], money: 11, time: 60, maxInstallQuantity: 10 },
  ],
  items: [{ itemId: '41000000000', name: '三钛合金' }],
}

async function installBlueprintFixture(page) {
  const quoteRequests = []
  await page.route('**/industry/manufacturing-scope.json', route => route.fulfill(json(blueprintCatalog)))
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q')
      quoteRequests.push(itemId)
      return json({ count: 1, results: [{ item_id: itemId, best_sell: '1200', status: 'fresh', observed_at: '2026-10-04T03:30:00Z' }] })
    }
    return json({})
  })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  return quoteRequests
}

const blueprintFee = page => page.getByTestId('manufacturing-cost-rail').locator('dl > div').filter({ hasText: '蓝图费用' }).locator('dd')
const manufacturingTotal = page => page.locator('.manufacturing-total-card > strong')

test('manual blueprint total starts at zero, accepts decimals, and clearing it restores the base cost', async ({ page }) => {
  await installBlueprintFixture(page)
  await page.goto('/manufacturing')
  await expect(page.getByTestId('manufacturing-config-rail')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /已拥有蓝图/ })).toHaveCount(0)
  const price = page.getByRole('textbox', { name: blueprintLabel, exact: true })
  await expect(price).toHaveValue('')
  await expect(price).toHaveAttribute('inputmode', 'decimal')
  await expect(price).toHaveAttribute('maxlength', '64')
  await expect(blueprintFee(page)).toHaveText('0 ISK')
  // One batch yields two products: 3 materials at 150% * 1200 ISK + a 7 ISK fee.
  await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  await price.fill('0')
  await expect(blueprintFee(page)).toHaveText('0 ISK')
  await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  await price.fill('1000.10')
  await expect(blueprintFee(page)).toHaveText('1,000.1 ISK')
  await expect(manufacturingTotal(page)).toHaveText('4,607.1 ISK')
  await price.fill('.5')
  await expect(manufacturingTotal(page)).toHaveText('3,607.5 ISK')
  await price.fill('')
  await expect(blueprintFee(page)).toHaveText('0 ISK')
  await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  await expect(price).not.toHaveAttribute('aria-invalid', 'true')
})

test('invalid or oversized blueprint values expose an associated error without a false complete total', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await installBlueprintFixture(page)
  await page.goto('/manufacturing')
  const price = page.getByRole('textbox', { name: blueprintLabel, exact: true })
  const rail = page.getByTestId('manufacturing-cost-rail')
  await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  await price.fill('999999999999.99')
  await expect(price).toHaveValue('999999999999.99')
  await expect(blueprintFee(page)).toHaveText('999,999,999,999.99 ISK')
  await expect(manufacturingTotal(page)).toHaveText('1,000,000,003,606.99 ISK')
  for (const value of ['-1', 'oops', 'NaN', '1e999999', '1.234', '1000000000000', '999999999999999999999999999999.99', '9'.repeat(64)]) {
    await price.fill(value)
    await expect(price).toHaveValue(value)
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await expect(price).toHaveAttribute('aria-describedby', /manufacturing-blueprint-price-error/)
    await expect(page.locator('#manufacturing-blueprint-price-error')).toBeVisible()
    await expect(rail.locator('.manufacturing-complete-state')).toHaveText('检查蓝图价格')
    await expect(blueprintFee(page)).toHaveText('待修正')
    await expect(rail).not.toContainText(/缺少\s*0\s*项|待补\s*0\s*项/)
    await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  }
  await price.fill('0')
  await expect(price).not.toHaveAttribute('aria-invalid', 'true')
  await expect(price).not.toHaveAttribute('aria-describedby', /manufacturing-blueprint-price-error/)
  await expect(rail.locator('.manufacturing-complete-state')).toHaveText('可计算')
  await expect(blueprintFee(page)).toHaveText('0 ISK')
  expect(errors).toEqual([])
})

test('blueprint total is charged once across batch changes and resets when the manufacturing target changes', async ({ page }) => {
  const quoteRequests = await installBlueprintFixture(page)
  await page.goto('/manufacturing')
  const price = page.getByRole('textbox', { name: blueprintLabel, exact: true })
  const quantity = page.getByRole('spinbutton', { name: '制造数量' })
  await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
  const originalRequests = quoteRequests.length
  await price.fill('1000.10')
  await quantity.fill('2')
  await expect(manufacturingTotal(page)).toHaveText('4,607.1 ISK')
  await quantity.fill('3')
  // Two batches: 6 materials * 1200 + 14 ISK manufacture + one 1000.10 blueprint total.
  await expect(manufacturingTotal(page)).toHaveText('8,214.1 ISK')
  await expect(price).toHaveValue('1000.10')
  await expect(blueprintFee(page)).toHaveText('1,000.1 ISK')
  await expect.poll(() => quoteRequests.length).toBe(originalRequests)
  const route = page.getByRole('group', { name: '生产方式 蓝图批次样本', exact: true })
  await route.getByRole('button', { name: '购买', exact: true }).click()
  await expect(manufacturingTotal(page)).toHaveText('4,600.1 ISK')
  await expect(price).toHaveValue('1000.10')
  await route.getByRole('button', { name: '自造', exact: true }).click()
  await expect(price).toHaveValue('1000.10')
  await expect(manufacturingTotal(page)).toHaveText('8,214.1 ISK')
  await page.getByRole('button', { name: '切换制造目标' }).click()
  await page.getByRole('option', { name: '蓝图另一目标', exact: true }).click()
  await expect(price).toHaveValue('')
  await expect(blueprintFee(page)).toHaveText('0 ISK')
  await expect(manufacturingTotal(page)).toHaveText('10,833 ISK')
})

for (const width of [320, 390]) {
  test(`manual blueprint total stays editable and both cost summaries agree at ${width}px`, async ({ page }) => {
    await installBlueprintFixture(page)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/manufacturing')
    const price = page.getByRole('textbox', { name: blueprintLabel, exact: true })
    const quick = page.getByTestId('manufacturing-mobile-overview')
    await price.scrollIntoViewIfNeeded()
    await expect(price).toBeInViewport({ ratio: 1 })
    await price.fill('1000.10')
    await expect(quick.locator('strong')).toHaveText('4,607.1 ISK')
    await expect(manufacturingTotal(page)).toHaveText('4,607.1 ISK')
    await price.fill('-1')
    await expect(price).toHaveAttribute('aria-invalid', 'true')
    await expect(quick.locator('.manufacturing-complete-state')).toHaveText('检查蓝图价格')
    await expect(page.getByTestId('manufacturing-cost-rail').locator('.manufacturing-complete-state')).toHaveText('检查蓝图价格')
    await expect(quick).not.toContainText(/待补\s*0\s*项/)
    await expect(blueprintFee(page)).toHaveText('待修正')
    await price.fill('')
    await expect(quick.locator('strong')).toHaveText('3,607 ISK')
    await expect(manufacturingTotal(page)).toHaveText('3,607 ISK')
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    const rect = await price.boundingBox()
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(width)
  })
}

test('manufacturing estimator selects a target and exposes make/buy route controls', async ({ page }) => {
  const quoteRequests = []
  await installApiMock(page, ({ method, url }) => {
    if (method === 'GET' && url.pathname === '/api/market/items/') {
      const itemId = url.searchParams.get('q') || '41000000000'
      quoteRequests.push(itemId)
      return json({ count: 1, results: [{ item_id: itemId, name: `市场物品 ${itemId}`, best_sell: '1200', status: 'fresh', observed_at: new Date().toISOString() }] })
    }
    return undefined
  })

  await page.goto('/manufacturing')
  await expect(page.locator('main.manufacturing-page--terminal')).toBeVisible()
  await expect(page.getByTestId('manufacturing-terminal-header')).toBeVisible()
  await expect(page.getByTestId('manufacturing-config-rail')).toBeVisible()
  await expect(page.getByTestId('manufacturing-route-workspace')).toBeVisible()
  await expect(page.getByTestId('manufacturing-cost-rail')).toBeVisible()
  await expect(page.locator('main.manufacturing-page--terminal')).toHaveCSS('background-color', 'rgb(11, 23, 29)')
  await expect(page.getByText('材料公式已核实', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '制造估价' })).toBeVisible()
  await expect(page.getByRole('searchbox', { name: '搜索制造目标' })).toHaveCount(0)
  await expect(page.getByTestId('manufacturing-cost-rail').getByText('材料效率 150% 已应用')).toBeVisible()
  await expect(page.getByRole('heading', { name: '制造目标' })).toBeVisible()
  await expect(page.getByTestId('manufacturing-total-compact')).toContainText(/万|亿/)
  await expect(page.getByRole('button', { name: '展开全部层级' })).toBeVisible()
  await expect(page.getByRole('group', { name: '技能与效率' })).toBeVisible()
  await expect(page.getByRole('button', { name: '全部自造' })).toBeVisible()
  await expect(page.getByRole('button', { name: '购买中间件' })).toBeVisible()
  await expect(page.getByRole('button', { name: '恢复默认' })).toBeVisible()
  const efficiencyRate = page.getByRole('spinbutton', { name: '制造效率百分比' })
  await expect(efficiencyRate).toHaveValue('150')
  const tritanium = page.getByRole('button', { name: '查看 三钛合金', exact: true })
  await expect(tritanium).toContainText('57,951 件')
  await efficiencyRate.fill('100')
  await expect(tritanium).toContainText('38,634 件')
  await efficiencyRate.fill('75')
  await expect(tritanium).toContainText('28,976 件')
  await efficiencyRate.fill('50')
  await expect(page.getByText('低于客户端下限，按 75% 计算。')).toBeVisible()
  await expect(tritanium).toContainText('28,976 件')
  await efficiencyRate.fill('112.11')
  await expect(efficiencyRate).toHaveValue('112.11')
  await expect(tritanium).toContainText('43,313 件')
  await expect(page.getByText('技能 / 建筑预设 · 待接入', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('combobox', { name: '生产建筑' })).toHaveCount(0)

  await page.getByRole('button', { name: '切换制造目标' }).click()
  let targetDialog = page.getByRole('dialog', { name: '选择制造目标' })
  await expect(targetDialog).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(targetDialog).toHaveCount(0)
  await page.getByRole('button', { name: '切换制造目标' }).click()
  targetDialog = page.getByRole('dialog', { name: '选择制造目标' })
  await expect(targetDialog).toBeVisible()
  const targetTabs = targetDialog.getByRole('tablist', { name: '制造分类' })
  await expect(targetTabs).toBeVisible()
  await expect(targetTabs.getByRole('tab', { name: '舰船' })).toBeVisible()
  await expect(targetTabs.getByRole('tab', { name: '材料' })).toBeVisible()
  await expect(targetTabs.getByRole('tab', { name: '建筑' })).toBeVisible()
  await expect(targetDialog.getByTestId('manufacturing-target-group-ship')).toBeVisible()
  await expect(targetDialog.getByTestId('manufacturing-target-group-material')).toHaveCount(0)
  await targetTabs.getByRole('tab', { name: '材料' }).click()
  await expect(targetDialog.getByTestId('manufacturing-target-group-material')).toBeVisible()
  await expect(targetDialog.getByTestId('manufacturing-target-group-ship')).toHaveCount(0)
  await targetTabs.getByRole('tab', { name: '舰船' }).click()
  await expect(targetDialog.getByTestId('manufacturing-target-group-ship')).toBeVisible()
  await expect(targetDialog).not.toContainText('10100000101')

  const search = targetDialog.getByRole('searchbox', { name: '搜索制造目标' })
  await search.fill('组装车间模块 II')
  const targetOption = targetDialog.getByRole('option', { name: '组装车间模块 II', exact: true })
  await expect(targetOption).toBeVisible()
  await targetOption.click()
  await expect(targetDialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '组装车间模块 II' })).toBeVisible()
  await expect(page.getByRole('button', { name: '切换制造目标' })).toBeVisible()

  const quantity = page.getByRole('spinbutton', { name: '制造数量' })
  await expect(quantity).toHaveValue('1')
  await expect(page.getByTestId('manufacturing-quantity-value')).toHaveValue('1')
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await expect(quantity).toHaveValue('2')

  await expect(page.getByRole('tree', { name: '制造链路' })).toBeVisible()
  await page.getByRole('button', { name: '购买中间件' }).click()
  await expect(page.getByText('已应用：购买中间件（根目标保持自造）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect(page.getByText('已恢复默认路线（全部节点按配方自造）', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '展开全部层级' }).click()
  const firstRoute = page.getByRole('group', { name: /生产方式/ }).first()
  await expect(firstRoute).toBeVisible()
  await expect(firstRoute.getByRole('button', { name: '自造', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: '收起全部层级' }).click()
  await expect(page.getByRole('treeitem').first()).toBeVisible()
  const routeGroup = page.getByRole('group', { name: /生产方式/ }).first()
  const routeToggle = routeGroup.getByRole('button', { name: '购买', exact: true })
  await expect(routeToggle).toBeVisible()
  await routeToggle.click()
  await expect.poll(() => quoteRequests.includes('24041000020')).toBeTruthy()
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveAttribute('data-state', 'active')
  await expect(routeGroup.getByRole('button', { name: '购买', exact: true })).toHaveCSS('background-color', 'rgb(239, 181, 102)')
  await expect(page.locator('[data-testid="manufacturing-tree-row"][data-selected="true"]')).toBeVisible()
  await expect(page.getByTestId('manufacturing-cost-rail').getByText('市场参考价', { exact: true })).toBeVisible()

  const quoteRequestCount = quoteRequests.length
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await expect(quantity).toHaveValue('4')
  await expect(page.getByTestId('manufacturing-quantity-value')).toHaveValue('4')
  await expect.poll(() => quoteRequests.length).toBe(quoteRequestCount)

  const manualPrice = page.getByRole('textbox', { name: '方案手填单价' })
  await expect(manualPrice).toBeVisible()
  await manualPrice.fill('99.5')
  await expect(page.getByTestId('manufacturing-cost-rail').getByText('方案内手填', { exact: true })).toBeVisible()
  await expect(page.getByTestId('manufacturing-cost-rail')).toContainText(/已覆盖小计|总成本/)
})

test('manufacturing terminal stays dense and readable on a narrow viewport', async ({ page }) => {
  await page.goto('/manufacturing')
  await page.setViewportSize({ width: 520, height: 900 })
  await expect(page.getByTestId('manufacturing-terminal-header')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: '制造效率百分比' })).toBeVisible()
  await expect(page.getByRole('button', { name: '自造', exact: true }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '购买', exact: true }).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(520)
})

test('target picker supports keyboard selection and restores focus on dismissal', async ({ page }) => {
  await installApiMock(page, () => undefined)
  await page.goto('/manufacturing')
  const trigger = page.getByRole('button', { name: '切换制造目标' })
  await trigger.click()
  const dialog = page.getByRole('dialog', { name: '选择制造目标' })
  const search = dialog.getByRole('searchbox', { name: '搜索制造目标' })
  await expect(search).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(trigger).toBeFocused()
  await trigger.press('Enter')
  const close = dialog.getByRole('button', { name: '关闭目标选择器' })
  await close.focus()
  await page.keyboard.press('Shift+Tab')
  await expect.poll(() => dialog.evaluate(node => node.contains(document.activeElement))).toBeTruthy()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  const ships = dialog.getByRole('tab', { name: /舰船/ })
  await ships.focus()
  await page.keyboard.press('ArrowRight')
  await expect(dialog.getByRole('tab', { name: /材料/ })).toBeFocused()
  await expect(dialog.getByRole('tab', { name: /材料/ })).toHaveAttribute('aria-selected', 'true')
  await search.fill('10100000101')
  await expect(dialog.getByRole('option')).toHaveCount(0)
  await search.fill('矮脚鸡级')
  await search.dispatchEvent('keydown', { key: 'ArrowDown', isComposing: true })
  await expect(search).toBeFocused()
  await search.dispatchEvent('keydown', { key: 'Escape', isComposing: true })
  await expect(dialog).toBeVisible()
  await search.press('ArrowDown')
  await expect(dialog.getByRole('option', { name: '矮脚鸡级', exact: true })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(dialog).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '矮脚鸡级', exact: true })).toBeVisible()
  await expect(trigger).toBeFocused()
  const card = page.getByRole('button', { name: '当前制造目标：矮脚鸡级' })
  await card.click()
  await page.locator('.manufacturing-target-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(dialog).toHaveCount(0)
  await expect(card).toBeFocused()
})

for (const viewport of [{ width: 1280, height: 600 }, { width: 390, height: 700 }]) {
  test(`target picker fits ${viewport.width}x${viewport.height} and preserves compact icon alignment`, async ({ page }) => {
    await installApiMock(page, () => undefined)
    await page.setViewportSize(viewport)
    await page.goto('/manufacturing')
    await page.getByRole('button', { name: '切换制造目标' }).click()
    const dialog = page.getByRole('dialog', { name: '选择制造目标' })
    await expect(dialog).toBeInViewport({ ratio: 1 })
    const rect = await dialog.boundingBox()
    expect(rect.x).toBeGreaterThanOrEqual(0)
    expect(rect.y).toBeGreaterThanOrEqual(0)
    expect(rect.x + rect.width).toBeLessThanOrEqual(viewport.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(viewport.height)
    const first = dialog.getByRole('option').first()
    expect((await first.locator('.market-item-icon').boundingBox()).width).toBe(28)
    await dialog.getByRole('tab', { name: /建筑/ }).click()
    await expect(dialog.getByTestId('manufacturing-target-group-building')).toBeVisible()
    const option = dialog.getByRole('option').last()
    const name = await option.getAttribute('aria-label')
    await option.click()
    await expect(dialog).toHaveCount(0)
    await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width)
  })
}

test('manufacturing route choices are separated console buttons without nested borders', async ({ page }) => {
  await installApiMock(page, () => undefined)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/manufacturing')
  const group = page.getByRole('group', { name: '生产方式 狮鹫级', exact: true })
  const make = group.getByRole('button', { name: '自造', exact: true })
  const buy = group.getByRole('button', { name: '购买', exact: true })
  await expect(group).toBeVisible()
  const geometry = async () => Promise.all([group, make, buy].map(control => control.boundingBox()))
  const before = await geometry()
  expect(before[2].x - before[1].x - before[1].width).toBeCloseTo(6, 1)
  await expect(group).toHaveCSS('border-top-width', '0px')
  await expect(group).toHaveCSS('overflow', 'visible')
  for (const button of [make, buy]) {
    await expect(button).toHaveCSS('border-radius', '8px')
    await expect(button).toHaveCSS('border-left-color', button === make ? 'rgb(239, 181, 102)' : 'rgb(95, 126, 137)')
    await expect(button).toHaveCSS('box-shadow', 'none')
    await expect(button).toHaveCSS('transform', 'none')
  }
  await buy.click()
  await expect(buy).toHaveAttribute('aria-pressed', 'true')
  await expect(buy).toHaveCSS('background-color', 'rgb(239, 181, 102)')
  const after = await geometry()
  for (let index = 0; index < before.length; index += 1) {
    expect(after[index].x).toBeCloseTo(before[index].x, 1)
    expect(after[index].width).toBeCloseTo(before[index].width, 1)
  }
  await make.click()
  await expect(make).toHaveAttribute('aria-pressed', 'true')
})

test('manufacturing counts unpriced purchases and hides disconnected preset controls', async ({ page }) => {
  await installApiMock(page, () => undefined)
  await page.goto('/manufacturing')
  await expect(page.locator('.manufacturing-total-card')).toContainText('缺少 8 项购买价格')
  await expect(page.locator('.manufacturing-route-footer')).toContainText('购买项8 类')
  await expect(page.locator('.manufacturing-pending-presets')).toHaveCount(0)
  await expect(page.getByText('方案配置', { exact: true })).toHaveCount(0)
  await expect(page.getByText('成本摘要', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('spinbutton', { name: '制造效率百分比' })).toHaveValue('150')
  await expect(page.locator('.manufacturing-price-help')).toContainText(['填写游戏中含技能、设施加成的最终值；初始 150%，最低 75%。当前统一用于所有自造层级。', '材料按客户端逐批取整；制造费用与时间暂按基础配方估算。', '点击制造链中的节点，可查看市场参考价并设置本方案的购买单价。'])
})

for (const width of [1440, 390]) {
  test(`manufacturing picker and selected-node gutters keep horizontal geometry stable at ${width}px`, async ({ page }) => {
    await installApiMock(page, () => undefined)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/manufacturing')
    await expect(page.getByTestId('manufacturing-config-rail')).toBeVisible()
    // A real scrolling document is required to catch overflow-lock expansion;
    // tall mobile pages provide it naturally, and this reproduces it on desktop.
    await page.addStyleTag({ content: 'body { min-height: calc(100vh + 40px); }' })
    await expect(page.locator('html')).toHaveCSS('scrollbar-gutter', 'stable')
    const layout = () => page.evaluate(() => ({
      rootWidth: document.documentElement.clientWidth,
      bodyWidth: document.body.getBoundingClientRect().width,
      cards: ['.manufacturing-workspace', '.manufacturing-controls', '.manufacturing-tree-panel', '.manufacturing-summary'].map(selector => {
        const node = document.querySelector(selector)
        const rect = node.getBoundingClientRect()
        return { x: rect.x, width: rect.width, clientWidth: node.clientWidth }
      }),
    }))
    const stable = (before, after) => {
      // clientWidth reflects whether a classic scrollbar is currently painted;
      // the reserved layout area must stay constant even when it is hidden.
      expect(after.bodyWidth).toBeCloseTo(before.bodyWidth, 1)
      for (let index = 0; index < before.cards.length; index += 1) {
        expect(after.cards[index].x).toBeCloseTo(before.cards[index].x, 1)
        expect(after.cards[index].width).toBeCloseTo(before.cards[index].width, 1)
        expect(after.cards[index].clientWidth).toBe(before.cards[index].clientWidth)
      }
    }
    const before = await layout()
    if (width < 640) {
      expect(before.rootWidth).toBe(width)
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width)
      const choices = await page.getByRole('group', { name: '生产方式 狮鹫级', exact: true }).boundingBox()
      const expand = await page.getByRole('button', { name: '收起 狮鹫级层级', exact: true }).boundingBox()
      expect(expand.y + expand.height / 2).toBeCloseTo(choices.y + choices.height / 2, 1)
    }
    await page.getByRole('button', { name: '切换制造目标' }).click()
    await expect(page.getByRole('dialog', { name: '选择制造目标' })).toBeVisible()
    stable(before, await layout())
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: '选择制造目标' })).toHaveCount(0)
    stable(before, await layout())
    await page.getByRole('button', { name: '查看 光泽合金', exact: true }).click()
    await expect(page.getByRole('textbox', { name: '方案手填单价' })).toBeVisible()
    stable(before, await layout())
    const selected = page.locator('[data-testid="manufacturing-tree-row"][data-selected="true"]')
    expect(await selected.evaluate(node => getComputedStyle(node).boxShadow.endsWith('inset'))).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
