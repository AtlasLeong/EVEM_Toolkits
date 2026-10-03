import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

const observedAt = '2026-09-26T07:03:47Z'
const labels = ['当前', '区间高', '区间低', '30天高', '30天低']
const modes = ['双边走势', '只看卖价', '只看买价']
const cases = [
  { name: 'decimal', values: ['130.25', '150.75', '110.50', '180.90', '0'], compact: ['130.25', '150.75', '110.5', '180.9', '0'] },
  { name: 'compact', values: ['21897981.37', '123456789.00', '20310000.00', '123456789.00', '20310000.00'], compact: ['2189.8万', '1.23亿', '2031万', '1.23亿', '2031万'] },
  { name: 'missing', values: Array(5).fill(null), compact: Array(5).fill('样本不足') },
  { name: 'maximum', values: Array(5).fill('999999989999999999.99'), compact: Array(5).fill('999999.99万亿') },
]
const viewports = [
  { width: 1440, height: 900 }, { width: 1366, height: 768 },
  { width: 1180, height: 768 }, { width: 1920, height: 1080 },
  { width: 320, height: 740 }, { width: 390, height: 844 },
]

async function openMarket(page, fixture) {
  const entry = value => value === null ? null : { value, observed_at: observedAt }
  const values = fixture.values.map(entry)
  const side = { current: values[0], range: { high: values[1], low: values[2] }, month: { high: values[3], low: values[4] } }
  await installApiMock(page, ({ url }) => {
    if (url.pathname === '/api/market/categories/') return json([{ id: 1, label: '矿物', count: 1 }])
    if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{
      item_id: '1001', name: '三钛合金', category: '矿物', scope: 'global', best_sell: '130.25', best_buy: '100.25',
      observed_at: observedAt, status: 'fresh', sell_prices: ['130.25', '131', '132', '133', '134'], buy_prices: ['100.25', '99', '98', '97', '96'],
    }] })
    if (url.pathname.endsWith('/series/')) return json({
      count: 2, stats: { sell: side, buy: side },
      points: [
        { observed_at: '2026-09-26T06:00:00Z', best_sell: '120.25', best_buy: '90.25' },
        { observed_at: observedAt, best_sell: '130.25', best_buy: '100.25' },
      ],
      change: { best_sell: { absolute: '10', percent: '8.32' }, best_buy: { absolute: '10', percent: '11.08' } },
    })
  })
  await page.goto('/market')
  await expect(page.locator('.market-trend-path--sell')).toBeVisible()
}

async function expectAlignedStatistics(page, fixture) {
  for (const strip of await page.locator('.market-trend-stats').all()) {
    await expect(strip).toHaveAttribute('aria-label', /ISK/)
    expect(await strip.evaluate(element => element.tagName)).toBe('DL')
    await expect(strip.locator('dt')).toHaveText(labels)
    await expect(strip.locator('dd > [aria-hidden="true"]')).toHaveText(fixture.compact)
    const metrics = await strip.locator(':scope > div').evaluateAll(groups => groups.map(group => {
      const dt = group.querySelector('dt')
      const dd = group.querySelector('dd')
      const visible = dd.querySelector('[aria-hidden="true"]')
      return {
        group: group.getBoundingClientRect().toJSON(), dt: dt.getBoundingClientRect().toJSON(), dd: dd.getBoundingClientRect().toJSON(),
        text: visible.getBoundingClientRect().toJSON(), labelFont: parseFloat(getComputedStyle(dt).fontSize),
        valueFont: parseFloat(getComputedStyle(dd).fontSize), scroll: dd.scrollWidth, client: dd.clientWidth,
        title: dd.title, accessible: dd.querySelector('.sr-only').textContent,
      }
    }))
    expect(metrics).toHaveLength(5)
    for (const [index, metric] of metrics.entries()) {
      expect(Math.abs(metric.group.y - metrics[0].group.y), `${labels[index]} must remain in the same row`).toBeLessThanOrEqual(1)
      expect(Math.abs(metric.dt.y - metrics[0].dt.y)).toBeLessThanOrEqual(1)
      expect(Math.abs(metric.dd.y - metrics[0].dd.y)).toBeLessThanOrEqual(1)
      expect(metric.dt.bottom).toBeLessThanOrEqual(metric.dd.top)
      expect(metric.text.left).toBeGreaterThanOrEqual(metric.dd.left - 1)
      expect(metric.text.right).toBeLessThanOrEqual(metric.dd.right + 1)
      expect(metric.scroll).toBeLessThanOrEqual(metric.client + 1)
      expect(metric.labelFont).toBeGreaterThanOrEqual(12)
      expect(metric.valueFont).toBeGreaterThanOrEqual(12)
      const exact = fixture.values[index] === null ? '样本不足' : `${fixture.values[index].replace(/\B(?=(\d{3})+(?!\d))/g, ',')} ISK`
      expect(metric.title).toBe(exact)
      expect(metric.accessible).toBe(exact)
      if (index) expect(metrics[index - 1].group.right).toBeLessThanOrEqual(metric.group.left)
    }
  }
}

