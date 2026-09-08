import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/regions') return json(Array.from({ length: 24 }, (_, i) => ({ r_id: i + 1, r_title: `超长星域名称测试-${i + 1}`, r_safetylvl: i ? 0.59 : 0 })))
    if (url.pathname === '/api/constellations') return json([{ co_id: 1, co_title: '测试星座', co_safetylvl: 0.2 }])
    if (url.pathname === '/api/solarsystem') return json([{ ss_id: 1, ss_title: '测试星系', ss_safetylvl: -0.3 }])
    if (url.pathname === '/api/planetresources') return json([{ label: '船菜', options: Array.from({ length: 24 }, (_, i) => ({ value: `资源-${i + 1}`, label: `资源-${i + 1}`, icon: TINY_ICON })) }])
    return json([])
  })
})

test('复合输入框只保留外层焦点提示，独立输入框保留键盘轮廓', async ({ page }) => {
  for (const [route, wrapper, input] of [
    ['/fraudlist', '.fraud-hero-panel .search-box', '.search-input'],
    ['/planetary', '.picker-search', '.picker-input'],
    ['/planetary', '.planetary-resource-search', '.picker-input'],
    ['/login', '.auth-input-shell', '.auth-input'],
  ]) {
    await page.goto(route)
    if (wrapper === '.picker-search') await page.locator('.picker-field summary').first().click()
    if (wrapper === '.planetary-resource-search') await page.locator('.resource-disclosure summary').click()
    if (route === '/login') await page.locator('.auth-tabs').getByRole('button', { name: '注册', exact: true }).click()
    const shell = page.locator(wrapper).first()
    const field = shell.locator(input)
    await field.focus()
    await expect(field).toHaveCSS('outline-style', 'none')
    await expect(field).toHaveCSS('box-shadow', 'none')
    await expect(shell).toHaveCSS('border-top-color', 'rgb(166, 83, 62)')
    await expect(shell).not.toHaveCSS('box-shadow', 'none')
  }
  await page.goto('/login')
  await page.locator('.text-input').first().focus()
  await expect(page.locator('.text-input').first()).toHaveCSS('outline-style', 'solid')
})

test('地点摘要带安等，多选首项加数量且保持按钮对齐', async ({ page }) => {
  await page.goto('/planetary')
  const picker = page.locator('.picker-field').first()
  await picker.locator('summary').click()
  await expect(picker.locator('.picker-option')).toHaveCount(24)
  for (const option of await picker.locator('.picker-option').all()) await option.click()
  await expect(picker.locator('summary .security-badge')).toHaveText('0')
  await expect(picker.locator('summary .filter-selection-count')).toHaveText('+23 项')
  const selected = picker.locator('.picker-selected')
  await expect(selected.getByRole('button', { name: /^移除/ })).toHaveCount(24)
  expect(await selected.evaluate(e => e.scrollHeight > e.clientHeight)).toBeTruthy()
  expect(await selected.evaluate(e => e.clientHeight)).toBeLessThanOrEqual(120)
  await selected.locator('button').last().click()
  await expect(picker.locator('summary .filter-selection-count')).toHaveText('+22 项')
  await page.keyboard.press('Escape')
  await expect(picker.locator('summary')).toBeFocused()
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    const box = await picker.locator('.filter-value').boundingBox()
    const action = await page.locator('.planetary-filters .primary-btn').boundingBox()
    expect(Math.abs(box.y - action.y)).toBeLessThanOrEqual(1)
    expect(box.height).toBe(42)
    expect(await picker.locator('.filter-selection').evaluate(e => e.scrollWidth <= e.clientWidth)).toBeTruthy()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})

test('星座和星系摘要复用各自安等且上级清空仍清除下级', async ({ page }) => {
  await page.goto('/planetary')
  for (const [index, security] of [[0, '0'], [1, '0.2'], [2, '-0.3']]) {
    const picker = page.locator('.picker-field').nth(index)
    await picker.locator('summary').click()
    await picker.locator('.picker-option').first().click()
    await expect(picker.locator('summary .security-badge')).toHaveText(security)
    await page.keyboard.press('Escape')
  }
  await page.getByRole('button', { name: '清空筛选' }).click()
  await expect(page.locator('.filter-value .security-badge')).toHaveCount(0)
  await expect(page.locator('.picker-field summary').nth(1)).toHaveAttribute('aria-disabled', 'true')
})

test('资源摘要带图片和数量，展开可滚动查看并逐个取消', async ({ page }) => {
  await page.goto('/planetary')
  const picker = page.locator('.resource-disclosure')
  await picker.locator('summary').click()
  await expect(picker.locator('.resource-card')).toHaveCount(24)
  for (const card of await picker.locator('.resource-card').all()) await card.click()
  await expect(picker.locator('summary img')).toHaveAttribute('src', TINY_ICON)
  await expect(picker.locator('summary .filter-selection-count')).toHaveText('+23 项')
  await expect(picker.locator('.picker-selected button')).toHaveCount(24)
  const selected = picker.locator('.picker-selected')
  expect(await selected.evaluate(e => e.clientHeight)).toBeLessThanOrEqual(120)
  expect(await selected.evaluate(e => e.scrollHeight > e.clientHeight)).toBeTruthy()
  await selected.getByRole('button', { name: '移除资源-1', exact: true }).click()
  await expect(picker.locator('summary')).toContainText('资源-2')
  await expect(picker.locator('summary .filter-selection-count')).toHaveText('+22 项')
  await page.keyboard.press('Escape')
  await expect(picker.locator('summary')).toBeFocused()
  await expect(picker.locator('.filter-value')).toHaveCSS('height', '42px')
})

test('缺失安等和图标时保留名称，不伪造安等或显示破图', async ({ page }) => {
  await page.route('**/api/regions', route => route.fulfill(json([{ r_id: 1, r_title: '未知安等', r_safetylvl: null }])))
  await page.route('**/api/planetresources', route => route.fulfill(json([{ label: '船菜', options: [{ value: '无图资源', label: '无图资源' }] }])))
  await page.goto('/planetary')
  const region = page.locator('.picker-field').first()
  await region.locator('summary').click()
  await region.locator('.picker-option').click()
  await expect(region.locator('summary')).toContainText('未知安等')
  await expect(region.locator('summary .security-badge')).toHaveCount(0)
  const resource = page.locator('.resource-disclosure')
  await resource.locator('summary').click()
  await resource.locator('.resource-card').click()
  await expect(resource.locator('summary')).toContainText('无图资源')
  await expect(resource.locator('summary img')).toHaveCount(0)
})
