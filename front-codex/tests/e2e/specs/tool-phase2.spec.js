import { expect, test } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'
import { openFilter } from '../helpers/planetary-ui'

// Keep this report identical to console-killboard's original local fixture so
// the loading comparison measures the same content, including missing art.
const report = {
  kill_id: 'console-fixture', ship_name: '夜神级', ship_class_label: '航空母舰',
  victim_name: '测试飞行员', victim_corporation_name: '远航军团',
  system_name: '德里克一', constellation_name: '德里克核心', region_name: '德里克',
  security_status: -.24, isk_lost: '24500000000',
  kill_time_display: '2026-10-03T08:30:00Z', participants: [], items: [],
}

const gate = () => {
  let release
  const promise = new Promise(resolve => { release = resolve })
  return { promise, release }
}

async function capture(page, name, fullPage = true) {
  const backdrop = page.locator('.planetary-calculator-backdrop')
  if (await backdrop.count()) await expect(backdrop).toHaveCSS('opacity','1')
  await page.addStyleTag({ content: '#local-preview-tools { display:none !important; }' })
  await page.evaluate(async () => {
    document.activeElement?.blur()
    window.scrollTo(0, 0)
    await document.fonts.ready
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  })
  await page.mouse.move(0, 0)
  await page.screenshot({ path: `../output/playwright/tool-phase2/${name}.png`, fullPage })
}

async function installKillboardFixture(page, indexGate, detailGate) {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname.endsWith('/access/')) return json({ can_view_killboard: true })
    if (url.pathname.endsWith('/reports/')) {
      await indexGate?.promise
      return json({ count: 1, results: [report] })
    }
    if (url.pathname.endsWith('/reports/console-fixture/')) {
      await detailGate?.promise
      return json(report)
    }
    if (url.pathname.endsWith('/status/')) return json({})
    return undefined
  })
}

