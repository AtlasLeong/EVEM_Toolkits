import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

const now = Date.parse('2026-10-04T18:00:00Z')
const iso = age => new Date(now - age).toISOString()
const observed = (age, has_sell, has_buy) => ({ observed_at: iso(age), has_sell, has_buy })
function summary(overrides = {}) {
  return {
    generated_at: iso(0), snapshot_at: iso(0), cache_ttl_seconds: 300, stale_after_seconds: 7200,
    counts: { enabled: 6 },
    observations: [observed(0, true, true), observed(7200001, true, true), observed(0, false, true), observed(7200001, false, false), { observed_at: null, has_sell: false, has_buy: false }, observed(0, true, false)],
    last_observed_at: iso(0), oldest_observed_at: iso(7200001),
    collector: { status: 'recovered', last_attempt_at: iso(0), last_success_at: iso(0), last_failure_at: iso(3600000) },
    ...overrides,
  }
}

async function marketMock(page, quality) {
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/quality/') return quality()
    if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{ item_id: '1', name: '质量样品', best_sell: '10.00', best_buy: null, observed_at: iso(0), status: 'fresh' }] })
    if (url.pathname.endsWith('/series/')) return json({ count: 0, points: [] })
    return undefined
  })
}

async function doubleText(page) {
  await page.evaluate(() => {
    // Read original sizes first; never double inherited values twice.
    const records = [...document.querySelectorAll('body *')]
      .filter(el => el.getBoundingClientRect().width && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()))
      .map(el => ({ el, font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }))
    for (const { el, font, line } of records) {
      if (Number.isFinite(font)) el.style.setProperty('font-size', `${font * 2}px`, 'important')
      if (Number.isFinite(line)) el.style.setProperty('line-height', `${line * 2}px`, 'important')
    }
  })
}

async function expectSummaryWithinHeader(quality, width) {
  const metrics = await quality.evaluate(el => {
    const header = el.closest('.market-terminal-header').getBoundingClientRect()
    const actions = el.parentElement.getBoundingClientRect()
    const bounds = el.getBoundingClientRect()
    let left = Math.max(0, header.left, actions.left)
    let right = Math.min(innerWidth, header.right, actions.right)
    for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
      if (getComputedStyle(ancestor).overflowX !== 'visible') {
        const clip = ancestor.getBoundingClientRect()
        left = Math.max(left, clip.left)
        right = Math.min(right, clip.right)
      }
    }
    const texts = []
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(walker.currentNode)
      texts.push(...[...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom })))
    }
    const actionRects = [...el.parentElement.children].map(child => {
      const rect = child.getBoundingClientRect()
      return { left: rect.left, right: rect.right }
    })
    return { left: Math.max(left, bounds.left), right: Math.min(right, bounds.right), top: bounds.top, bottom: bounds.bottom, scroll: el.scrollWidth, width: el.clientWidth, texts, actionRects, visibleLeft: left, visibleRight: right }
  })
  expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1)
  expect(metrics.left).toBeGreaterThanOrEqual(0)
  expect(metrics.right).toBeLessThanOrEqual(width)
  expect(metrics.texts.length).toBeGreaterThan(0)
  for (const rect of metrics.actionRects) {
    expect(rect.left).toBeGreaterThanOrEqual(metrics.visibleLeft - 1)
    expect(rect.right).toBeLessThanOrEqual(metrics.visibleRight + 1)
  }
  for (const rect of metrics.texts) {
    expect(rect.left).toBeGreaterThanOrEqual(metrics.left - 1)
    expect(rect.right).toBeLessThanOrEqual(metrics.right + 1)
    expect(rect.top).toBeGreaterThanOrEqual(metrics.top - 1)
    expect(rect.bottom).toBeLessThanOrEqual(metrics.bottom + 1)
  }
}

