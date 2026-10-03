import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

// The same text-only pressure simulation as the navigation audit, not native zoom.
async function doubleText(page) {
  await page.evaluate(() => {
    const sizes = [...document.querySelectorAll('body *')].map(element => [element, parseFloat(getComputedStyle(element).fontSize)])
    for (const [element, size] of sizes) element.style.setProperty('font-size', `${size * 2}px`, 'important')
  })
}

async function verticalTextFits(locator) {
  expect(await locator.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    const box = element.getBoundingClientRect()
    return [...range.getClientRects()].every(rect => rect.top >= box.top - 1 && rect.bottom <= box.bottom + 1)
  })).toBeTruthy()
}

async function nativeTextFits(locator, value) {
  const fit = await locator.evaluate((element, text) => {
    const style = getComputedStyle(element)
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d')
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    const metrics = context.measureText(text ?? element.selectedOptions[0].textContent)
    const padding = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
    // Native select arrows need their own space; editable prices have no arrow.
    const reserved = element.tagName === 'SELECT' ? 20 : 0
    return metrics.width + padding + reserved <= element.clientWidth
  }, value)
  expect(fit).toBeTruthy()
}

test('planetary doubled-text labels and values keep their own rows and keyboard selection works', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ url }) => url.pathname === '/api/regions'
    ? json([{ r_id: 1, r_title: '德里克', r_safetylvl: .5 }]) : json([]))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/planetary')
    const summaries = page.locator('.planetary-filters .filter-toggle')
    await expect(summaries).toHaveCount(4)
    await doubleText(page)
    for (const summary of await summaries.all()) {
      const label = summary.locator('.filter-label')
      const value = summary.locator('.filter-value')
      await verticalTextFits(label)
      await verticalTextFits(value)
      const [labelBox, valueBox] = await Promise.all([label.boundingBox(), value.boundingBox()])
      expect(labelBox.y + labelBox.height).toBeLessThanOrEqual(valueBox.y)
    }
    const region = page.locator('.picker-field').first()
    await region.locator('summary').focus()
    await page.keyboard.press('Enter')
    await region.getByRole('button', { name: /德里克/ }).click()
    await page.keyboard.press('Escape')
    await expect(region.locator('summary')).toBeFocused()
    await expect(region.locator('summary')).toContainText('德里克')
    await verticalTextFits(region.locator('.filter-value'))
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})

test('doubled-text settings preserve password labels and complete editable numeric prices', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installApiMock(page, ({ url }) => url.pathname === '/api/planetresourceprice'
    ? json([{ resource_name: '光泽合金', resource_type: '合金', resource_price: 1200 }]) : json([]))
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/usersetting')
    await expect(page.getByLabel('旧密码', { exact: true })).toBeVisible()
    await doubleText(page)
    const fields = page.locator('.settings-password-form .field-row')
    for (const field of await fields.all()) {
      const label = await field.locator('label').boundingBox()
      const input = field.locator('input')
      const box = await input.boundingBox()
      expect(label.y + label.height).toBeLessThanOrEqual(box.y)
      await input.fill('SamplePass123')
      await expect(input).toHaveValue('SamplePass123')
    }
    await page.goto('/usersetting')
    await page.getByRole('button', { name: '预设价格', exact: true }).click()
    const price = page.getByLabel('光泽合金预设价格')
    await expect(price).toHaveValue('1200')
    await doubleText(page)
    await nativeTextFits(price, '1200')
    const region = page.getByRole('region', { name: '预设价格表，可横向滚动' })
    await region.focus()
    if (await region.evaluate(element => element.scrollWidth > element.clientWidth)) {
      await page.keyboard.press('ArrowRight')
      await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    }
    await price.scrollIntoViewIfNeeded()
    const [priceBox, regionBox] = await Promise.all([price.boundingBox(), region.boundingBox()])
    expect(priceBox.x).toBeGreaterThanOrEqual(regionBox.x)
    expect(priceBox.x + priceBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width)
    await price.fill('12345678')
    await expect(price).toHaveValue('12345678')
    await nativeTextFits(price, '12345678')
    await expect(page.getByRole('button', { name: '保存价格', exact: true })).toBeEnabled()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})

test('license doubled-text filter selections retain complete values and remain usable', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installApiMock(page, () => json({ count: 0, results: [] }))
  for (const width of [1440, 1024, 390]) {
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/licenseadmin')
    const status = page.getByLabel('筛选激活码状态')
    const plan = page.getByLabel('筛选授权方案')
    await expect(status).toBeVisible()
    await doubleText(page)
    await nativeTextFits(status)
    await nativeTextFits(plan)
    await status.selectOption('true')
    await expect(status).toHaveValue('true')
    await nativeTextFits(status)
    const days = page.getByLabel('延期天数')
    await days.fill('365')
    await expect(days).toHaveValue('365')
    await nativeTextFits(days, '365')
    const controls = await page.locator('.license-toolbar > *').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().toJSON()))
    for (let index = 1; index < controls.length; index += 1) {
      const previous = controls[index - 1]
      const current = controls[index]
      expect(current.top >= previous.bottom || current.left >= previous.right).toBeTruthy()
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})
