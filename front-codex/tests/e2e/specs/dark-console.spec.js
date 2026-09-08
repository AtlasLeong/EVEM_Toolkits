import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async () => json([]))
})

test('深空导航使用深色底和可读的青色登录按钮', async ({ page }) => {
  await page.goto('/infocenter')
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 17, 23)')
  await expect(page.locator('.shell-sidebar')).toHaveCSS('background-color', 'rgb(13, 20, 27)')
  const login = page.getByRole('button', { name: '登录 \\ 注册' })
  await expect(login).toHaveCSS('background-color', 'rgb(24, 191, 220)')
  await expect(login).toHaveCSS('color', 'rgb(7, 21, 29)')
})

for (const width of [1280, 1440, 1920]) {
  test(`${width}px 下侧栏与内容互不遮挡且页面无横向溢出`, async ({ page }) => {
    await page.setViewportSize({ width, height: 960 })
    for (const route of ['/infocenter', '/fraudlist', '/planetary', '/starmap']) {
      await page.goto(route)
      const sidebar = page.locator('.shell-sidebar')
      await expect(sidebar).toBeVisible()
      const sidebarBox = await sidebar.boundingBox()
      const mainBox = await page.getByRole('main').boundingBox()
      expect(sidebarBox.x).toBe(0)
      expect(sidebarBox.width).toBe(216)
      expect(mainBox.x).toBeGreaterThanOrEqual(sidebarBox.x + sidebarBox.width)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true)
    }
  })
}

test('品牌链接支持键盘并保持当前导航和备案链接', async ({ page }) => {
  await page.goto('/planetary')
  await expect(page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '行星资源' })).toHaveAttribute('aria-current', 'page')
  const brand = page.getByRole('link', { name: 'EVEMToolkit 首页' })
  await brand.focus()
  await expect(brand).toHaveCSS('outline-style', 'solid')
  await expect(brand).toHaveCSS('outline-width', '2px')
  await page.keyboard.press('Enter')
  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.getByRole('link', { name: '粤ICP备2024264329号' })).toHaveAttribute('href', 'https://beian.miit.gov.cn/')
})

test('窄屏保留桌面使用提示和备案页脚', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 800 })
  await page.goto('/planetary')
  await expect(page.locator('.desktop-only-mask')).toBeVisible()
  await expect(page.locator('.shell-sidebar')).not.toBeVisible()
  await expect(page.getByRole('link', { name: '粤ICP备2024264329号' })).toBeVisible()
  await expect(page.locator('.site-footer')).toHaveCSS('margin-left', '0px')
})

test('低高度登录态侧栏的设置和退出均可滚动访问', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  await page.setViewportSize({ width: 1280, height: 400 })
  await page.goto('/infocenter')
  const footerBox = await page.locator('.site-footer').boundingBox()
  expect(footerBox.x).toBe(216)
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page).toHaveURL(/\/usersetting$/)
  await page.getByRole('button', { name: '退出', exact: true }).click()
  await expect(page).toHaveURL(/\/login$/)
})
