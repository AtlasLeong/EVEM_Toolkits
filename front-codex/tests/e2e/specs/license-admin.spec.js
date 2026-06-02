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
