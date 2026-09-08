import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/planetresources') return json([{ label: '船菜', options: [{ value: '光泽合金', label: '光泽合金', icon: TINY_ICON }] }])
    if (url.pathname === '/api/searchplanetresource') return json(Array.from({ length: 30 }, (_, i) => ({
      id: i, resource_name: '光泽合金', region: '伏尔戈', region_security: 0.59,
      constellation: '米沃拉', constellation_security: 0.2, solar_system: '夫斯库仑',
      solar_system_security: 0.22, planet_id: String(i).padStart(2, '0'),
      resource_level: i < 2 ? 4 : 3, resource_yield: 29.74, icon: TINY_ICON,
    })))
    return json([])
  })
  await page.goto('/planetary')
})

test('搜索和清空按钮与四个下拉框上下对齐，展开后不偏移', async ({ page }) => {
  for (const width of [1280, 1487, 1920]) {
    await page.setViewportSize({ width, height: 900 })
    for (const expanded of [false, true]) {
      if (expanded) await page.locator('.resource-disclosure summary').click()
      const fields = await page.locator('.filter-value').all()
      for (const button of await page.locator('.planetary-filters .right-actions button').all()) {
        const action = await button.boundingBox()
        for (const field of fields) {
          const box = await field.boundingBox()
          expect(Math.abs(action.y - box.y), `${width}px top alignment`).toBeLessThanOrEqual(1)
          expect(Math.abs(action.height - box.height), `${width}px height`).toBeLessThanOrEqual(1)
        }
      }
      if (expanded) await page.keyboard.press('Escape')
    }
  }
})

test('下拉框边框加深，同时保留展开强调色', async ({ page }) => {
  const values = page.locator('.filter-value')
  for (const value of await values.all()) await expect(value).toHaveCSS('border-top-color', 'rgb(145, 139, 128)')
  await page.locator('.resource-disclosure summary').click()
  await expect(page.locator('.resource-disclosure .filter-value')).toHaveCSS('border-top-color', 'rgb(166, 83, 62)')
})

test('滚动条出现或消失不改变表格可用宽度，末列与滚动条保持间隔', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.locator('.resource-disclosure summary').click()
  await page.locator('.resource-disclosure').getByRole('button', { name: /光泽合金/ }).click()
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.planetary-table tbody tr')).toHaveCount(30)
  const shell = page.locator('.planetary-results .table-shell')
  await expect(shell).toHaveCSS('scrollbar-gutter', 'stable')
  expect(await shell.evaluate(e => e.scrollHeight > e.clientHeight)).toBeTruthy()
  const before = await shell.evaluate(e => ({ width: e.clientWidth, padding: parseFloat(getComputedStyle(e).paddingRight) }))
  expect(before.padding).toBeGreaterThanOrEqual(12)
  await page.locator('.advanced-filters > summary').click()
  await page.getByLabel('筛选资源等级').selectOption('4')
  await expect(page.locator('.planetary-table tbody tr')).toHaveCount(2)
  expect(await shell.evaluate(e => e.scrollHeight <= e.clientHeight)).toBeTruthy()
  expect(await shell.evaluate(e => e.clientWidth)).toBe(before.width)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
})
