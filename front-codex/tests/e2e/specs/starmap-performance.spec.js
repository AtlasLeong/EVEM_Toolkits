import { expect, test } from '@playwright/test'
import { installMapData, largeMapData, locateMapSystem, observeMapDrawing, waitForMapIdle } from '../helpers/starmapPerformance'

const systems = [
  { system_id: 1, zh_name: '左下', x: -1, z: -1, security_status: 0.5 },
  { system_id: 2, zh_name: '右上', x: 1, z: 1, security_status: 0.1 },
  { system_id: 3, zh_name: '左上', x: -1, z: 1, security_status: -0.1 },
  { system_id: 4, zh_name: '右下', x: 1, z: -1, security_status: 0.3 },
  { system_id: 5, zh_name: '中心', x: 0, z: 0, security_status: 0.8 },
]
const stargates = [
  { system_id: 1, destination_system_id: 2 },
  { system_id: 2, destination_system_id: 1 },
  { system_id: 1, destination_system_id: 3 },
  { system_id: 3, destination_system_id: 1 },
]

test.beforeEach(async ({ page }) => {
  await observeMapDrawing(page)
})

test('定位缩放不会反复重设画布尺寸，调整窗口仍更新画布', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await waitForMapIdle(page)
  const before = await page.evaluate(() => window.__mapPerf.resizes)
  await locateMapSystem(page, '中心')
  expect(await page.evaluate(() => window.__mapPerf.resizes)).toBe(before)

  await page.setViewportSize({ width: 1200, height: 800 })
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (
    canvas.width === Math.floor(Math.floor(canvas.parentElement.getBoundingClientRect().width) * devicePixelRatio)
  ))).toBe(true)
  expect(await page.evaluate(() => window.__mapPerf.resizes)).toBeGreaterThan(before)
})

test('裁剪屏幕外星点且无向连线只画一次，保留两端都在屏幕外的穿屏连线', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await locateMapSystem(page, '中心')
  const frame = await page.evaluate(() => window.__mapPerf.frames.at(-1))
  expect(frame.arcs).toBe(2) // visible centre: one core and one halo
  expect(frame.lines).toBe(1) // the diagonal crosses the viewport; the left edge does not
  await expect(page.locator('.tactical-map-hud')).toContainText('星门 4')
  await expect(page.locator('.tactical-system-marker.is-selected')).toBeVisible()
})

test('选中星系强调环保持紧凑尺寸，不使用脉冲放大动画', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await locateMapSystem(page, '中心')
  const ring = page.locator('.tactical-system-marker.is-selected .tactical-system-marker-ring')
  await expect(ring).toBeVisible()
  const metrics = await ring.evaluate(node => {
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      animationName: style.animationName,
      borderWidth: parseFloat(style.borderTopWidth),
    }
  })
  expect(metrics.animationName).toBe('none')
  expect(metrics.width).toBeLessThanOrEqual(24)
  expect(metrics.height).toBeLessThanOrEqual(24)
  expect(metrics.borderWidth).toBeLessThanOrEqual(1.5)
})

test('同一帧连续滚轮输入累积倍率并保持指针锚点', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await locateMapSystem(page, '中心')
  const expectedZoom = (7.56 * 0.92 ** 5).toFixed(2)
  const before = await page.locator('.tactical-system-marker.is-selected').evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }))
  const pointer = await page.locator('.tactical-map-viewport').evaluate((node, anchor) => {
    const rect = node.getBoundingClientRect()
    let pointer
    for (let index = 0; index < 5; index += 1) {
      const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: rect.left + anchor.x, clientY: rect.top + anchor.y })
      // MouseEventInit coerces client coordinates to integers; retain the
      // delivered pointer instead of assuming the fractional centre survived.
      pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top }
      node.dispatchEvent(event)
    }
    return pointer
  }, before)
  await expect(page.locator('.tactical-map-hud')).toContainText(`缩放 ${expectedZoom}x`)
  const after = await page.locator('.tactical-system-marker.is-selected').evaluate(node => ({ x: parseFloat(node.style.left), y: parseFloat(node.style.top) }))
  expect(after.x).toBeCloseTo(pointer.x + (before.x - pointer.x) * 0.92 ** 5, 1)
  expect(after.y).toBeCloseTo(pointer.y + (before.y - pointer.y) * 0.92 ** 5, 1)
  await waitForMapIdle(page)
})

test('手动拖动时简化光晕名称，释放后恢复细节并准确选择星系', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await locateMapSystem(page, '中心')
  const viewport = page.locator('.tactical-map-viewport')
  const box = await viewport.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20, { steps: 4 })
  await expect.poll(() => page.evaluate(() => window.__mapPerf.frames.at(-1).arcs)).toBe(1)
  expect(await page.evaluate(() => window.__mapPerf.frames.at(-1).labels)).toBe(0)
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.__mapPerf.frames.at(-1).arcs)).toBe(2)
  await waitForMapIdle(page)
  expect(await page.evaluate(() => window.__mapPerf.frames.at(-1).labels)).toBeGreaterThan(0)
  await page.mouse.click(box.x + box.width / 2 + 40, box.y + box.height / 2 + 20)
  await expect(page.locator('.tactical-system-head strong')).toHaveText('中心')
})

