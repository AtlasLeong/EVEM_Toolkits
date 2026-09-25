import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-density-harness.html')
  await expect(page.locator('.pirate-map__star')).toHaveCount(5000)
})

test('five thousand locations keep DOM markers, labels and cards within the viewport budget', async ({ page }) => {
  const counts = await page.evaluate(() => ({
    markers: document.querySelectorAll('[data-pirate-marker]').length,
    labels: document.querySelectorAll('.pirate-map__label').length,
    cards: document.querySelectorAll('[data-pirate-card]').length,
    markerTabStops: [...document.querySelectorAll('[data-pirate-marker]')].filter(node => node.tabIndex >= 0).length,
  }))
  expect(counts.markers).toBeGreaterThan(0)
  expect(counts.markers).toBeLessThanOrEqual(250)
  expect(counts.labels).toBeGreaterThan(0)
  expect(counts.labels).toBeLessThanOrEqual(200)
  expect(counts.cards).toBeLessThanOrEqual(24)
  expect(counts.markerTabStops).toBeLessThanOrEqual(1)
  await expect(page.locator('.pirate-map__card-summary')).toContainText('列表搜索')
  await expect(page.locator('.pirate-map__card-summary')).toContainText('放大星图')
})

test('five thousand systems with no targets also keep labels bounded', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-density-harness.html?empty=1')
  await expect(page.locator('.pirate-map__star')).toHaveCount(5000)
  expect(await page.locator('[data-pirate-marker]').count()).toBe(0)
  expect(await page.locator('[data-pirate-card]').count()).toBe(0)
  const counts = await page.evaluate(() => ({
    labels: document.querySelectorAll('.pirate-map__label').length,
    total: document.querySelectorAll('*').length,
  }))
  expect(counts.labels).toBeLessThanOrEqual(200)
  expect(counts.total).toBeLessThan(9000)
})

test('zooming a dense real map culls offscreen topology without removing the selected location', async ({ page }) => {
  await page.evaluate(() => window.__pirateDensitySelect(4999))
  const selected = page.locator('[data-pirate-marker="system:5000"]')
  await expect(selected).toHaveCount(1)
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole('button', { name: '放大星图' }).click()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  }
  const counts = await page.evaluate(() => ({
    stars: document.querySelectorAll('.pirate-map__star').length,
    gates: document.querySelectorAll('.pirate-map__gate').length,
  }))
  expect(counts.stars).toBeLessThan(5000)
  expect(counts.gates).toBeLessThan(5950)
  await expect(selected).toHaveCount(1)
})

test('records real-browser zoom cost and DOM size for dense and empty target scenes', async ({ page }) => {
  for (const mode of ['dense', 'empty']) {
    if (mode === 'empty') await page.goto('/tests/tactical-e2e/pirate-density-harness.html?empty=1')
    await expect(page.locator('.pirate-map__star')).toHaveCount(5000)
    const measurement = await page.evaluate(async () => {
      const counts = () => ({ total: document.querySelectorAll('*').length,
        markers: document.querySelectorAll('[data-pirate-marker]').length,
        labels: document.querySelectorAll('.pirate-map__label').length,
        cards: document.querySelectorAll('[data-pirate-card]').length })
      const initial = counts()
      const timings = []
      for (let index = 0; index < 8; index += 1) {
        const label = index % 2 ? '缩小星图' : '放大星图'
        const button = document.querySelector(`[aria-label="${label}"]`)
        const start = performance.now()
        button.click()
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        timings.push(Math.round((performance.now() - start) * 10) / 10)
      }
      timings.sort((a, b) => a - b)
      return { initial, after: counts(), minMs: timings[0], medianMs: (timings[3] + timings[4]) / 2,
        maxMs: timings[7], samplesMs: timings }
    })
    console.log(`pirate-density-browser ${mode} ${JSON.stringify(measurement)}`)
    expect(measurement.after.markers).toBeLessThanOrEqual(250)
    expect(measurement.after.labels).toBeLessThanOrEqual(200)
    expect(measurement.after.cards).toBeLessThanOrEqual(24)
  }
})

test('records real-browser cost with 5000 stars, 5950 gates and 5000 targets', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-density-harness.html?gates=1')
  await expect(page.locator('.pirate-map__star')).toHaveCount(5000)
  await expect(page.locator('.pirate-map__gate')).toHaveCount(5950)
  const measurement = await page.evaluate(async () => {
    const initial = {
      total: document.querySelectorAll('*').length,
      markers: document.querySelectorAll('[data-pirate-marker]').length,
      labels: document.querySelectorAll('.pirate-map__label').length,
      cards: document.querySelectorAll('[data-pirate-card]').length,
    }
    const samplesMs = []
    for (let index = 0; index < 8; index += 1) {
      const label = index % 2 ? '缩小星图' : '放大星图'
      const start = performance.now()
      document.querySelector(`[aria-label="${label}"]`).click()
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      samplesMs.push(Math.round((performance.now() - start) * 10) / 10)
    }
    samplesMs.sort((a, b) => a - b)
    return { initial, minMs: samplesMs[0], medianMs: (samplesMs[3] + samplesMs[4]) / 2,
      maxMs: samplesMs[7], samplesMs }
  })
  console.log(`pirate-density-browser gates ${JSON.stringify(measurement)}`)
  expect(measurement.initial.markers).toBeLessThanOrEqual(250)
  expect(measurement.initial.labels).toBeLessThanOrEqual(200)
  expect(measurement.initial.cards).toBeLessThanOrEqual(24)
})

