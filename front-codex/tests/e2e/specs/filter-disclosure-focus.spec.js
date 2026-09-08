import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/regions') return json([{ r_id: 1, r_title: '德里克', r_safetylvl: 0.5 }])
    if (url.pathname === '/api/planetresources') return json([{ label: '船菜', options: [{ value: '光泽合金', label: '光泽合金', icon: TINY_ICON }] }])
    return json([])
  })
  await page.goto('/planetary')
})

for (const [name, selector, option] of [
  ['地点', '.picker-field', '.picker-option'],
  ['资源', '.resource-disclosure', '.resource-card'],
]) {
  test(`${name}选中后反复点击面板内空白不关闭或崩溃，面板外点击仍关闭`, async ({ page }) => {
    const failures = []
    page.on('crash', () => failures.push('renderer crashed'))
    page.on('pageerror', error => failures.push(error.message))
    const picker = page.locator(selector).first()
    await picker.locator('summary').click()
    await picker.locator(option).first().click()
    const selected = picker.locator('.picker-selected')
    await expect(selected.locator('button')).toHaveCount(1)
    for (let i = 0; i < 3; i++) {
      await picker.locator('input').first().focus()
      const box = await selected.boundingBox()
      const position = { x: box.width - 24, y: box.height / 2 }
      // Ensure this is the blank group surface, not a remove button or scrollbar.
      expect(await selected.evaluate((e, point) => {
        const rect = e.getBoundingClientRect()
        return document.elementFromPoint(rect.x + point.x, rect.y + point.y) === e
      }, position)).toBeTruthy()
      await selected.click({ position })
      await expect(picker).toHaveJSProperty('open', true)
      await expect(selected.locator('button')).toHaveCount(1)
      await picker.locator('input').first().fill('不匹配')
      await expect(picker.locator('.picker-empty')).toBeVisible()
      await picker.locator('input').first().fill('')
    }
    await page.getByRole('heading', { name: '行星资源', exact: true }).click()
    await expect(picker).toHaveJSProperty('open', false)
    await picker.locator('summary').click()
    await expect(selected.locator('button')).toHaveCount(1)
    expect(failures).toEqual([])
  })
}

test('失去文档焦点不折叠原生 details，键盘离开和 Escape 仍可关闭', async ({ page }) => {
  const picker = page.locator('.picker-field').first()
  const summary = picker.locator('summary')
  await summary.click()
  const input = picker.locator('input')
  await input.focus()
  await input.evaluate(e => e.blur())
  await expect(picker).toHaveJSProperty('open', true)
  await summary.focus()
  await summary.press('Shift+Tab')
  await expect(picker).toHaveJSProperty('open', false)
  await summary.click()
  await input.focus()
  await input.press('Escape')
  await expect(picker).toHaveJSProperty('open', false)
  await expect(summary).toBeFocused()
})
