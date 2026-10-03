import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const report = {
  kill_id: '112233445566', ship_name: '夜神级', ship_type_id: '10801000401', ship_class_label: '航空母舰',
  victim_name: '测试飞行员', victim_corporation_name: '远航军团',
  system_name: '德里克一', constellation_name: '德里克核心', region_name: '德里克',
  security_status: -.24, isk_lost: '24500000000', kill_time_display: '2026-10-03T08:30:00Z', participant_count: 1,
  participants: [{ character_id: 'fixture-pilot', character_name: '测试参战飞行员', corporation_name: '远航军团', ship_name: '矮脚鸡级', ship_type_id: '10100000101', damage_done: 1200 }],
  items: [{ type_id: '41000000000', name: '三钛合金', slot: 'cargo', status: 'dropped', quantity_dropped: 1200 }],
}

async function manufacturingFixture(page, fail = () => false) {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/items/') {
      if (fail()) return json({ detail: 'Synthetic refresh failure' }, 503)
      const itemId = url.searchParams.get('q')
      return json({ count: 1, results: [{ item_id: itemId, best_sell: '1200', status: 'fresh', observed_at: '2026-10-03T18:40:00Z' }] })
    }
    return json({})
  })
}

async function killboardFixture(page, detail = report) {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: true })
    if (url.pathname.endsWith('/reports/')) return json({ count: 1, results: url.searchParams.get('q') ? [] : [detail] })
    if (url.pathname.endsWith(`/reports/${detail.kill_id}/`)) return json(detail)
    return json({})
  })
}