test('static quality retains its metrics without a disclosure, action cursor or tab stop', async ({ page }) => {
  await page.clock.install({ time: now })
  await marketMock(page, () => json(summary()))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await expect(quality.getByText('报价质量', { exact: true })).toBeVisible()
  await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
  await expect(quality.getByText('33.3%')).toBeVisible()
  expect(await quality.evaluate(el => el.tagName)).not.toBe('DETAILS')
  await expect(quality).toHaveAttribute('role', 'group')
  await expect(quality).toHaveAccessibleName('报价质量')
  await expect(quality.locator('details, summary, [aria-expanded], button, a, [tabindex]:not([tabindex="-1"])')).toHaveCount(0)
  await expect(page.getByText('查看说明', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('region', { name: '报价质量说明' })).toHaveCount(0)
  await expect(page.locator('.market-quality-body, .market-quality-counts, .market-quality-times')).toHaveCount(0)
  expect(await quality.evaluate(el => el.tabIndex)).toBe(-1)
  expect(await quality.evaluate(el => [el, ...el.querySelectorAll('*')].some(node => getComputedStyle(node).cursor === 'pointer'))).toBe(false)
  const before = await quality.boundingBox()
  await quality.click()
  await page.keyboard.press('Enter')
  await expect(quality).not.toBeFocused()
  await expect(quality).not.toHaveAttribute('open', '')
  await expect(page.locator('.market-quality-body')).toHaveCount(0)
  const after = await quality.boundingBox()
  expect(after.height).toBeCloseTo(before.height, 1)
})

test('dark quality summary reuses console colors and control sizing', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await marketMock(page, () => json(summary()))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
  const style = await quality.evaluate(el => {
    const control = el.parentElement.querySelector('a.market-terminal-action')
    const probe = document.createElement('span')
    el.append(probe)
    const tokenColor = (property, token) => {
      probe.style[property] = `var(${token})`
      return getComputedStyle(probe)[property]
    }
    const expected = {
      surface: tokenColor('backgroundColor', '--console-surface'), text: tokenColor('color', '--console-text'),
      lines: ['--console-line', '--console-line-strong'].map(token => tokenColor('borderTopColor', token)),
      chipBackgrounds: ['--console-raised', '--success-surface', '--accent-surface'].map(token => tokenColor('backgroundColor', token)),
      chipColors: ['--console-text', '--success', '--console-accent'].map(token => tokenColor('color', token)),
    }
    probe.remove()
    const css = getComputedStyle(el)
    const action = getComputedStyle(control)
    const chip = getComputedStyle(el.querySelector('.market-quality-rate'))
    return { expected, background: css.backgroundColor, color: css.color, border: css.borderTopColor, radius: css.borderRadius, height: el.getBoundingClientRect().height, controlBackground: action.backgroundColor, controlColor: action.color, controlRadius: action.borderRadius, chipBackground: chip.backgroundColor, chipColor: chip.color, numberStyle: css.fontVariantNumeric }
  })
  expect(style.background).toBe(style.expected.surface)
  expect(style.background).toBe(style.controlBackground)
  expect(style.color).toBe(style.expected.text)
  expect(style.color).toBe(style.controlColor)
  expect(style.expected.lines).toContain(style.border)
  expect(style.radius).toBe(style.controlRadius)
  expect(style.height).toBeGreaterThanOrEqual(40)
  expect(style.expected.chipBackgrounds).toContain(style.chipBackground)
  expect(style.expected.chipColors).toContain(style.chipColor)
  expect(style.numberStyle).toContain('tabular-nums')
})

