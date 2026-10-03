import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

// Deliberate text-only pressure simulation; this is not native browser zoom.
async function doubleText(page) {
  await page.evaluate(() => {
    // Restore previous pressure before measuring newly mounted mode fields.
    window.__evemTextPressureStyles ||= new Map()
    for (const [element, [value, priority]] of window.__evemTextPressureStyles) {
      if (value) element.style.setProperty('font-size', value, priority)
      else element.style.removeProperty('font-size')
    }
    window.__evemTextPressureStyles.clear()
    const sizes = [...document.querySelectorAll('body *')].map(element => [element, parseFloat(getComputedStyle(element).fontSize)])
    for (const [element, size] of sizes) {
      window.__evemTextPressureStyles.set(element, [element.style.getPropertyValue('font-size'), element.style.getPropertyPriority('font-size')])
      element.style.setProperty('font-size', `${size * 2}px`, 'important')
    }
  })
}

async function textFitsControl(locator) {
  const result = await locator.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element.querySelector('span') || element)
    const control = element.getBoundingClientRect()
    return [...range.getClientRects()].every(rect => rect.top >= control.top - 1 && rect.bottom <= control.bottom + 1 && rect.left >= control.left - 1 && rect.right <= control.right + 1)
  })
  expect(result).toBe(true)
}

test('390px login tabs retain their complete text and hit areas at doubled text size', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await installApiMock(page, () => json({}))
  await page.goto('/login')
  const tabs = page.getByRole('tablist', { name: '认证模式' })
  await expect(tabs).toBeVisible()
  await doubleText(page)
  for (const tab of await tabs.getByRole('tab').all()) await textFitsControl(tab)
  const reset = tabs.getByRole('tab', { name: '找回密码', exact: true })
  const box = await reset.boundingBox()
  await reset.click({ position: { x: box.width / 2, y: box.height - 10 } })
  await expect(reset).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('tabpanel', { name: '找回密码', exact: true })).toBeVisible()
  await doubleText(page)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await page.screenshot({ path: testInfo.outputPath('login-text-200-390.png'), fullPage: true })
})

for (const width of [320, 390]) {
  for (const mode of ['登录', '注册', '找回密码']) {
    test(`${width}px ${mode} fields and actions remain readable at doubled text size`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 844 })
      await installApiMock(page, () => json({}))
      await page.goto('/login')
      await page.getByRole('tab', { name: mode, exact: true }).click()
      const form = page.getByRole('tabpanel', { name: mode, exact: true })
      await expect(form).toBeVisible()
      await doubleText(page)
      await page.screenshot({ path: testInfo.outputPath(`auth-form-text-200-${width}.png`), fullPage: true })
      for (const button of await form.getByRole('button').all()) await textFitsControl(button)
      const inputs = await form.locator('input').evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element)
        const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2
        return { height: element.clientHeight, lineHeight }
      }))
      for (const input of inputs) expect(input.height).toBeGreaterThanOrEqual(input.lineHeight)
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    })
  }
}

test('desktop navigation labels stay inside their own links at doubled text size', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 960 })
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url }) => url.pathname.endsWith('/access/') ? json({ can_view_killboard: true }) : json([]))
  await page.goto('/planetary')
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  const collector = navigation.getByRole('link', { name: '击毁采集后台', exact: true })
  await expect(collector).toBeVisible()
  await doubleText(page)
  const links = navigation.locator('.nav-item')
  for (const link of await links.all()) await textFitsControl(link)
  const boxes = await links.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
  for (let index = 1; index < boxes.length; index += 1) expect(boxes[index].top).toBeGreaterThanOrEqual(boxes[index - 1].bottom)
  await collector.focus()
  await expect(collector).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
  await page.screenshot({ path: testInfo.outputPath('navigation-text-200-1440.png'), fullPage: true })
})
