import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async () => json([]))
})

test('行星资源筛选器在手机端按列排列且弹层不超出视口', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  expect(await page.locator('.picker-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  const popover = page.locator('.filter-popover').first()
  if (await popover.count()) {
    const box = await popover.boundingBox()
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(390)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('星图搜索工具在手机端单列显示且页面不横向溢出', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/starmap')
  await expect(page.locator('.tactical-map-panel')).toBeHidden()
  await expect(page.getByRole('heading', { name: '路径条件' })).toBeVisible()
  expect(await page.locator('.route-condition-grid').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  await expect(page.getByRole('button', { name: '计算路径' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
