import { test, expect } from '@playwright/test'
import { openFilter } from '../helpers/planetary-ui'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

for (const [status, message] of [[400, '查询结果过多，请缩小地点或资源条件后重试。'], [429, '查询过于频繁，请稍后重试。']]) {
  test(`planetary ${status} is actionable and keeps the last successful rows`, async ({ page }) => {
    if (status === 429) await page.setViewportSize({ width: 390, height: 844 })
    let searches = 0
    await installApiMock(page, async ({ url, method }) => {
      if (method === 'GET' && url.pathname === '/api/planetresources') return json([
        { label: '船菜', options: [{ label: '光泽合金', value: '光泽合金', icon: TINY_ICON }] },
      ])
      if (method === 'GET' && url.pathname === '/api/regions') return json([])
      if (method === 'POST' && url.pathname === '/api/searchplanetresource') {
        searches += 1
        if (searches > 1) return json({ error: message }, status)
        return json([{ key: 'known-planet', resource_name: '光泽合金', region: '已知星域',
          constellation: '已知星座', solar_system: 'KEEP-01', planet_id: 'P1', resource_level: 4,
          resource_yield: '100', icon: TINY_ICON }])
      }
    })
    await page.goto('/planetary')
    await openFilter(page.locator('.resource-disclosure'))
    await page.getByRole('button', { name: '光泽合金' }).click()
    await page.keyboard.press('Escape')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.locator('tbody tr')).toContainText('KEEP-01')
    await page.getByRole('button', { name: '搜索', exact: true }).click()
    await expect(page.getByText(message, { exact: true })).toBeVisible()
    await expect(page.locator('tbody tr')).toContainText('KEEP-01')
    expect(searches).toBe(2)
  })
}
