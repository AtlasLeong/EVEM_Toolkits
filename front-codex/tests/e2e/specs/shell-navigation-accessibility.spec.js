import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async () => json([]))
})

test('键盘可以跳过分组导航直接进入主内容', async ({ page }) => {
  await page.goto('/planetary')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  for (const name of ['市场与工业', '星际行动', '社区情报']) {
    await expect(navigation.getByRole('group', { name, exact: true })).toBeVisible()
  }
  await expect(navigation.getByRole('link', { name: '击毁情报', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('link', { name: '战术板概况', exact: true })).toHaveCount(0)
})

test('移动导航 Escape 关闭并返回开关焦点，换页聚焦主内容', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  const toggle = page.locator('.mobile-menu-toggle')
  await toggle.click()
  const mobileNavigation = page.getByRole('navigation', { name: '移动主导航' })
  await mobileNavigation.getByRole('link', { name: '市场价格', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(mobileNavigation).toBeHidden()
  await toggle.click()
  await mobileNavigation.getByRole('link', { name: '需求与反馈', exact: true }).click()
  await expect(page).toHaveURL(/\/feedback$/)
  await expect(mobileNavigation).toBeHidden()
  await expect(page.locator('#main-content')).toBeFocused()
})

test('移动导航在调整到桌面宽度时关闭并保留可见焦点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  await page.locator('.mobile-menu-toggle').click()
  await page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '市场价格', exact: true }).focus()
  await page.setViewportSize({ width: 1180, height: 960 })
  await expect(page.locator('.mobile-nav')).toBeHidden()
  await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page.locator('.shell-sidebar')).toBeVisible()
})

test('击毁详情保持所属导航高亮，采集后台只有一个当前导航', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/killboard/access/') return json({ can_view_killboard: true })
    if (url.pathname === '/api/killboard/reports/') return json({ count: 0, results: [] })
    if (url.pathname === '/api/killboard/reports/19748417/') return json({ kill_id: '19748417', ship_name: '回归样本', participants: [], items: [] })
    return json({})
  })
  await page.goto('/killboard/19748417')
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  const killboard = navigation.getByRole('link', { name: '击毁情报', exact: true })
  const collector = navigation.getByRole('link', { name: '击毁采集后台', exact: true })
  await expect(killboard).toHaveAttribute('aria-current', 'page')
  await expect(killboard).toHaveClass(/active/)
  await expect(collector).not.toHaveAttribute('aria-current')
  await collector.click()
  await expect(page).toHaveURL(/\/killboard\/admin$/)
  await expect(collector).toHaveAttribute('aria-current', 'page')
  await expect(killboard).not.toHaveAttribute('aria-current')
  await expect(killboard).not.toHaveClass(/active/)
})

test('显示密度默认紧凑，切换后跨页面与刷新保持偏好', async ({ page }) => {
  await page.goto('/planetary')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'compact')
  const density = page.locator('.shell-sidebar').getByRole('group', { name: '显示密度' })
  await expect(density.getByRole('button', { name: '紧凑', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await density.getByRole('button', { name: '舒适', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await expect(density.getByRole('button', { name: '紧凑', exact: true })).toHaveAttribute('aria-pressed', 'false')
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '防诈名单', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await page.reload()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await expect(density.getByRole('button', { name: '舒适', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

test('本地存储不可用时密度和折叠操作仍然可用', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem
    const originalSet = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('evem-')) throw new DOMException('Blocked preference storage', 'SecurityError')
      return originalGet.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('evem-')) throw new DOMException('Blocked preference storage', 'SecurityError')
      return originalSet.call(this, key, value)
    }
  })
  await page.goto('/planetary')
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'compact')
  const density = page.locator('.shell-sidebar').getByRole('group', { name: '显示密度' })
  await density.getByRole('button', { name: '舒适', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-collapsed/)
  await page.getByRole('button', { name: '展开导航', exact: true }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-collapsed/)
})

test('移动导航提供同一个显示密度设置', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  await page.locator('.mobile-menu-toggle').click()
  const density = page.getByRole('navigation', { name: '移动主导航' }).getByRole('group', { name: '显示密度' })
  await density.getByRole('button', { name: '舒适', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await expect(density.getByRole('button', { name: '舒适', exact: true })).toHaveAttribute('aria-pressed', 'true')
})
