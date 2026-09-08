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

test('侧栏头像使用真正透明的白色图像且无底框', async ({ page }) => {
  await installApiMock(page, async () => json([]))
  await page.goto('/planetary')
  const icon = page.locator('.brand-icon')
  await expect(icon).toHaveAttribute('src', '/guristas-avatar-white.png')
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
    let nonWhite = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] === 0) transparent++
      if (data[i + 3] === 255) opaque++
      if (data[i + 3] === 255 && (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255)) nonWhite++
    }
    return { transparent: transparent / (data.length / 4), opaque, nonWhite, cornerAlpha: data[3] }
  })
  expect(pixels.cornerAlpha).toBe(0)
  expect(pixels.transparent).toBeGreaterThan(0.4)
  expect(pixels.transparent).toBeLessThan(0.9)
  expect(pixels.opaque).toBeGreaterThan(100)
  expect(pixels.nonWhite).toBe(0)
})