for (const width of [320, 390]) {
  test(`KM loading reserves the report structure and controls at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    const indexGate = gate(), detailGate = gate()
    await installKillboardFixture(page, indexGate, detailGate)
    await page.goto('/killboard')
    await expect(page.locator('.kb-main')).toHaveAttribute('aria-busy', 'true')
    await expect(page.locator('.kb-detail-loading')).toHaveText('正在读取报告索引…')
    await expect(page.locator('.kb-hero-loading')).toBeVisible()
    await expect(page.getByRole('tab', { name: '人员', exact: true })).toBeVisible()
    await expect(page.getByText('选择一份报告查看详情')).toHaveCount(0)
    await expect(page.getByText('暂无参战记录')).toHaveCount(0)
    const initialHeader = await page.locator('.kb-header').boundingBox()
    const initialHero = await page.locator('.kb-hero').boundingBox()
    if (width === 390) await capture(page, 'killboard-index-loading-390')
    indexGate.release()
    await expect(page.locator('.kb-hero h2')).toHaveText('夜神级')
    await expect(page.locator('.kb-detail-loading')).toHaveText('正在读取报告详情…')
    const pendingHero = await page.locator('.kb-hero').boundingBox()
    expect(Math.abs(pendingHero.y - initialHero.y)).toBeLessThan(1)
    expect(Math.abs(pendingHero.height - initialHero.height)).toBeLessThan(1)
    if (width === 390) await capture(page, 'killboard-detail-loading-390')
    detailGate.release()
    await expect(page.locator('.kb-main')).toHaveAttribute('aria-busy', 'false')
    await expect(page.locator('.kb-detail-loading')).toHaveText('报告详情已读取')
    const readyHeader = await page.locator('.kb-header').boundingBox()
    const readyHero = await page.locator('.kb-hero').boundingBox()
    expect(Math.abs(readyHeader.height - initialHeader.height)).toBeLessThan(1)
    expect(Math.abs(readyHero.y - pendingHero.y)).toBeLessThan(1)
    expect(Math.abs(readyHero.height - pendingHero.height)).toBeLessThan(1)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.getByRole('tab', { name: '装备', exact: true }).click()
    await expect(page.locator('#kb-panel-equipment')).toBeVisible()
    await expect(page.locator('#kb-panel-people')).toBeHidden()
    if (width === 390) {
      await page.getByRole('tab', { name: '人员', exact: true }).click()
      await capture(page, 'killboard-loaded-390')
    }
  })
}

test('KM immediate original fixture stays below 0.1 local CLS at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.addInitScript(() => {
    window.__kmShifts = []
    new PerformanceObserver(list => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__kmShifts.push({ time: entry.startTime, value: entry.value })
    }).observe({ type: 'layout-shift', buffered: true })
  })
  await installKillboardFixture(page)
  await page.goto('/killboard')
  await expect(page.locator('.kb-detail-loading')).toHaveText('报告详情已读取')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  const cls = await page.evaluate(() => {
    let best = 0, sum = 0, first = 0, last = 0
    for (const shift of window.__kmShifts) {
      if (sum && shift.time - last < 1000 && shift.time - first < 5000) sum += shift.value
      else { sum = shift.value; first = shift.time }
      last = shift.time
      best = Math.max(best, sum)
    }
    return best
  })
  expect(cls, 'local unthrottled fixture metric; not a production field score').toBeLessThan(.1)
})

for (const status of [404, 500]) {
  test(`KM detail ${status} preserves the summary without claiming empty or ready details`, async ({ page }) => {
    await page.setViewportSize({ width:390, height:844 })
    await seedAuthenticatedSession(page, { user_id:23 })
    await installApiMock(page, ({ url }) => {
      if (url.pathname.endsWith('/access/')) return json({ can_view_killboard:true })
      if (url.pathname.endsWith('/reports/')) return json({ count:1, results:[report] })
      if (url.pathname.endsWith('/reports/console-fixture/')) return json({ detail:'Synthetic unavailable detail' }, status)
      if (url.pathname.endsWith('/status/')) return json({})
      return undefined
    })
    await page.goto('/killboard')
    await expect(page.locator('.kb-error')).toContainText('加载失败')
    await expect(page.locator('.kb-hero h2')).toHaveText('夜神级')
    await expect(page.locator('.kb-hero-value')).toContainText('24,500,000,000 ISK')
    await expect(page.locator('.kb-detail-loading')).toHaveText('仅展示报告摘要，详情未读取')
    await expect(page.getByText('暂无参战记录')).toHaveCount(0)
    await expect(page.getByText('参战详情未读取')).toBeVisible()
    await page.getByRole('button', { name:'关闭错误' }).click()
    await expect(page.locator('.kb-detail-loading')).toHaveText('仅展示报告摘要，详情未读取')
    await page.getByRole('tab', { name:'装备', exact:true }).click()
    await expect(page.getByText('装备详情未读取')).toBeVisible()
    await expect(page.getByText('暂无装备记录')).toHaveCount(0)
  })
}

async function openCalculator(page) {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname === '/api/planetresources') return json([{ label: '金属', options: [{ label: '光泽合金', value: '光泽合金', icon: TINY_ICON }] }])
    if (['/api/regions', '/api/constellations', '/api/solarsystem', '/api/planetresourceprice', '/api/programme'].includes(url.pathname)) return json([])
    if (method === 'POST' && url.pathname === '/api/searchplanetresource') return json([{
      resource_name: '光泽合金', resource_type: '金属', region: '德里克', region_security: .5,
      constellation: '德里克核心', constellation_security: .4, solar_system: 'Q-TBHW', solar_system_security: -.8,
      planet_id: 'P1', resource_level: 4, resource_yield: 120, fuel_value: 240, icon: TINY_ICON,
    }])
    return undefined
  })
  await page.goto('/planetary')
  await openFilter(page.locator('.resource-disclosure'))
  await page.getByRole('button', { name: '光泽合金 光泽合金', exact: true }).click()
  await page.locator('.resource-disclosure summary').click()
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await page.locator('tbody .table-check-trigger').first().click()
  await page.getByRole('button', { name: '加入计算器' }).click()
  const modal = page.getByRole('dialog', { name: '行星资源计算器' })
  await expect(modal).toBeVisible()
  return modal
}

for (const width of [320, 390, 768, 1440]) {
  test(`planetary calculator keeps exact values and editable controls reachable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    const modal = await openCalculator(page)
    await expect(page.locator('.planetary-calculator-backdrop')).toHaveCSS('opacity','1')
    await expect(modal.locator('.calculator-stat-card').nth(2).locator('strong')).toHaveText('-18,000')
    await expect(modal.locator('.calculator-table th')).toHaveCount(11)
    const layout = await modal.evaluate(node => {
      const rect = node.getBoundingClientRect()
      return {
        overflow: node.scrollWidth - node.clientWidth, left: rect.left, right: rect.right,
        columns: getComputedStyle(node.querySelector('.calculator-stats')).gridTemplateColumns.split(' ').length,
        values: [...node.querySelectorAll('.calculator-stat-card strong')].map(value => ({ width: value.clientWidth, scroll: value.scrollWidth })),
      }
    })
    expect(layout.left).toBeGreaterThanOrEqual(0)
    expect(layout.right).toBeLessThanOrEqual(width)
    expect(layout.overflow).toBeLessThanOrEqual(1)
    for (const value of layout.values) expect(value.scroll).toBeLessThanOrEqual(value.width + 1)
    if (width <= 640) expect(layout.columns).toBe(2)
    if (width === 320 || width === 390 || width === 1440) await capture(page, `planetary-calculator-${width}`, false)
    const batches = modal.locator('.calculator-batch-grid .field-row')
    for (const [index, value] of ['2', '3', '100'].entries()) {
      await batches.nth(index).getByRole('spinbutton').fill(value)
      await batches.nth(index).getByRole('button', { name: '复制到全部行' }).click()
    }
    const stats = modal.locator('.calculator-stat-card strong')
    await expect(stats.nth(0)).toHaveText('7.20 万 ISK')
    await expect(stats.nth(1)).toHaveText('1,440')
    await expect(stats.nth(2)).toHaveText('-17,520')
    await expect(stats.nth(3)).toHaveText('22 天 22 小时')
    await modal.getByRole('button', { name: '无个堡', exact: true }).click()
    await expect(stats.nth(2)).toHaveText('480')
    const scrollRegion = modal.getByRole('region', { name: '资源计算明细' })
    await scrollRegion.scrollIntoViewIfNeeded()
    await scrollRegion.evaluate(node => { node.scrollLeft = node.scrollWidth })
    await expect(modal.locator('tbody tr').first().getByRole('button', { name: '删除', exact: true })).toBeInViewport()
    if (width === 390) await page.screenshot({ path:'../output/playwright/tool-phase2/planetary-calculator-table-390.png' })
    await modal.getByRole('button', { name: '关闭', exact: true }).click()
    await expect(modal).toHaveCount(0)
  })
}

