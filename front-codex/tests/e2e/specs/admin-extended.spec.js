import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('已登录但非管理员访问诈骗后台会被导向管理员登录页', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'normalUser' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlogin') {
      return json({ message: 'UnAuthorized Users' })
    }
  })

  await page.goto('/fraudadmin')
  await expect(page).toHaveURL(/\/fraudlogin$/)
  await expect(page.locator('.admin-login-warning')).toBeVisible()
})

test('管理员可编辑并删除诈骗记录', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  let records = [
    {
      id: 1,
      fraud_account: 'target-001',
      account_type: 'QQ',
      fraud_type: '诈骗',
      source_group_id: 11,
      source_group_name: '吉商委员会',
      remark: '旧记录',
      icon: TINY_ICON,
    },
  ]

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlogin') {
      return json({ message: 'Authorized Users' })
    }
    if (method === 'GET' && url.pathname === '/api/fraudadmingroup') {
      return json([{ value: '11', label: '吉商委员会' }])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlist') {
      return json(records)
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json([])
    }
    if (method === 'PATCH' && url.pathname === '/api/fraudadminlist') {
      const payload = body.fraudRecord
      records = records.map((item) =>
        item.id === payload.fraud_id
          ? {
              ...item,
              fraud_account: payload.fraud_account,
              account_type: payload.account_type,
              fraud_type: payload.fraud_type,
              source_group_id: Number(payload.source_group_id),
              remark: payload.remark,
            }
          : item,
      )
      return json({ ok: true })
    }
    if (method === 'DELETE' && url.pathname === '/api/fraudadminlist') {
      const fraudId = body.fraudID
      records = records.filter((item) => item.id !== fraudId)
      return json({ ok: true })
    }
  })

  await page.goto('/fraudadmin')
  await expect(page.getByText('target-001')).toBeVisible()

  page.once('dialog', (dialog) => dialog.accept())

  await page.locator('.admin-row-actions .ghost-btn').first().click()
  const modal = page.locator('.admin-modal')
  await expect(modal).toBeVisible()
  await modal.locator('input').first().fill('target-001-updated')
  await modal.locator('textarea').fill('已编辑备注')
  await modal.locator('.admin-modal-actions .primary-btn').click()

  await expect(page.getByText('target-001-updated')).toBeVisible()
  await expect(page.getByText('已编辑备注')).toBeVisible()

  await page.locator('.admin-row-actions .danger').first().click()
  await expect(page.getByText('target-001-updated')).toHaveCount(0)
})
