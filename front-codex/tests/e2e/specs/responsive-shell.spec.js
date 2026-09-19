import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async () => json([]))
})

for (const width of [390, 768]) {
  test(`${width}px 响应式壳层保持导航可用且页面不横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
    await page.goto('/planetary')

    await expect(page.locator('.desktop-only-mask')).toBeHidden()
    await expect(page.locator('.mobile-shell-header')).toBeVisible()
    await expect(page.locator('.mobile-menu-toggle')).toBeVisible()
    await expect(page.locator('.shell-sidebar')).toBeHidden()
    await expect(page.locator('.mobile-brand-name')).toHaveText('EVEM')
    const brandIcon = page.locator('.mobile-brand-icon')
    await expect(brandIcon).toHaveAttribute('src', '/evem-compass-solid.png')
    await expect(brandIcon).toHaveCSS('filter', 'none')
    await expect(brandIcon).toHaveCSS('width', '32px')
    await expect(brandIcon).toHaveCSS('height', '32px')
    await brandIcon.evaluate(img => img.decode())
    await expect(brandIcon).toHaveJSProperty('complete', true)
    await expect(page.getByText('星际工具', { exact: true })).toHaveCount(0)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)

    await page.getByRole('button', { name: '打开导航' }).click()
    await expect(page.locator('.mobile-nav')).toBeVisible()
    await expect(page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '星系导航' })).toBeVisible()
    await expect(page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '星系导航' })).toHaveCSS('min-height', '44px')
  })
}

test('移动导航切换时同步 aria-expanded 并可进入反馈页', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  const toggle = page.getByRole('button', { name: '打开导航' })
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await toggle.click()
  await expect(page.getByRole('button', { name: '关闭导航' })).toHaveAttribute('aria-expanded', 'true')
  await page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '需求与反馈' }).click()
  await expect(page).toHaveURL(/\/feedback$/)
  await expect(page.locator('.mobile-nav')).toBeHidden()
})
