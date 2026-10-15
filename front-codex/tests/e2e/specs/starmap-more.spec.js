import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

function installStarMapMock(page, hotspotSnapshot = null, onRequest = () => {}) {
  return installApiMock(page, async ({ url, method, body }) => {
    onRequest(url.pathname)
    if (method === 'GET' && url.pathname === '/api/anomaly-hotspots/' && hotspotSnapshot) {
      return json(hotspotSnapshot)
    }
    if (method === 'GET' && url.pathname === '/api/boardsystems') {
      return json([
        {
          system_id: 1,
          zh_name: '阿尔法',
          en_name: 'ALPHA-1',
          x: 0,
          y: 0,
          z: 0,
          security_status: 0.5,
        },
        {
          system_id: 2,
          zh_name: '贝塔',
          en_name: 'BETA-2',
          x: 9.461e15,
          y: 0,
          z: 0,
          security_status: 0.1,
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/boardregions') {
      return json([{ region_id: 10, zh_name: '德里克' }])
    }
    if (method === 'GET' && url.pathname === '/api/boardconstellations') {
      return json([{ constellation_id: 100, region_id: 10, zh_name: '静寂谷', x: 4.7305e15, y: 0, z: 0 }])
    }
    if (method === 'GET' && url.pathname === '/api/boardstargate') {
      return json([{ system_id: 1, destination_system_id: 2 }])
    }
    if (method === 'POST' && url.pathname === '/api/jumppath') {
      expect(body).toMatchObject({ start_system: '阿尔法', end_system: '贝塔' })
      return json([
        {
          start: { system_id: 1, zh_name: '阿尔法', move_type: '常规跳跃' },
          end: { system_id: 2, zh_name: '贝塔', move_type: '常规跳跃' },
          distance: '1.00',
        },
      ])
    }
  })
}

function leaderboardSnapshot() {
  return {
    version: 1, collected_at_ms: Date.UTC(2026, 9, 13, 15, 5, 2),
    last_attempt_at_ms: Date.UTC(2026, 9, 14, 0, 0, 0), status: 'rate_limited', statistics_window: null,
    systems: Array.from({ length: 125 }, (_, index) => ({
      solar_system_id: index + 1, destroy_num: 1000 - index,
      system_name: index === 124 ? 'Deep-Frontier' : `测试星系 ${index + 1}`,
      region_id: index === 123 ? null : 1000 + index,
      region_name: index === 123 ? null : `区域 ${index + 1}`,
    })),
  }
}

test('犁地热点搜索全榜保留原排名并且不改变地图或发送查询', async ({ page }) => {
  let requests = 0
  await installStarMapMock(page, leaderboardSnapshot(), () => { requests += 1 })
  await page.goto('/starmap')
  const panel = page.locator('.anomaly-hotspots-map-overlay').getByRole('region', { name: '犁地热点排行榜' })
  const rows = panel.locator('.anomaly-hotspots-row')
  await expect(rows).toHaveCount(10)
  const camera = await page.locator('.tactical-map-hud').textContent()
  const originalRequests = requests
  const search = panel.getByRole('searchbox', { name: '榜内搜索' })
  await search.fill('dEeP-fRoNtIeR')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('.anomaly-hotspots-rank')).toHaveText('125')
  await expect(rows.first()).toContainText('Deep-Frontier')
  await expect(panel).toContainText('匹配 1 条')
  await search.fill('125')
  await expect(rows).toHaveCount(1)
  await search.fill('区域 125')
  await expect(rows).toHaveCount(1)
  await panel.getByRole('tab', { name: '星域', exact: true }).click()
  await expect(search).toHaveValue('区域 125')
  await expect(rows).toHaveCount(1)
  await expect(rows.first().locator('.anomaly-hotspots-rank')).toHaveText('124')
  await search.fill('1124')
  await expect(rows).toHaveCount(1)
  await search.fill('找不到这条记录')
  await expect(rows).toHaveCount(0)
  await expect(panel).toContainText('没有匹配的星域')
  await panel.getByRole('button', { name: '清空榜内搜索' }).click()
  await expect(search).toHaveValue('')
  await expect(rows).toHaveCount(10)
  await panel.getByRole('tab', { name: '星系', exact: true }).click()
  await search.fill('测试星系')
  await expect(rows).toHaveCount(100)
  await expect(panel).toContainText('匹配 124 条，仅显示前 100 条')
  const results = panel.locator('.anomaly-hotspots-rows')
  await results.evaluate(element => { element.scrollTop = element.scrollHeight })
  await panel.getByRole('button', { name: '清空榜内搜索' }).click()
  await expect(rows).toHaveCount(10)
  expect(await results.evaluate(element => element.scrollTop)).toBe(0)
  expect(requests).toBe(originalRequests)
  await expect(page.locator('.tactical-map-hud')).toHaveText(camera)
})

for (const width of [768, 800, 1036, 1440, 1920, 390]) {
  test(`犁地热点在 ${width}px 保持时间和控件可见且不重叠`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    await installStarMapMock(page, leaderboardSnapshot())
    await page.goto('/starmap')
    const panel = page.locator(width < 768 ? '.anomaly-hotspots-mobile' : '.anomaly-hotspots-map-overlay')
      .getByRole('region', { name: '犁地热点排行榜' })
    await expect(panel).toBeVisible()
    if (width >= 768) {
      // Exercise the larger selected detail card and the extra distance HUD,
      // not just the compact empty-map hints, at the desktop breakpoint too.
      const viewport = await page.locator('.tactical-map-viewport').boundingBox()
      const locateAndPin = async (name, buttonIndex) => {
        await page.getByLabel('搜索并定位星系').fill(name)
        await page.locator('.tactical-search-option').first().click()
        // A control mousedown intentionally interrupts camera animation.
        // Wait for the actual target first; narrow views can clamp below7.56x.
        const marker = page.locator('.tactical-system-marker.is-selected')
        await expect.poll(() => marker.evaluate(node => parseFloat(node.style.left))).toBeCloseTo(Math.floor(viewport.width) / 2, 1)
        await expect.poll(() => marker.evaluate(node => parseFloat(node.style.top))).toBeCloseTo(Math.floor(viewport.height) / 2, 1)
        await page.locator('.tactical-system-card .ghost-btn').nth(buttonIndex).click()
      }
      await locateAndPin('alpha', 0)
      await locateAndPin('beta', 1)
      await expect(page.locator('.tactical-map-hud')).toContainText('直线 1.00 光年')
      await expect(page.locator('.tactical-system-head strong')).toHaveText('贝塔')
    }
    const updated = panel.locator('.anomaly-hotspots-updated')
    await expect(updated).toContainText('2026/10/13 23:05:02')
    await expect(updated).not.toContainText('2026/10/14')
    const before = await updated.boundingBox()
    await panel.getByRole('searchbox', { name: '榜内搜索' }).fill('测试星系')
    await panel.locator('.anomaly-hotspots-rows').evaluate(element => { element.scrollTop = element.scrollHeight })
    expect(await updated.boundingBox()).toEqual(before)
    const geometry = await panel.evaluate(element => {
      const bounds = node => { const { x, y, width: w, height: h } = node.getBoundingClientRect(); return { x, y, w, h } }
      const parent = bounds(element)
      const rows = element.querySelector('.anomaly-hotspots-rows')
      const controls = ['.anomaly-hotspots-heading', '.anomaly-hotspots-search', '.anomaly-hotspots-tabs', '.anomaly-hotspots-status', '.anomaly-hotspots-footer']
        .map(selector => bounds(element.querySelector(selector)))
      return { parent, controls, row: { ...bounds(rows), clientRight: rows.getBoundingClientRect().left + rows.clientWidth }, scrollable: rows.scrollHeight > rows.clientHeight,
        contentOverflow: getComputedStyle(element.querySelector('.anomaly-hotspots-content')).overflowY,
        columns: [...rows.querySelectorAll('.anomaly-hotspots-row')].map(row => ({
          rank: bounds(row.querySelector('.anomaly-hotspots-rank')),
          name: bounds(row.querySelector('.anomaly-hotspots-name')),
          count: bounds(row.querySelector('.anomaly-hotspots-count')),
        })),
        adjacent: [...document.querySelectorAll('.tactical-map-hud, .tactical-system-card')].map(bounds) }
    })
    for (const item of [...geometry.controls, geometry.row]) {
      expect(item.x).toBeGreaterThanOrEqual(geometry.parent.x)
      expect(item.x + item.w).toBeLessThanOrEqual(geometry.parent.x + geometry.parent.w + 1)
      expect(item.y).toBeGreaterThanOrEqual(geometry.parent.y)
      expect(item.y + item.h).toBeLessThanOrEqual(geometry.parent.y + geometry.parent.h + 1)
    }
    expect(geometry.contentOverflow).toBe('hidden')
    expect(geometry.scrollable).toBe(true)
    for (const columns of geometry.columns) {
      expect(columns.rank.x).toBe(geometry.columns[0].rank.x)
      expect(columns.name.x).toBe(geometry.columns[0].name.x)
      expect(columns.count.x).toBe(geometry.columns[0].count.x)
      expect(columns.count.w).toBe(geometry.columns[0].count.w)
      expect(columns.rank.x + columns.rank.w).toBeLessThan(columns.name.x)
      expect(columns.name.x + columns.name.w).toBeLessThan(columns.count.x)
      expect(geometry.row.clientRight - (columns.count.x + columns.count.w)).toBeGreaterThanOrEqual(10)
    }
    if (width >= 768) {
      for (const item of geometry.adjacent) {
        const overlapX = Math.min(geometry.parent.x + geometry.parent.w, item.x + item.w) - Math.max(geometry.parent.x, item.x)
        const overlapY = Math.min(geometry.parent.y + geometry.parent.h, item.y + item.h) - Math.max(geometry.parent.y, item.y)
        expect(overlapX <= 0 || overlapY <= 0).toBe(true)
      }
      const camera = await page.locator('.tactical-map-hud').textContent()
      await panel.locator('.anomaly-hotspots-rows').hover()
      await page.mouse.wheel(0, 200)
      await expect(page.locator('.tactical-map-hud')).toHaveText(camera)
    } else {
      await expect(panel.getByLabel('显示热圈')).toHaveCount(0)
    }
    await page.screenshot({ path: test.info().outputPath('hotspot-layout.png'), fullPage: true })
    await panel.getByRole('button', { name: '犁地热点', exact: false }).first().click()
    await expect(panel.getByRole('searchbox', { name: '榜内搜索' })).not.toBeVisible()
    await expect(updated).toBeVisible()
  })
}

test('星系导航设置起终点后显示直线距离', async ({ page }) => {
  await installStarMapMock(page)
  await page.goto('/starmap')

  const searchInput = page.getByLabel('搜索并定位星系')
  await searchInput.fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').first().click()

  await searchInput.fill('beta')
  await page.locator('.tactical-search-option').first().click()
  await page.locator('.tactical-system-card .ghost-btn').nth(1).click()

  await expect(page.locator('.tactical-map-hud')).toContainText('直线 1.00 光年')
})

test('定位动画的帧时间早于启动时间时不会出现负缩放或白屏', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window)
    window.requestAnimationFrame = callback => original(timestamp => callback(timestamp - 120))
  })
  await installStarMapMock(page)
  await page.goto('/starmap')
  await page.getByLabel('搜索并定位星系').fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await expect(page.locator('.tactical-map-hud')).toContainText('缩放 7.56x')
  expect(errors).toEqual([])
})

test('星系导航重置视图后缩放不再停留在定位倍率', async ({ page }) => {
  await installStarMapMock(page)
  await page.goto('/starmap')

  const searchInput = page.getByLabel('搜索并定位星系')
  await searchInput.fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await expect(page.locator('.tactical-map-hud')).toContainText('缩放 7.56x')

  await page.getByRole('button', { name: '重置视图' }).click()
  await expect(page.locator('.tactical-map-hud')).not.toContainText('缩放 7.56x')
})
