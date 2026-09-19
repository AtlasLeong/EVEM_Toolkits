import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('顶栏导航高亮正确且点击 Logo 返回防诈名单', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([])
    }
  })

  await page.goto('/planetary')

  await expect(page.locator('.nav-item.active')).toContainText('行星资源')
  await page.locator('.brand').click()
  await expect(page).toHaveURL(/\/fraudlist$/)
  await expect(page.locator('.nav-item.active')).toContainText('防诈名单')
})

test('侧栏使用实心透明罗盘与 EVEM 字标并保留冰蓝指针', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.goto('/planetary')
  const icon = page.locator('.brand-icon')
  await expect(icon).toHaveAttribute('src', '/evem-compass-solid.png')
  await expect(page.locator('.brand-name')).toHaveText('EVEM')
  await expect(page.getByText('星际工具', { exact: true })).toHaveCount(0)
  await expect(icon).toHaveCSS('filter', 'none')
  await expect(icon).toHaveCSS('width', '36px')
  await expect(icon).toHaveCSS('height', '36px')
  await expect(icon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(icon).toHaveCSS('padding', '0px')
  await expect(icon).toHaveJSProperty('complete', true)
  const pixels = await icon.evaluate(async img => {
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height)
    let transparent = 0
    let opaque = 0
    let dark = 0
    let cyan = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++
      if (data[i + 3] > 240) {
        opaque++
        if (data[i] < 80 && data[i + 1] < 80 && data[i + 2] < 80) dark++
        if (data[i + 1] > data[i] + 30 && data[i + 2] > data[i] + 30) cyan++
      }
    }
    // Check an area, not just one pixel, so the old hollow/slender center cannot pass.
    const centerSize = Math.floor(canvas.width * 0.12)
    const center = ctx.getImageData(Math.floor((canvas.width - centerSize) / 2), Math.floor((canvas.height - centerSize) / 2), centerSize, centerSize).data
    let filledCenter = 0
    for (let i = 0; i < center.length; i += 4) {
      if (center[i + 3] > 240 && center[i] < 80 && center[i + 1] < 80 && center[i + 2] < 80) filledCenter++
    }
    return { transparent: transparent / (data.length / 4), opaque, dark, cyan, cornerAlpha: data[3], square: img.naturalWidth === img.naturalHeight, filledCenter: filledCenter / (center.length / 4) }
  })
  expect(pixels.cornerAlpha).toBe(0)
  expect(pixels.transparent).toBeGreaterThan(0.4)
  expect(pixels.transparent).toBeLessThan(0.9)
  expect(pixels.opaque).toBeGreaterThan(100)
  expect(pixels.dark).toBeGreaterThan(100)
  expect(pixels.cyan).toBeGreaterThan(100)
  expect(pixels.square).toBe(true)
  expect(pixels.filledCenter).toBeGreaterThan(0.9)
  await page.getByRole('button', { name: '收起导航' }).click()
  await expect(icon).toBeVisible()
  // Collapsed labels remain available to assistive technology via visually-hidden CSS.
  await expect(page.locator('.brand-name')).toHaveCSS('clip-path', 'inset(50%)')
  await expect(page.locator('.brand-name')).toHaveCSS('width', '1px')
  await expect(page.locator('.brand')).toHaveAccessibleName('EVEMToolkit 首页')
  await page.locator('.brand').click()
  await expect(page).toHaveURL(/\/fraudlist$/)
})

test('浏览器与触屏收藏图标统一使用可加载的罗盘 PNG', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.goto('/planetary')
  const icons = page.locator('link[rel~="icon"], link[rel="apple-touch-icon"]')
  await expect(icons).toHaveCount(2)
  for (const icon of await icons.all()) {
    await expect(icon).toHaveAttribute('href', await page.locator('.brand-icon').getAttribute('src'))
    const response = await page.request.get(await icon.getAttribute('href'))
    expect(response.ok()).toBe(true)
    expect(response.headers()['content-type']).toContain('image/png')
  }
})
