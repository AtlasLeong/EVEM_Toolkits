import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('浅色星图浮层的各档安等文字保持可读，画布保持深色', async ({ page }) => {
  const levels = [-0.2, 0.1, 0.3, 0.6, 0.9, 'unknown']
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/boardsystems') return json(levels.map((security_status, i) => ({
      system_id: i + 1, zh_name: `测试星系${i}`, en_name: `TEST-${i}`, x: i * 9.461e15, y: i * 2e15, z: 0, security_status,
    })))
    return json([])
  })
  await page.goto('/starmap')
  await page.getByLabel('搜索并定位星系').fill('测试星系')
  await expect(page.locator('.tactical-search-security')).toHaveCount(6)
  const colors = await page.locator('.tactical-search-security').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color))
  for (const color of colors) {
    const channels = color.match(/\d+/g).slice(0, 3).map(Number).map(v => { const s = v / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 })
    const luminance = channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
    expect(1.05 / (luminance + 0.05), `${color} on white`).toBeGreaterThanOrEqual(4.5)
  }
})

function parseRgb(value) {
  const channels = value.match(/\d+(?:\.\d+)?/g)?.slice(0, 3).map(Number)
  if (!channels || channels.length !== 3) throw new Error(`无法解析颜色: ${value}`)
  return channels.map(channel => {
    const normalized = channel / 255
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4
  })
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = parseRgb(foreground).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const backgroundLuminance = parseRgb(background).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
  const light = Math.max(foregroundLuminance, backgroundLuminance)
  const dark = Math.min(foregroundLuminance, backgroundLuminance)
  return (light + 0.05) / (dark + 0.05)
}

test('浅色表单的提示文字和输入边界保持可读', async ({ page }) => {
  await page.goto('/login')
  const input = page.locator('.auth-section .text-input').first()
  await expect(input).toBeVisible()

  const metrics = await input.evaluate(element => {
    const shell = element.closest('.auth-input-shell') || element
    const placeholder = getComputedStyle(element, '::placeholder')
    const shellStyle = getComputedStyle(shell)
    return {
      placeholderColor: placeholder.color,
      placeholderOpacity: placeholder.opacity,
      surfaceColor: shellStyle.backgroundColor,
      borderColor: shellStyle.borderTopColor,
    }
  })

  expect(metrics.placeholderOpacity).toBe('1')
  expect(contrastRatio(metrics.placeholderColor, metrics.surfaceColor)).toBeGreaterThanOrEqual(4.5)
  expect(contrastRatio(metrics.borderColor, metrics.surfaceColor)).toBeGreaterThanOrEqual(3)
})