for (const width of [320, 375]) {
  test(`signed-in static quality and adjacent actions fit at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 568 })
    await seedAuthenticatedSession(page)
    await marketMock(page, () => json(summary()))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
    await expect(page.getByRole('link', { name: '采集管理' })).toBeVisible()
    await expect(page.getByRole('button', { name: '刷新市场价格' })).toBeVisible()
    const bounds = await quality.boundingBox()
    expect(bounds.width).toBeGreaterThanOrEqual(width - 52)
    await expectSummaryWithinHeader(quality, width)
  })
}

for (const signedIn of [false, true]) {
  test(`static quality text stays within the header at 768px and 200% text (${signedIn ? 'signed in' : 'public'})`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    if (signedIn) await seedAuthenticatedSession(page)
    await marketMock(page, () => json(summary({ counts: { enabled: 149 }, observations: [...Array.from({ length: 147 }, () => observed(0, true, true)), observed(0, false, false), observed(0, false, false)] })))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 147 / 149')).toBeVisible()
    await doubleText(page)
    await expectSummaryWithinHeader(quality, 768)
    await expect(quality.locator('summary')).toHaveCount(0)
  })
}

for (const width of [320, 390, 768, 1440]) {
  test(`four-digit static quality counts fit at ${width}px and 200% text`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.clock.install({ time: now })
    await marketMock(page, () => json(summary({ counts: { enabled: 1000 }, observations: Array.from({ length: 1000 }, () => observed(0, true, true)) })))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 1000 / 1000')).toBeVisible()
    await expect(quality.getByText('100.0%')).toBeVisible()
    await doubleText(page)
    await expectSummaryWithinHeader(quality, width)
    await page.screenshot({ path: testInfo.outputPath(`quality-summary-${width}-200.png`), fullPage: true })
  })
}

test('quality re-ages the cached observation at 30 seconds without fetching upstream or refetching API', async ({ page }) => {
  await page.clock.install({ time: now })
  let reads = 0
  await marketMock(page, () => { reads++; return json(summary({ counts: { enabled: 1 }, observations: [observed(7190000, true, false)] })) })
  await page.goto('/market')
  await expect(page.locator('.market-quality').getByText('新鲜卖价 1 / 1')).toBeVisible()
  await page.clock.runFor(31000)
  await expect(page.locator('.market-quality').getByText('新鲜卖价 0 / 1')).toBeVisible()
  expect(reads).toBe(1)
})

test('quality keeps the two-hour cutoff for old and missing-sell observations', async ({ page }) => {
  await page.clock.install({ time: now })
  let reads = 0
  // Stay ten seconds inside the threshold so network/render time cannot turn
  // an exact-boundary assertion into a timing race. Unit tests cover equality.
  await marketMock(page, () => { reads++; return json(summary({ counts: { enabled: 3 }, observations: [observed(7190000, true, false), observed(7200001, true, false), observed(0, false, true)] })) })
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await expect(quality.getByText('新鲜卖价 1 / 3')).toBeVisible()
  await expect(quality.getByText('33.3%')).toBeVisible()
  await page.clock.runFor(31000)
  await expect(quality.getByText('新鲜卖价 0 / 3')).toBeVisible()
  await expect(quality.getByText('0.0%')).toBeVisible()
  expect(reads).toBe(1)
})

test('clock rollback and navigation remount cannot rejuvenate a cached quote', async ({ page }) => {
  await page.clock.install({ time: now })
  let reads = 0
  await marketMock(page, () => { reads++; return json(summary({ counts: { enabled: 1 }, observations: [observed(7190000, true, false)] })) })
  await page.goto('/market')
  await expect(page.locator('.market-quality').getByText('新鲜卖价 1 / 1')).toBeVisible()
  await page.clock.runFor(31000)
  await expect(page.locator('.market-quality').getByText('新鲜卖价 0 / 1')).toBeVisible()
  await page.clock.setFixedTime(new Date(now - 3600000))
  await page.evaluate(() => { history.pushState({}, '', '/fraudlist'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.locator('.market-quality')).toHaveCount(0)
  await page.evaluate(() => { history.pushState({}, '', '/market'); dispatchEvent(new PopStateEvent('popstate')) })
  await expect(page.locator('.market-quality').getByText('新鲜卖价 0 / 1')).toBeVisible()
  expect(reads).toBe(1)
})

for (const width of [320, 1440]) {
  test(`failed refresh keeps a visible static warning, ageing cached counts and quotes at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await page.clock.install({ time: now })
    await seedAuthenticatedSession(page)
    let fail = false
    await marketMock(page, () => fail ? json({ detail: 'unavailable' }, 503) : json(summary({ counts: { enabled: 1 }, observations: [observed(7190000, true, false)] })))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 1 / 1')).toBeVisible()
    fail = true
    await page.getByRole('button', { name: '刷新市场价格' }).click()
    await expect(quality.getByRole('status')).toHaveText('摘要刷新失败，显示上次记录')
    await expect(quality.getByRole('status')).toBeVisible()
    await expect(quality.getByText('新鲜卖价 1 / 1')).toBeVisible()
    await expect(page.getByRole('heading', { name: '质量样品' })).toBeVisible()
    await expect(page.locator('.market-choice-quote')).toContainText('10')
    await page.clock.runFor(31000)
    await expect(quality.getByText('新鲜卖价 0 / 1')).toBeVisible()
    await expect(quality.getByRole('status')).toBeVisible()
    if (width === 320) await doubleText(page)
    await expectSummaryWithinHeader(quality, width)
    await expect(page.getByText('查看说明', { exact: true })).toHaveCount(0)
  })
}

test('zero enabled items and unavailable summary never imply valid complete coverage', async ({ page }) => {
  let unavailable = false
  await marketMock(page, () => unavailable ? json({}, 503) : json(summary({ counts: { enabled: 0 }, observations: [], last_observed_at: null })))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await expect(quality.getByText('新鲜卖价 0 / 0')).toBeVisible()
  await expect(quality.getByText('暂无采集商品')).toBeVisible()
  await expect(quality.getByText('100.0%')).toHaveCount(0)
  unavailable = true
  await page.reload()
  await expect(page.getByRole('status').filter({ hasText: '报价质量暂不可用' })).toBeVisible()
  await expect(page.locator('.market-quality')).toHaveCount(0)
})

test('first quality read shows a status until real summary data arrives', async ({ page }) => {
  let finishRead
  const pendingRead = new Promise(resolve => { finishRead = resolve })
  await marketMock(page, () => pendingRead)
  try {
    await page.goto('/market')
    await expect(page.getByRole('status').filter({ hasText: '报价质量读取中…' })).toBeVisible()
    await expect(page.locator('.market-quality')).toHaveCount(0)
  } finally {
    finishRead(json(summary()))
  }
  await expect(page.locator('.market-quality').getByText('新鲜卖价 2 / 6')).toBeVisible()
  await expect(page.getByText('报价质量读取中…', { exact: true })).toHaveCount(0)
})
