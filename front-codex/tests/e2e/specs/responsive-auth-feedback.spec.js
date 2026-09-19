import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('登录页在手机端保持卡片和表单可用', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/login')
  const card = page.locator('.login-card')
  await expect(card).toBeVisible()
  const cardBox = await card.boundingBox()
  expect(cardBox.width).toBeLessThanOrEqual(366.6)
  await expect(page.getByRole('tab', { name: '登录', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByLabel('邮箱', { exact: true })).toBeVisible()
  await expect(page.getByLabel('密码', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})

test('反馈页在手机端单列显示并保持提交控件可见', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/feedback/') return json({ can_manage: false, count: 0, results: [] })
    return json([])
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/feedback')
  expect(await page.locator('.feedback-workspace').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(1)
  await expect(page.getByLabel('反馈标题', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '提交反馈', exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
})
