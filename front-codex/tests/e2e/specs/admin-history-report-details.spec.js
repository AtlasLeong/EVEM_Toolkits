import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function installAdminDetailMock(page) {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlogin') {
      return json({ message: 'Authorized Users' })
    }
    if (method === 'GET' && url.pathname === '/api/fraudadmingroup') {
      return json([{ value: '11', label: '吉商委员会' }])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlist') {
      return json([
        {
          id: 1,
          fraud_account: 'target-001',
          account_type: 'QQ',
          fraud_type: '诈骗',
          source_group_id: 11,
          source_group_name: '吉商委员会',
          remark: '旧备注',
          icon: TINY_ICON,
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([
        {
          operation_id: 100,
          change: 'B',
          change_time: '2026-03-09T12:00:00Z',
          username: 'adminUser',
          action_type: 'update',
          fraud_account: 'target-001',
          account_type: 'QQ',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会',
          remark: '旧备注',
        },
        {
          operation_id: 100,
          change: 'F',
          change_time: '2026-03-09T12:00:01Z',
          username: 'adminUser',
          action_type: 'update',
          fraud_account: 'target-001-updated',
          account_type: 'QQ',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会',
          remark: '新备注',
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json([
        {
          id: 9,
          fraud_account: 'suspect-009',
          account_type: 'QQ',
          contact_number: '2235102484',
          report_status: 'accept',
          approve_remark: '已核实',
          approver_group: '吉商委员会',
          create_time: '2026-03-09T12:00:00Z',
          description: '已审核举报',
          evidence_dict: ['https://example.com/evidence.png'],
        },
      ])
    }
  })
}

test('管理员可查看行为流水前后版本差异', async ({ page }) => {
  await installAdminDetailMock(page)

  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await page.locator('.data-table tbody .ghost-btn').first().click()

  const modal = page.locator('.admin-modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('旧备注')
  await expect(modal).toContainText('新备注')
  await expect(modal).toContainText('target-001-updated')
})

test('已审核举报打开的是详情视图而不是审批视图', async ({ page }) => {
  await installAdminDetailMock(page)

  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(2).click()
  await page.locator('.data-table tbody .ghost-btn').first().click()

  const modal = page.locator('.admin-report-modal')
  await expect(modal).toBeVisible()
  await expect(modal).toContainText('已核实')
  await expect(modal.locator('textarea')).toHaveCount(0)
  await expect(modal.getByRole('button', { name: '提交审核' })).toHaveCount(0)
})