async function expectContainedCharts(page, width) {
  const geometry = await page.evaluate(() => {
    const main = document.querySelector('.market-terminal-main')
    const style = getComputedStyle(main)
    return {
      documentWidth: document.documentElement.scrollWidth, mainWidth: main.clientWidth, mainScrollWidth: main.scrollWidth,
      padding: [parseFloat(style.paddingLeft), parseFloat(style.paddingRight)],
      plots: [...document.querySelectorAll('.market-trend-svg-wrap')].map(plot => {
        const svg = plot.querySelector('svg')
        const box = svg.getBoundingClientRect()
        return { height: box.height, width: box.width, viewHeight: svg.viewBox.baseVal.height, viewWidth: svg.viewBox.baseVal.width,
          axes: [...svg.querySelectorAll('.market-trend-axis')].map(axis => axis.getBoundingClientRect().toJSON()), box: box.toJSON() }
      }),
    }
  })
  expect(geometry.documentWidth).toBeLessThanOrEqual(width)
  expect(geometry.mainScrollWidth).toBeLessThanOrEqual(geometry.mainWidth + 1)
  if (width >= 1180) for (const padding of geometry.padding) expect(padding).toBeLessThanOrEqual(16)
  for (const plot of geometry.plots) {
    expect(plot.height).toBeGreaterThanOrEqual(180)
    expect(Math.abs(plot.viewHeight - plot.height)).toBeLessThanOrEqual(1)
    expect(Math.abs(plot.viewWidth - plot.width)).toBeLessThanOrEqual(1)
    expect(plot.axes).toHaveLength(7)
    for (const axis of plot.axes) {
      expect(axis.width).toBeGreaterThan(0)
      expect(axis.height).toBeGreaterThan(0)
      expect(axis.left).toBeGreaterThanOrEqual(plot.box.left - 1)
      expect(axis.right).toBeLessThanOrEqual(plot.box.right + 1)
      expect(axis.top).toBeGreaterThanOrEqual(plot.box.top - 1)
      expect(axis.bottom).toBeLessThanOrEqual(plot.box.bottom + 1)
    }
  }
}