test('大规模星图绘制采样（记录工作量，不将采样耗时等同实际帧率）', async ({ page }, testInfo) => {
  const data = largeMapData()
  await installMapData(page, data.systems, data.stargates)
  await page.goto('/starmap')
  await waitForMapIdle(page)
  const overview = await page.evaluate(() => window.__mapPerf.frames.at(-1))
  await page.evaluate(() => { window.__mapPerf.frames = []; window.__mapPerf.resizes = 0 })
  await locateMapSystem(page, '测试星系-02751')
  const measurement = await page.evaluate(() => {
    const { frames, resizes } = window.__mapPerf
    const durations = frames.map(frame => frame.drawMs).sort((a, b) => a - b)
    return {
      frames: frames.length, resizes,
      totalArcs: frames.reduce((sum, frame) => sum + frame.arcs, 0),
      totalLines: frames.reduce((sum, frame) => sum + frame.lines, 0),
      medianDrawMs: durations[Math.floor(durations.length / 2)],
      p95DrawMs: durations[Math.min(durations.length - 1, Math.floor(durations.length * 0.95))],
      settled: frames.at(-1),
    }
  })
  const report = { systems: data.systems.length, rawGates: data.stargates.length, overview, locate: measurement }
  console.log(`STARMAP_PERF ${JSON.stringify(report)}`)
  await testInfo.attach('starmap-workload.json', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  await expect(page.locator('.tactical-system-head strong')).toHaveText('测试星系-02751')
  await page.screenshot({ path: testInfo.outputPath('starmap-located.png') })
})

test('DPR 改变时更新画布分辨率，后续定位不再重设尺寸', async ({ page, context }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await waitForMapIdle(page)
  const before = await page.evaluate(() => window.__mapPerf.resizes)
  const cssWidth = await page.locator('.tactical-map-viewport').evaluate(node => node.getBoundingClientRect().width)
  const session = await context.newCDPSession(page)
  await session.send('Emulation.setDeviceMetricsOverride', { ...page.viewportSize(), deviceScaleFactor: 2, mobile: false })
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(2)
  expect(await page.locator('.tactical-map-viewport').evaluate(node => node.getBoundingClientRect().width)).toBe(cssWidth)
  await expect.poll(() => page.locator('canvas').evaluate(canvas => (
    canvas.width === Math.floor(canvas.parentElement.getBoundingClientRect().width) * 2
  ))).toBe(true)
  const after = await page.evaluate(() => window.__mapPerf.resizes)
  expect(after).toBeGreaterThan(before)
  await locateMapSystem(page, '中心')
  expect(await page.evaluate(() => window.__mapPerf.resizes)).toBe(after)
})

test('快速缩放后立即离开页面会取消待处理绘制，重返星图仍可定位', async ({ page }) => {
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await locateMapSystem(page, '中心')
  await page.locator('.tactical-map-viewport').evaluate(node => {
    const rect = node.getBoundingClientRect()
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: rect.left + 100, clientY: rect.top + 100 }))
    document.querySelector('a[href="/feedback"]').click()
  })
  await expect(page).toHaveURL(/\/feedback$/)
  await expect(page.locator('canvas')).toHaveCount(0)
  const frames = await page.evaluate(() => window.__mapPerf.frames.length)
  await page.getByRole('link', { name: '星系导航', exact: true }).focus()
  expect(await page.evaluate(() => window.__mapPerf.frames.length)).toBe(frames)
  await page.getByRole('link', { name: '星系导航', exact: true }).click()
  await locateMapSystem(page, '中心')
  expect(errors).toEqual([])
})

test('手动滚轮中断定位动画后不会被旧动画覆盖，仍能重置并再次定位', async ({ page }) => {
  await installMapData(page, systems, stargates)
  await page.goto('/starmap')
  await waitForMapIdle(page)
  await page.getByLabel('搜索并定位星系').fill('中心')
  await page.locator('.tactical-map-search .tactical-search-option').first().click()
  await expect(page.locator('.tactical-system-head strong')).toHaveText('中心')
  await page.locator('.tactical-map-viewport').evaluate(node => {
    const rect = node.getBoundingClientRect()
    node.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 100, clientX: rect.left + 100, clientY: rect.top + 100 }))
  })
  await waitForMapIdle(page)
  const stopped = await page.locator('.tactical-map-hud').innerText()
  expect(stopped).not.toContain('缩放 7.56x')
  // Advance beyond the original animation deadline through actual browser
  // frames; no assertion depends on a particular CPU/frame speed.
  await page.evaluate(() => new Promise(resolve => {
    const end = performance.now() + 900
    const step = () => performance.now() >= end ? resolve() : requestAnimationFrame(step)
    requestAnimationFrame(step)
  }))
  expect(await page.locator('.tactical-map-hud').innerText()).toBe(stopped)
  await page.getByRole('button', { name: '重置视图' }).click()
  await waitForMapIdle(page)
  await locateMapSystem(page, '中心')
})
