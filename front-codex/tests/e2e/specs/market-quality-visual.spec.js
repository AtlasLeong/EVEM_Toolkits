import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

for (const width of [1440, 390]) {
  test(`static dark quality preview preserves header controls at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 960 })
    await seedAuthenticatedSession(page)
    const now = Date.now()
    const current = new Date(now).toISOString()
    const old = new Date(now - 86400000).toISOString()
    await installApiMock(page, ({ url }) => {
      if (url.pathname === '/api/market/quality/') return json({
        generated_at: current, snapshot_at: current, cache_ttl_seconds: 300, stale_after_seconds: 7200,
        counts: { enabled: 149 },
        observations: Array.from({ length: 149 }, (_, index) => ({ observed_at: index < 86 ? current : old, has_sell: true, has_buy: true })),
        last_observed_at: current, oldest_observed_at: old,
        collector: { status: 'healthy', last_attempt_at: current, last_success_at: current, last_failure_at: null },
      })
      if (url.pathname === '/api/market/categories/') return json([{ id: 'minerals', label: '矿物', count: 1 }])
      if (url.pathname === '/api/market/items/') return json({ count: 1, results: [{
        item_id: '1', name: '质量预览样品', best_sell: '10.00', best_buy: '9.00', observed_at: current,
        status: 'fresh', collection_tier: 'ordinary', collection_target_ms: 21600000,
      }] })
      if (url.pathname.endsWith('/series/')) return json({ count: 0, points: [] })
      return undefined
    })
    await page.goto('/market')
    const quality = page.locator('.market-quality')
    await expect(quality.getByText('新鲜卖价 86 / 149')).toBeVisible()
    await expect(quality.getByText('57.7%')).toBeVisible()
    await expect(quality.locator('summary')).toHaveCount(0)
    await expect(page.getByText('查看说明', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('region', { name: '报价质量说明' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: '采集管理', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '刷新市场价格' })).toBeVisible()
    const styles = await quality.evaluate(el => {
      const probe = document.createElement('div')
      probe.style.backgroundColor = 'var(--console-surface)'
      document.body.append(probe)
      const target = getComputedStyle(probe).backgroundColor
      probe.remove()
      const css = getComputedStyle(el)
      return { background: css.backgroundColor, target, height: el.getBoundingClientRect().height, cursor: css.cursor, tabIndex: el.tabIndex }
    })
    expect(styles.background).toBe(styles.target)
    expect(styles.cursor).not.toBe('pointer')
    expect(styles.tabIndex).toBe(-1)
    expect(styles.height).toBeGreaterThanOrEqual(40)
    expect(await quality.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true)
    await page.locator('.market-terminal-header').screenshot({ path: testInfo.outputPath(`quality-static-${width}-header.png`) })
    await page.screenshot({ path: testInfo.outputPath(`quality-static-${width}.png`), fullPage: true })
  })
}