test('planetary calculator contains keyboard focus and restores an enabled entry on Escape', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 })
  const modal = await openCalculator(page)
  const close = modal.getByRole('button', { name:'关闭', exact:true })
  await expect(close).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(modal.locator('tbody').getByRole('button', { name:'删除', exact:true })).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(close).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(modal).toHaveCount(0)
  await expect(page.getByRole('button', { name:/打开计算器/ })).toBeFocused()
  expect(await page.locator('#root').evaluate(node => node.inert)).toBe(false)
})

test('planetary calculator keeps 200% text inside controls and modal at 320px', async ({ page }) => {
  await page.setViewportSize({ width:320, height:844 })
  const modal = await openCalculator(page)
  await modal.evaluate(node => {
    const text = [...node.querySelectorAll('*')]
      .filter(element => [...element.childNodes].some(child => child.nodeType === Node.TEXT_NODE && child.textContent.trim()) || ['INPUT','SELECT','TEXTAREA'].includes(element.tagName))
      .map(element => { const style=getComputedStyle(element);return { element,font:parseFloat(style.fontSize),line:parseFloat(style.lineHeight) } })
    for (const { element,font,line } of text) {
      if (Number.isFinite(font)) element.style.setProperty('font-size',`${font*2}px`,'important')
      if (Number.isFinite(line)) element.style.setProperty('line-height',`${line*2}px`,'important')
    }
  })
  const bounds = await modal.evaluate(node => {
    const outer=node.getBoundingClientRect()
    return {
      overflow:node.scrollWidth-node.clientWidth,
      buttons:[...node.querySelectorAll('.calculator-segment,.calculator-actions button,.calculator-programme-actions button,.modal-close-btn')].map(button => {
        const rect=button.getBoundingClientRect()
        const range=document.createRange();range.selectNodeContents(button)
        const text=range.getBoundingClientRect()
        return { left:rect.left,right:rect.right,outerLeft:outer.left,outerRight:outer.right,textTop:text.top,textBottom:text.bottom,top:rect.top,bottom:rect.bottom }
      }),
    }
  })
  expect(bounds.overflow).toBeLessThanOrEqual(1)
  for (const button of bounds.buttons) {
    expect(button.left).toBeGreaterThanOrEqual(button.outerLeft)
    expect(button.right).toBeLessThanOrEqual(button.outerRight)
    expect(button.textTop).toBeGreaterThanOrEqual(button.top-1)
    expect(button.textBottom).toBeLessThanOrEqual(button.bottom+1)
  }
  await capture(page,'planetary-calculator-text-200-320',false)
  await modal.getByRole('button',{ name:'关闭',exact:true }).click()
  await expect(modal).toHaveCount(0)
})
