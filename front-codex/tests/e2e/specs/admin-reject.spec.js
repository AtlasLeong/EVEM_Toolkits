import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('管理员可拒绝举报并写入拒绝备注', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  let reports = [
    {
      id: 9,
      fraud_account: 'suspect-009',
      account_type: 'QQ',
      contact_number: '2235102484',
      report_status: 'pending',
      approve_remark: '',
      approver_group: '',
      create_time: '2026-03-09T12:00:00Z',
      description: '待拒绝举报',
      evidence_dict: ['https://example.com/evidence.png'],
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
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json(reports)
    }
    if (method === 'POST' && url.pathname === '/api/fraudadminlistreport') {
      expect(body).toMatchObject({
        report_id: 9,
        approve_status: 'reject',
        approve_remark: '证据不足',
      })
      reports = reports.map((item) =>
        item.id === 9
          ? { ...item, report_status: 'reject', approve_remark: '证据不足', approver_group: '吉商委员会' }
          : item,
      )
      return json({ ok: true })
    }
  })

  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(2).click()
  await page.locator('.data-table tbody .ghost-btn').first().click()

  const modal = page.locator('.admin-report-modal')
  await modal.getByRole('button', { name: '拒绝' }).click()
  await modal.locator('textarea').fill('证据不足')
  await modal.getByRole('button', { name: '提交审核' }).click()

  await expect(modal).toBeHidden()
  await expect(page.getByText('已提交审核结果')).toBeVisible()
})
