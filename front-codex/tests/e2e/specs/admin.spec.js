import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('管理员后台可新增记录并审核举报', async ({ page }) => {
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
      description: '待审核举报',
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
      return json(records)
    }
    if (method === 'POST' && url.pathname === '/api/fraudadminlist') {
      const payload = body.fraudRecord
      records = [
        ...records,
        {
          id: 2,
          fraud_account: payload.fraud_account,
          account_type: payload.account_type,
          fraud_type: payload.fraud_type,
          source_group_id: Number(payload.source_group_id),
          source_group_name: '吉商委员会',
          remark: payload.remark,
          icon: TINY_ICON,
        },
      ]
      return json({ id: 2 })
    }
    if (method === 'GET' && url.pathname === '/api/fraudbehaviorflow') {
      return json([
        {
          operation_id: 100,
          fraud_record_id: 1,
          username: 'adminUser',
          action_type: 'update',
          fraud_account: 'target-001',
          change: 'B',
          change_time: '2026-03-09T12:00:00Z',
          account_type: 'QQ',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会',
          remark: '旧备注',
        },
        {
          operation_id: 100,
          fraud_record_id: 1,
          username: 'adminUser',
          action_type: 'update',
          fraud_account: 'target-001',
          change: 'F',
          change_time: '2026-03-09T12:00:01Z',
          account_type: 'QQ',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会',
          remark: '新备注',
        },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/fraudadminlistreport') {
      return json(reports)
    }
    if (method === 'POST' && url.pathname === '/api/fraudadminlistreport') {
      reports = reports.map((item) =>
        item.id === body.report_id
          ? { ...item, report_status: body.approve_status, approve_remark: body.approve_remark, approver_group: '吉商委员会' }
          : item,
      )
      return json({ ok: true })
    }
  })

  await page.goto('/fraudadmin')
  await expect(page.getByRole('heading', { name: '诈骗名单管理' })).toBeVisible()

  const createSection = page.locator('.field-grid.four')
  await createSection.locator('input').first().fill('new-target-002')
  await createSection.locator('select').nth(2).selectOption('11')
  await createSection.locator('textarea').fill('自动化新增记录')
  await page.locator('.primary-btn').filter({ hasText: '新增记录' }).click()
  await expect(page.getByText('new-target-002')).toBeVisible()

  await page.locator('.admin-tab-row .tab-btn').nth(1).click()
  await expect(page.locator('.data-table tbody .ghost-btn')).toBeVisible()

  await page.locator('.admin-tab-row .tab-btn').nth(2).click()
  await page.locator('.data-table tbody .ghost-btn').first().click()
  await page.locator('.admin-report-modal textarea').fill('自动化通过')
  await page.locator('.admin-modal-actions .primary-btn').click()
  await expect(page.locator('.admin-report-modal')).toBeHidden()
})
