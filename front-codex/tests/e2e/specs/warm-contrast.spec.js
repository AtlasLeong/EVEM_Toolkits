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
