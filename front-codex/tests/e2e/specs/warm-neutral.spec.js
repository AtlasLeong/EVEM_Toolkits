import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1024 })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/planetresources') return json([{ label: '船菜', options: [{ value: '光泽合金', label: '光泽合金', icon: TINY_ICON }] }])
    if (url.pathname === '/api/searchplanetresource') return json([
      { id: 1, resource_name: '光泽合金', region: '伏尔戈', solar_system: '夫斯库仑', planet_id: 'III', resource_level: 4, resource_yield: 29.74, icon: TINY_ICON },
      { id: 2, resource_name: '光泽合金', region: '伏尔戈', solar_system: '米瑟约亚', planet_id: 'VI', resource_level: 3, resource_yield: 26.77, icon: TINY_ICON },
    ])
    return json([])
  })
})

async function search(page) {
  await page.goto('/planetary')
  await page.locator('.resource-disclosure summary').click()
  await page.locator('.resource-disclosure').getByRole('button', { name: /光泽合金/ }).click()
  await page.getByRole('button', { name: '搜索', exact: true }).click()
  await expect(page.locator('.planetary-table tbody tr')).toHaveCount(2)
}

test('客户页面使用暖白配色、黑色透明头像且不出现工作空间', async ({ page }) => {
  await page.goto('/planetary')
  await expect(page.getByText('工作空间', { exact: true })).toHaveCount(0)
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(250, 249, 246)')
  await expect(page.locator('.shell-sidebar')).toHaveCSS('background-color', 'rgb(240, 239, 235)')
  await expect(page.locator('.brand-icon')).toHaveCSS('filter', 'brightness(0)')
  await expect(page.locator('.brand-icon')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
  await expect(page.locator('.brand-icon')).toHaveCSS('border-top-width', '0px')
})

test('收起导航保留可访问名称、扩大内容区并记住偏好', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'customer' })
  await page.goto('/planetary')
  const expandedMain = await page.getByRole('main').boundingBox()
  const toggle = page.getByRole('button', { name: '收起导航' })
  await toggle.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: '展开导航' })).toHaveAttribute('aria-expanded', 'false')
  expect((await page.getByRole('main').boundingBox()).width).toBeGreaterThan(expandedMain.width)
  await page.getByRole('link', { name: '星系导航', exact: true }).click()
  await expect(page).toHaveURL(/\/starmap$/)
  await page.reload()
  await expect(page.getByRole('button', { name: '展开导航' })).toBeVisible()
  await page.getByRole('button', { name: '设置', exact: true }).click()
  await expect(page).toHaveURL(/\/usersetting$/)
  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(page.locator('.brand-name')).toBeVisible()
})

test('浏览器不允许保存导航偏好时仍能正常收起和展开', async ({ page }) => {
  await page.addInitScript(() => {
    const get = Storage.prototype.getItem
    const set = Storage.prototype.setItem
    Storage.prototype.getItem = function (key) { if (key === 'evem-sidebar-collapsed') throw new Error('Storage disabled'); return get.call(this, key) }
    Storage.prototype.setItem = function (key, value) { if (key === 'evem-sidebar-collapsed') throw new Error('Storage disabled'); return set.call(this, key, value) }
  })
  await page.goto('/planetary')
  await page.getByRole('button', { name: '收起导航' }).click()
  await page.getByRole('button', { name: '展开导航' }).click()
  await expect(page.getByRole('heading', { name: '行星资源', exact: true })).toBeVisible()
})

test('高级筛选默认收起且反复展开不会清空过滤条件', async ({ page }) => {
  await search(page)
  const advanced = page.locator('.advanced-filters')
  await expect(advanced).toHaveJSProperty('open', false)
  await advanced.locator(':scope > summary').click()
  await page.getByPlaceholder('筛选星系').fill('夫斯')
  await expect(page.locator('.planetary-table tbody tr')).toHaveCount(1)
  await advanced.locator(':scope > summary').click()
  await expect(page.locator('.planetary-table tbody tr')).toHaveCount(1)
  await advanced.locator(':scope > summary').click()
  await expect(page.getByPlaceholder('筛选星系')).toHaveValue('夫斯')
})

test('结果标题旁仅有一组计算器入口并保留添加行为', async ({ page }) => {
  await search(page)
  await expect(page.locator('.resource-result-icon').first()).toHaveCSS('object-fit', 'contain')
  await expect(page.locator('.resource-result-icon').first()).toHaveCSS('width', '64px')
  const open = page.getByRole('button', { name: /打开计算器/ })
  const add = page.getByRole('button', { name: /加入计算器/ })
  await expect(open).toHaveCount(1)
  await expect(page.locator('.planetary-results-header').getByRole('button', { name: /打开计算器/ })).toBeVisible()
  await expect(open).toHaveCSS('background-color', 'rgb(36, 36, 34)')
  await page.locator('.planetary-table tbody .table-check-trigger').first().click()
  await expect(add).toHaveCSS('background-color', 'rgb(166, 83, 62)')
  await add.click()
  await expect(page.locator('.calculator-card tbody tr')).toHaveCount(1)
  await expect(page.locator('.calculator-card')).toHaveCSS('background-color', 'rgb(255, 255, 255)')
})