test('selected location remains rendered and focusable after zoom and pan', async ({ page }) => {
  await page.evaluate(() => window.__pirateDensitySelect(4999))
  const selected = page.locator('[data-pirate-marker="system:5000"]')
  await expect(selected).toHaveCount(1)
  await expect(selected).toHaveClass(/pirate-map__marker--selected/)
  await expect(selected).toHaveAttribute('tabindex', '0')
  await expect(page.locator('[data-pirate-marker]').last()).toHaveAttribute('data-pirate-marker', 'system:5000')
  await page.getByRole('button', { name: '放大星图' }).click()
  await expect(selected).toHaveCount(1)
  await page.locator('.pirate-map__svg').evaluate(svg => {
    const event = (type, clientX) => svg.dispatchEvent(new PointerEvent(type, {
      bubbles: true, pointerId: 7, button: 0, clientX, clientY: 300,
    }))
    event('pointerdown', 400)
    event('pointermove', 430)
    event('pointerup', 430)
  })
  await expect(selected).toHaveCount(1)
  expect(await page.locator('[data-pirate-marker]').count()).toBeLessThanOrEqual(250)
  expect(await page.locator('.pirate-map__label').count()).toBeLessThanOrEqual(200)
})

test('multi-target picker focuses first target and Escape restores focus to its marker', async ({ page }) => {
  await page.evaluate(() => window.__pirateDensitySelect(0))
  const marker = page.locator('[data-pirate-marker="system:1"]')
  await expect(marker).toHaveCount(1)
  await marker.focus()
  await marker.press('Enter')
  const picker = page.getByRole('group', { name: /System 1的目标/ })
  await expect(picker).toBeVisible()
  await expect(picker.getByRole('button').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(marker).toBeFocused()
})

test('minute clock update does not steal focus from the second picker target', async ({ page }) => {
  await page.evaluate(() => window.__pirateDensitySelect(0))
  const marker = page.locator('[data-pirate-marker="system:1"]')
  await marker.focus()
  await marker.press('Enter')
  const picker = page.getByRole('group', { name: /System 1的目标/ })
  const buttons = picker.getByRole('button')
  await expect(buttons.first()).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(buttons.nth(1)).toBeFocused()
  await page.evaluate(() => window.__pirateDensityAdvanceNow())
  await expect(page.locator('[data-density-now]')).toHaveAttribute('data-density-now', String(Date.parse('2026-09-24T12:01:00Z')))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(buttons.nth(1)).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(marker).toBeFocused()
})

test('one system with 5000 targets offers bounded searchable picker and keyboard return', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-density-harness.html?cluster=1')
  const marker = page.locator('[data-pirate-marker="system:1"]')
  await expect(marker).toHaveCount(1)
  await expect(page.locator('[data-pirate-marker]')).toHaveCount(1)
  await marker.focus()
  await marker.press('Enter')
  const picker = page.getByRole('group', { name: /System 1的目标/ })
  const search = picker.getByRole('textbox', { name: '搜索该地点目标' })
  await expect(search).toBeFocused()
  await expect(picker.getByRole('button')).toHaveCount(40)
  await expect(picker).toContainText('共 5001 个目标')
  await expect(picker).toContainText('剩余 4961 个')
  await search.fill('Pilot 4999')
  await expect(picker.getByRole('button')).toHaveCount(1)
  await expect(picker.getByRole('button').first()).toContainText('Pilot 4999')
  await search.press('Tab')
  await expect(picker.getByRole('button').first()).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(picker).toHaveCount(0)
  await expect(marker).toBeFocused()
})

test('minute clock update preserves a searched picker result and its keyboard focus', async ({ page }) => {
  await page.goto('/tests/tactical-e2e/pirate-density-harness.html?cluster=1')
  const marker = page.locator('[data-pirate-marker="system:1"]')
  await marker.focus()
  await marker.press('Enter')
  const picker = page.getByRole('group', { name: /System 1的目标/ })
  const search = picker.getByRole('textbox', { name: '搜索该地点目标' })
  await search.fill('Pilot 4999')
  const result = picker.getByRole('button').first()
  await expect(result).toContainText('Pilot 4999')
  await search.press('Tab')
  await expect(result).toBeFocused()
  await page.evaluate(() => window.__pirateDensityAdvanceNow())
  await expect(page.locator('[data-density-now]')).toHaveAttribute('data-density-now', String(Date.parse('2026-09-24T12:01:00Z')))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await expect(result).toBeFocused()
  await expect(search).toHaveValue('Pilot 4999')
})