async function capture(page, name) {
  await page.addStyleTag({ content: '#local-preview-tools { display:none !important; }' })
  await page.evaluate(async () => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
    await document.fonts.ready
    // Hidden compact panels contain intentionally lazy images. They never load
    // until their tab is opened, so only await artwork in the captured layout.
    await Promise.all([...document.images].filter(image => image.getClientRects().length).map(image => image.decode().catch(() => {})))
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.screenshot({ path: `../output/playwright/tool-refinement/${name}.png`, fullPage: true })
}

for (const width of [320, 390, 768, 1024, 1100, 1179, 1280, 1440]) {
  test(`manufacturing cost feedback stays reachable at ${width}px`, async ({ page }) => {
    await manufacturingFixture(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
    await page.goto('/manufacturing')
    const fullTotal = page.locator('.manufacturing-total-card > strong')
    await expect(fullTotal).toHaveText('99,056,000 ISK')
    const quick = page.getByTestId('manufacturing-mobile-overview')
    if (width < 1100) {
      await expect(quick).toBeVisible()
      const summaryRect = await quick.boundingBox()
      const routeRect = await page.getByTestId('manufacturing-route-workspace').boundingBox()
      expect(summaryRect.y + summaryRect.height).toBeLessThan(routeRect.y)
      await expect(quick.locator('strong')).toHaveText(await fullTotal.textContent())
      await page.getByRole('spinbutton', { name: '制造效率百分比' }).fill('75')
      await expect(quick.locator('strong')).not.toHaveText('99,056,000 ISK')
      await expect(quick.locator('strong')).toHaveText(await fullTotal.textContent())
      await page.getByRole('spinbutton', { name: '制造效率百分比' }).fill('150')
    } else {
      await expect(quick).toBeHidden()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    if (width === 390 || width === 1280 || width === 1440) await capture(page, `manufacturing-${width}`)
  })
}

test('manufacturing refresh failure is next to its action and preserves existing priced result', async ({ page }) => {
  let failRefresh = false
  await manufacturingFixture(page, () => failRefresh)
  await page.goto('/manufacturing')
  const rail = page.getByTestId('manufacturing-cost-rail')
  await expect(rail.locator('.manufacturing-total-card > strong')).toHaveText('99,056,000 ISK')
  failRefresh = true
  await rail.getByRole('button', { name: '刷新购买项行情' }).click()
  await expect(rail.getByRole('status')).toContainText('市场参考价暂时无法读取')
  await expect(rail.locator('.manufacturing-total-card > strong')).toHaveText('99,056,000 ISK')
  await expect(rail.getByRole('button', { name: '刷新购买项行情' })).toBeEnabled()
})

for (const width of [320, 390, 768, 1024, 1280, 1440]) {
  test(`killboard details and full-width compact tabs are reachable at ${width}px`, async ({ page }) => {
    await killboardFixture(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.setViewportSize({ width, height: width === 1280 ? 720 : 900 })
    await page.goto('/killboard')
    const copy = page.getByRole('button', { name: '复制 KM' })
    await expect(copy).toBeVisible()
    if (width < 1100) {
      await expect(page.locator('.shell-main')).toHaveCSS('overflow-y', 'visible')
      await expect(page.locator('.kb-detail-tabs')).toBeVisible()
      const panel = page.locator('.kb-participants-panel')
      const panelRect = await panel.boundingBox()
      const contentRect = await page.locator('.kb-content-grid').boundingBox()
      expect(panelRect.width).toBeCloseTo(contentRect.width, 1)
      await page.getByRole('tab', { name: '装备', exact: true }).click()
      await expect(page.locator('.kb-equipment-panel')).toBeVisible()
      await expect(page.locator('.kb-participants-panel')).toBeHidden()
      await page.locator('.kb-equipment-panel').scrollIntoViewIfNeeded()
      await expect(page.locator('.kb-equipment-panel')).toBeInViewport({ ratio: .95 })
      if (width === 390) await capture(page, 'killboard-equipment-390')
      await page.getByRole('tab', { name: '人员', exact: true }).click()
    }
    await copy.scrollIntoViewIfNeeded()
    await expect(copy).toBeInViewport({ ratio: 1 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.evaluate(() => window.scrollTo(0, 0))
    if (width === 390 || width === 1280 || width === 1440) await capture(page, `killboard-${width}`)
  })
}

for (const width of [320, 390]) test(`mobile report index supports keyboard disclosure and distinguishes an empty search at ${width}px`, async ({ page }) => {
  await killboardFixture(page)
  await page.setViewportSize({ width, height: 900 })
  await page.goto('/killboard')
  const toggle = page.getByRole('button', { name: '筛选 / 切换报告' })
  const search = page.getByRole('searchbox', { name: '搜索击毁报告' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeHidden()
  await toggle.press('Enter')
  await expect(search).toBeVisible()
  await search.fill('无匹配结果')
  await expect(page.locator('.kb-report-list')).toContainText('没有匹配报告')
  await expect(page.locator('.kb-report-list')).not.toContainText('采集器尚未写入')
  await search.fill('')
  const row = page.getByRole('button', { name: /夜神级，德里克一/ })
  await row.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(toggle).toBeFocused()
})

test('report index retains keyboard focus across both 760px disclosure boundaries', async ({ page }) => {
  await killboardFixture(page)
  await page.setViewportSize({ width: 390, height: 900 })
  await page.goto('/killboard')
  const toggle = page.locator('.kb-mobile-index-toggle')
  const search = page.getByRole('searchbox', { name: '搜索击毁报告' })
  const refresh = page.getByRole('button', { name: '刷新', exact: true })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await refresh.focus()
  await page.keyboard.press('Tab')
  await expect(toggle).toBeFocused()
  await page.setViewportSize({ width: 761, height: 900 })
  await expect(toggle).toBeHidden()
  await expect(search).toBeFocused()
  await expect(search).toBeVisible()
  await page.setViewportSize({ width: 760, height: 900 })
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
  await expect(search).toBeVisible()
  await expect(search).toBeFocused()
  await search.press('Shift+Tab')
  await expect(toggle).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await refresh.focus()
  await page.setViewportSize({ width: 761, height: 900 })
  await expect(refresh).toBeFocused()
  await page.setViewportSize({ width: 760, height: 900 })
  await expect(refresh).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeHidden()
})

test('revoked report index retains visible focus when no enabled search remains', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: true })
    if (url.pathname.endsWith('/reports/')) return json({ detail: 'Synthetic access revoked' }, 403)
    return json({})
  })
  await page.setViewportSize({ width: 760, height: 900 })
  await page.goto('/killboard')
  await expect(page.locator('.kb-error.is-forbidden')).toBeVisible()
  const toggle = page.locator('.kb-mobile-index-toggle')
  const content = page.locator('#kb-index-content')
  await expect(page.getByRole('searchbox', { name: '搜索击毁报告', includeHidden: true })).toBeDisabled()
  await toggle.focus()
  await page.setViewportSize({ width: 761, height: 900 })
  await expect(toggle).toBeHidden()
  await expect(content).toBeVisible()
  await expect(content).toBeFocused()
  await expect(page.locator('.kb-report-row')).toHaveCount(0)
})

test('killboard retains long Chinese names and exact large ISK without horizontal overflow', async ({ page }) => {
  const detail = { ...report, ship_name: '测试舰船名称用于检查很长中文在窄屏上的可读性', victim_name: '测试飞行员名称用于检查长中文换行与角色身份', victim_corporation_name: '测试军团名称用于检查很长中文换行', isk_lost: '123456789012345678' }
  await killboardFixture(page, detail)
  await page.setViewportSize({ width: 320, height: 900 })
  await page.goto('/killboard')
  await expect(page.locator('.kb-hero h2')).toHaveText(detail.ship_name)
  await expect(page.locator('.kb-hero-exact')).toHaveText('123,456,789,012,345,678 ISK')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
  await page.getByRole('button', { name: '复制 KM' }).scrollIntoViewIfNeeded()
  await expect(page.getByRole('button', { name: '复制 KM' })).toBeInViewport({ ratio: 1 })
  await page.evaluate(() => document.activeElement?.blur())
  await page.screenshot({ path: '../output/playwright/tool-refinement/killboard-long-content-copy-visible-320.png', fullPage: false })
  await capture(page, 'killboard-long-content-320')
})