for (const viewport of viewports) {
  for (const fixture of cases) {
    test(`five aligned ${fixture.name} metrics in dual and single modes at ${viewport.width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize(viewport)
      await openMarket(page, fixture)
      for (const mode of modes) {
        await page.getByRole('group', { name: '走势显示方式', exact: true }).getByRole('button', { name: mode, exact: true }).click()
        await expect(page.locator('.market-trend-panel')).toHaveCount(mode === modes[0] ? 2 : 1)
        await expectAlignedStatistics(page, fixture)
        await expectContainedCharts(page, viewport.width)
        await expect(page.locator('.market-trend-panel-count')).toHaveCount(0)
        for (const heading of await page.locator('.market-trend-panel-head').all()) await expect(heading).not.toContainText('次观测')
        await expect(page.locator('.market-legend > span')).toHaveText('2 次观测')
        if (fixture.name === 'compact' && [1920, 390].includes(viewport.width) && mode !== modes[2]) {
          await page.locator('.market-chart-frame').scrollIntoViewIfNeeded()
          await page.screenshot({ path: testInfo.outputPath(`market-stat-strip-${viewport.width}-${mode === modes[0] ? 'dual' : 'single'}.png`), fullPage: true })
        }
      }
    })
  }
}

test('desktop plots reclaim the space from the former second statistics row', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await openMarket(page, cases[0])
  await page.getByRole('button', { name: '双边走势', exact: true }).click()
  // Pre-change baseline at this viewport: 472 x 556px plots and an 89px stats strip.
  // Keep tolerance for subpixel rounding, but fail if freed space becomes a blank gap.
  const panels = await page.locator('.market-trend-panel').evaluateAll(elements => elements.map(panel => ({
    plot: panel.querySelector('.market-trend-svg-wrap').getBoundingClientRect().toJSON(),
    stats: panel.querySelector('.market-trend-stats-viewport').getBoundingClientRect().toJSON(),
  })))
  expect(panels).toHaveLength(2)
  for (const { plot, stats } of panels) {
    expect(stats.height).toBeLessThanOrEqual(76)
    expect(plot.width).toBeGreaterThanOrEqual(490)
    expect(plot.height).toBeGreaterThanOrEqual(600)
    expect(plot.top - stats.bottom).toBeLessThanOrEqual(10)
  }
})

for (const width of [320, 390]) {
  test(`overflowing statistics remain locally keyboard and pointer scrollable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await openMarket(page, cases.find(fixture => fixture.name === 'maximum'))
    const strip = page.locator('.market-trend-stats-viewport').first()
    const hint = page.locator('.market-stats-scroll-hint').first()
    await expect(hint).toBeVisible()
    await expect(hint).toHaveText('左右滑动查看全部统计 · 支持方向键')
    await expect(strip).toHaveAttribute('aria-describedby', await hint.getAttribute('id'))
    await expect(strip).toHaveAttribute('tabindex', '0')
    await expect(strip).toHaveAttribute('role', 'region')
    await expect(strip).toHaveAttribute('aria-label', /卖价.*统计/)
    const overflow = await strip.evaluate(element => ({ scroll: element.scrollWidth, client: element.clientWidth, behavior: getComputedStyle(element).overflowX }))
    expect(overflow.scroll).toBeGreaterThan(overflow.client)
    expect(overflow.behavior).toBe('auto')

    const lastPeriod = page.getByRole('button', { name: '30 天', exact: true })
    await lastPeriod.focus()
    await page.keyboard.press('Tab')
    await expect(strip).toBeFocused()
    const focus = await strip.evaluate(element => ({ width: parseFloat(getComputedStyle(element).outlineWidth), style: getComputedStyle(element).outlineStyle }))
    expect(focus.width).toBeGreaterThanOrEqual(2)
    expect(focus.style).not.toBe('none')
    for (let press = 0; press < 30; press += 1) await page.keyboard.press('ArrowRight')
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBeGreaterThan(overflow.scroll - overflow.client - 2)
    const last = await strip.locator('dd').last().boundingBox()
    const viewport = await strip.boundingBox()
    expect(last.x).toBeGreaterThanOrEqual(viewport.x - 1)
    expect(last.x + last.width).toBeLessThanOrEqual(viewport.x + viewport.width + 1)
    expect(await page.evaluate(() => window.scrollX)).toBe(0)

    // Native horizontal wheel input is contained by the same local viewport.
    await strip.hover()
    await page.mouse.wheel(-1000, 0)
    await expect.poll(() => strip.evaluate(element => element.scrollLeft)).toBe(0)
    const point = page.getByRole('button', { name: '卖价第 1 次观测', exact: true })
    await point.focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('button', { name: '卖价第 2 次观测', exact: true })).toBeFocused()
    expect(await strip.evaluate(element => element.scrollLeft)).toBe(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
  })
}
