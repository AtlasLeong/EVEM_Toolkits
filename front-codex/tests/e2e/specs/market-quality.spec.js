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

test('quality explains global denominator and overlapping missing/stale books on desktop and phone', async ({ page }) => {
  await page.clock.install({ time: now })
  await marketMock(page, () => json(summary()))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
  await expect(quality.getByText('33.3%')).toBeVisible()
  await quality.locator('summary').click()
  await expect(quality.getByText(/采集已恢复/)).toBeVisible()
  await expect(quality.getByText(/与当前搜索、分类及分页无关/)).toBeVisible()
  await expect(quality.locator('.market-quality-counts > div').filter({ hasText: '缺卖盘' }).locator('dd')).toHaveText('2')
  await expect(quality.locator('.market-quality-counts > div').filter({ hasText: '双向空盘' }).locator('dd')).toHaveText('1')
  await expect(quality.locator('.market-quality-counts > div').filter({ hasText: '尚未采集' }).locator('dd')).toHaveText('1')
  await expect(quality.getByText(/缺价不会作为 0 ISK/)).toBeVisible()
  await page.setViewportSize({ width: 375, height: 812 })
  await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
  expect(await quality.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBeTruthy()
  const body = await quality.locator('.market-quality-body').boundingBox()
  expect(body.x).toBeGreaterThanOrEqual(0)
  expect(body.x + body.width).toBeLessThanOrEqual(375)
  await quality.getByRole('region', { name: '报价质量说明' }).focus()
  await page.keyboard.press('Escape')
  await expect(quality).not.toHaveAttribute('open', '')
  await expect(quality.locator('summary')).toBeFocused()
})

for (const width of [320, 375]) {
  test(`signed-in quality details remain readable and scrollable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 568 })
    await seedAuthenticatedSession(page)
    await marketMock(page, () => json(summary()))
    await page.goto('/market')
    await page.locator('.market-quality summary').click()
    const body = page.getByRole('region', { name: '报价质量说明' })
    await expect(body).toBeVisible()
    const metrics = await body.evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right }))
    expect(metrics.width).toBeGreaterThanOrEqual(width - 52)
    expect(metrics.scroll).toBeLessThanOrEqual(metrics.width + 1)
    expect(metrics.left).toBeGreaterThanOrEqual(0)
    expect(metrics.right).toBeLessThanOrEqual(width)
    const actions = await page.locator('.market-header-actions').evaluate(el => [...el.children].map(child => ({ left: child.getBoundingClientRect().left, right: child.getBoundingClientRect().right })))
    for (const action of actions) {
      expect(action.left).toBeGreaterThanOrEqual(0)
      expect(action.right).toBeLessThanOrEqual(width)
    }
  })
}

for (const signedIn of [false, true]) {
  test(`quality summary text and disclosure remain within the header at 768px and 200% text (${signedIn ? 'signed in' : 'public'})`, async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 })
    if (signedIn) await seedAuthenticatedSession(page)
    await marketMock(page, () => json(summary({ counts: { enabled: 149 }, observations: [...Array.from({ length: 147 }, () => observed(0, true, true)), observed(0, false, false), observed(0, false, false)] })))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 147 / 149')).toBeVisible()
    await page.evaluate(() => {
      // Text-only pressure, matching the existing accessibility regressions.
      const fonts = [...document.querySelectorAll('body *')].map(el => [el, parseFloat(getComputedStyle(el).fontSize)])
      for (const [el, size] of fonts) el.style.setProperty('font-size', `${size * 2}px`, 'important')
    })
    const metrics = await quality.evaluate(el => {
      const summary = el.querySelector('summary')
      const header = el.closest('.market-terminal-header').getBoundingClientRect()
      const actions = el.parentElement.getBoundingClientRect()
      const bounds = summary.getBoundingClientRect()
      let left = Math.max(header.left, actions.left)
      let right = Math.min(header.right, actions.right)
      for (let ancestor = el.parentElement; ancestor; ancestor = ancestor.parentElement) {
        if (getComputedStyle(ancestor).overflowX !== 'visible') {
          const clip = ancestor.getBoundingClientRect()
          left = Math.max(left, clip.left)
          right = Math.min(right, clip.right)
        }
      }
      const texts = [...summary.children].flatMap(child => {
        const range = document.createRange()
        range.selectNodeContents(child)
        return [...range.getClientRects()].map(rect => ({ left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }))
      })
      const actionRects = [...el.parentElement.children].map(child => {
        const rect = child.getBoundingClientRect()
        return { left: rect.left, right: rect.right }
      })
      return { left: Math.max(left, bounds.left), right: Math.min(right, bounds.right), top: bounds.top, bottom: bounds.bottom, texts, actionRects, visibleLeft: left, visibleRight: right }
    })
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
    const disclosure = quality.locator('.market-quality-disclosure')
    const box = await disclosure.boundingBox()
    expect(await disclosure.evaluate(el => {
      const rect = el.getBoundingClientRect()
      return el.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })).toBeTruthy()
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
    await expect(quality).toHaveAttribute('open', '')
    await page.keyboard.press('Escape')
    await expect(quality).not.toHaveAttribute('open', '')
    await expect(quality.locator('summary')).toBeFocused()
  })
}

test('collector acquisition time explicitly describes a recorded completed run, separately from newer observations', async ({ page }) => {
  let completedAt = iso(3600000)
  await marketMock(page, () => json(summary({ collector: { status: 'collecting', last_attempt_at: iso(0), last_success_at: completedAt } })))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await quality.locator('summary').click()
  const completed = quality.locator('.market-quality-times > div').filter({ hasText: '最近采集结束（有数据）' }).locator('dd')
  const expected = await page.evaluate(value => new Date(value).toLocaleString('zh-CN', { hour12: false }), completedAt)
  await expect(completed).toHaveText(expected)
  await expect(quality.getByText(/只统计已结束且有成功记录的运行，显示其结束时间/)).toBeVisible()
  await expect(quality.getByText(/进行中或未记入结束统计的采集不会更新此时间/)).toBeVisible()
  completedAt = null
  await page.reload()
  await quality.locator('summary').click()
  await expect(completed).toHaveText('尚无记录')
  await expect(quality.locator('.market-quality-times > div').filter({ hasText: '最新采集记录' }).locator('dd')).not.toHaveText('尚无记录')
})

for (const width of [320, 390, 768, 1440]) {
  test(`four-digit quality counts stay inside their own cards at ${width}px and 200% text`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await page.clock.install({ time: now })
    await marketMock(page, () => json(summary({ counts: { enabled: 1000 }, observations: Array.from({ length: 1000 }, () => observed(0, true, true)) })))
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await quality.locator('summary').click()
    await page.evaluate(() => {
      const records = [...document.querySelectorAll('body *')]
        .filter(el => el.getBoundingClientRect().width && [...el.childNodes].some(node => node.nodeType === 3 && node.textContent.trim()))
        .map(el => ({ el, font: parseFloat(getComputedStyle(el).fontSize), line: parseFloat(getComputedStyle(el).lineHeight) }))
      for (const { el, font, line } of records) {
        if (Number.isFinite(font)) el.style.setProperty('font-size', `${font * 2}px`, 'important')
        if (Number.isFinite(line)) el.style.setProperty('line-height', `${line * 2}px`, 'important')
      }
    })
    const cards = await quality.locator('.market-quality-counts > div').evaluateAll(elements => elements.map(el => {
      const range = document.createRange()
      range.selectNodeContents(el.querySelector('dd'))
      return { card: el.getBoundingClientRect().toJSON(), text: range.getBoundingClientRect().toJSON() }
    }))
    for (const { card, text } of cards) {
      expect(text.left).toBeGreaterThanOrEqual(card.left - 1)
      expect(text.right).toBeLessThanOrEqual(card.right + 1)
      expect(text.top).toBeGreaterThanOrEqual(card.top - 1)
      expect(text.bottom).toBeLessThanOrEqual(card.bottom + 1)
    }
    expect(await quality.locator('.market-quality-body').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath(`quality-counts-${width}-200.png`), fullPage: true })
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

test('failed refresh retains labelled previous summary and leaves quotes intact', async ({ page }) => {
  let fail = false
  await marketMock(page, () => fail ? json({ detail: 'unavailable' }, 503) : json(summary({ collector: { status: 'failed' } })))
  await page.goto('/market')
  const quality = page.locator('.market-quality')
  await quality.locator('summary').click()
  await expect(quality.getByText(/最近采集失败/)).toBeVisible()
  fail = true
  await page.getByRole('button', { name: '刷新市场价格' }).click()
  await expect(quality.getByText(/摘要刷新失败/)).toBeVisible()
  await expect(quality.getByText('新鲜卖价 2 / 6')).toBeVisible()
  await expect(page.getByRole('heading', { name: '质量样品' })).toBeVisible()
})

test('zero enabled items and unavailable summary never imply valid complete coverage', async ({ page }) => {
  let unavailable = false
  await marketMock(page, () => unavailable ? json({}, 503) : json(summary({ counts: { enabled: 0 }, observations: [], last_observed_at: null })))
  await page.goto('/market')
  await expect(page.locator('.market-quality').getByText('暂无采集商品')).toBeVisible()
  await page.locator('.market-quality summary').click()
  await expect(page.locator('.market-quality').getByText('最后采集 尚无成功采集')).toBeVisible()
  unavailable = true
  await page.reload()
  await expect(page.getByText('报价质量暂不可用')).toBeVisible()
})
