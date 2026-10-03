import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('统一深色星图浮层的各档安等文字与实际背景保持可读', async ({ page }) => {
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
  const colors = await page.locator('.tactical-search-security').evaluateAll(nodes => nodes.map(node => {
    let ancestor = node
    while (ancestor) {
      const background = getComputedStyle(ancestor).backgroundColor
      const channels = background.match(/\d+(?:\.\d+)?/g)
      const alpha = channels?.length === 4 ? Number(channels[3]) : 1
      if (alpha > 0) return { foreground: getComputedStyle(node).color, background }
      ancestor = ancestor.parentElement
    }
    throw new Error('星图安等文字缺少可解析的实际背景')
  }))
  for (const { foreground, background } of colors) {
    expect(contrastRatio(foreground, background), `${foreground} on ${background}`).toBeGreaterThanOrEqual(4.5)
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

test('统一深色表单的提示文字和输入边界保持可读', async ({ page }) => {
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
