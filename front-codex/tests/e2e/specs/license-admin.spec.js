import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('license admin can list, create, extend and unbind activation codes', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  const requests = []
  await installApiMock(page, async ({ method, url, body }) => {
    requests.push({ method, path: url.pathname, body })

    if (method === 'GET' && url.pathname === '/api/license/codes/') {
      return json({
        count: 1,
        results: [
          {
            id: 1,
            code: 'vip-code-001',
            is_active: true,
            expires_at: '2026-07-02T10:43:32',
            pc_identifier: 'pc-a',
            remark: 'VIP客户',
            plan: { code: 'vip', name: 'VIP金主组', grant_all_scripts: true },
            extra_script_ids: [],
            permissions: {
              plan: 'vip',
              plan_name: 'VIP金主组',
              grant_all_scripts: true,
              scripts: ['big_mining', 'system_monitor'],
            },
          },
        ],
      })
    }

    if (method === 'POST' && url.pathname === '/api/license/codes/') {
      return json({
        id: 2,
        code: 'new-code-002',
        is_active: true,
        expires_at: '2026-07-02T10:43:32',
        pc_identifier: null,
        remark: body.remark,
        plan: { code: body.plan, name: '默认组', grant_all_scripts: false },
        extra_script_ids: body.extra_script_ids,
        permissions: { scripts: ['system_monitor', ...(body.extra_script_ids || [])] },
      }, 201)
    }

    if (method === 'POST' && url.pathname === '/api/license/codes/1/extend/') {
      return json({ id: 1, code: 'vip-code-001', expires_at: '2026-08-01T10:43:32' })
    }

    if (method === 'POST' && url.pathname === '/api/license/codes/1/unbind/') {
      return json({ id: 1, code: 'vip-code-001', pc_identifier: null })
    }

    return undefined
  })

  await page.goto('/licenseadmin')

  await expect(page.getByRole('heading', { name: '激活码管理' })).toBeVisible()
  await expect(page.getByText('vip-code-001')).toBeVisible()
  await expect(page.locator('.license-actions-cell')).toHaveCSS('position', 'sticky')
  for (const width of [1280, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 })
    const shell = await page.locator('.license-table-shell').boundingBox()
    for (const button of await page.locator('.license-actions button').all()) {
      const box = await button.boundingBox()
      expect(box.x + box.width).toBeLessThanOrEqual(shell.x + shell.width)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  }
  await expect(page.getByRole('cell', { name: 'VIP金主组' })).toBeVisible()

  await page.getByLabel('有效天数').fill('30')
  await page.getByLabel('备注').fill('定制客户')
  await page.getByLabel('套餐').selectOption('default')
  await page.getByLabel('额外脚本').fill('big_mining')
  await page.getByRole('button', { name: '生成激活码' }).click()

  await expect.poll(() => requests.some((item) => item.method === 'POST' && item.path === '/api/license/codes/')).toBeTruthy()

  await page.getByRole('button', { name: '延期' }).first().click()
  await page.getByRole('button', { name: '解绑' }).first().click()

  await expect.poll(() => requests.some((item) => item.path === '/api/license/codes/1/extend/')).toBeTruthy()
  await expect.poll(() => requests.some((item) => item.path === '/api/license/codes/1/unbind/')).toBeTruthy()
})

test('license admin can inspect collapsed scripts and edit extra script permissions', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  const requests = []
  await installApiMock(page, async ({ method, url, body }) => {
    requests.push({ method, path: url.pathname, body })

    if (method === 'GET' && url.pathname === '/api/license/codes/') {
      return json({
        count: 1,
        results: [
          {
            id: 1,
            code: 'default-code-001',
            is_active: true,
            expires_at: '2026-07-02T10:43:32',
            pc_identifier: 'pc-a',
            remark: '定制客户',
            plan: { code: 'default', name: '默认组', grant_all_scripts: false },
            extra_script_ids: ['big_mining'],
            permissions: {
              plan: 'default',
              plan_name: '默认组',
              grant_all_scripts: false,
              scripts: ['ai_escape', 'ai_semi_escape', 'task_receiver', 'system_monitor', 'big_mining'],
            },
          },
        ],
      })
    }

    if (method === 'PATCH' && url.pathname === '/api/license/codes/1/') {
      return json({
        id: 1,
        code: 'default-code-001',
        extra_script_ids: body.extra_script_ids,
        plan: { code: 'default', name: '默认组', grant_all_scripts: false },
        permissions: {
          scripts: ['ai_escape', 'ai_semi_escape', 'task_receiver', 'system_monitor', ...(body.extra_script_ids || [])],
        },
      })
    }

    return undefined
  })

  await page.goto('/licenseadmin')

  const collapsed = page.locator('.license-script-more').first()
  await expect(collapsed).toHaveAttribute('title', /星系监控-观察者/)

  await page.getByRole('button', { name: '编辑权限' }).click()
  await expect(page.getByRole('heading', { name: '编辑额外脚本' })).toBeVisible()
  await expect(page.getByLabel('大鱼自动挖矿回站')).toBeChecked()
  await page.getByLabel('00地区AI警戒-991').check()
  await page.getByRole('button', { name: '保存权限' }).click()

  await expect
    .poll(() => requests.find((item) => item.method === 'PATCH' && item.path === '/api/license/codes/1/')?.body)
    .toEqual({ extra_script_ids: ['big_mining', 'ai_judge_991'] })
})
