import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('phone license filters fit while identity and every table field remain reachable', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })
  await installApiMock(page, ({ url }) => url.pathname === '/api/license/codes/' ? json({
    count: 1,
    results: [{ id: 1, code: 'responsive-license-001', is_active: true,
      expires_at: '2030-07-02T10:43:32', pc_identifier: 'pc-a', remark: '测试记录',
      plan: { code: 'default', name: '默认组' }, permissions: { scripts: ['system_monitor'] } }],
  }) : json({}))
  await page.goto('/licenseadmin')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const region = page.getByRole('region', { name: '激活码记录，可横向滚动' })
    await expect(region).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await expect(page.locator('.license-actions-cell')).toHaveCSS('position', 'static')
    expect(await region.evaluate(element => element.scrollWidth > element.clientWidth)).toBeTruthy()
    expect(await region.locator('thead th').allTextContents()).toEqual(['激活码', '套餐', '状态', '到期时间', '设备', '脚本权限', '备注', '操作'])
    await region.evaluate(element => { element.scrollLeft = 0 })
    const code = await page.getByText('responsive-license-001', { exact: true }).boundingBox()
    const box = await region.boundingBox()
    expect(code.x).toBeGreaterThanOrEqual(box.x)
    expect(code.x).toBeLessThan(box.x + box.width)
    await region.focus()
    await page.keyboard.press('ArrowRight')
    await expect.poll(() => region.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
  }
})

test('phone password fields have labels and full-width space for entry', async ({ page }) => {
  await seedAuthenticatedSession(page)
  await installApiMock(page, () => json({}))
  await page.goto('/usersetting')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const oldPassword = page.getByLabel('旧密码', { exact: true })
    const newPassword = page.getByLabel('新密码', { exact: true })
    const confirm = page.getByLabel('确认新密码', { exact: true })
    await expect(oldPassword).toHaveAttribute('autocomplete', 'current-password')
    await expect(newPassword).toHaveAttribute('autocomplete', 'new-password')
    const boxes = await Promise.all([oldPassword, newPassword, confirm].map(field => field.boundingBox()))
    expect(boxes[1].y).toBeGreaterThan(boxes[0].y + boxes[0].height)
    expect(boxes[2].y).toBeGreaterThan(boxes[1].y + boxes[1].height)
    expect(boxes[0].width).toBeGreaterThan(width * .65)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
})

test('failed price reads show recovery instead of an empty list or enabled empty save', async ({ page }) => {
  await seedAuthenticatedSession(page)
  let unavailable = true
  await installApiMock(page, ({ url }) => url.pathname === '/api/planetresourceprice'
    ? unavailable ? json({ detail: '临时价格服务故障' }, 503) : json([{ resource_name: '光泽合金', resource_type: '合金', resource_price: 1200 }])
    : json([]))
  await page.goto('/usersetting')
  await page.getByRole('button', { name: '预设价格', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: '预设价格加载失败' })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: '默认价格加载失败' })).toBeVisible()
  await expect(page.getByText('暂无价格数据')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: '保存价格', exact: true })).toBeDisabled()
  unavailable = false
  await page.getByRole('button', { name: '重试预设价格' }).click()
  await page.getByRole('button', { name: '重试默认价格' }).click()
  await expect(page.getByLabel('光泽合金预设价格')).toHaveValue('1200')
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: '恢复默认', exact: true })).toBeEnabled()
  await expect(page.getByRole('button', { name: '保存价格', exact: true })).toBeEnabled()
})
