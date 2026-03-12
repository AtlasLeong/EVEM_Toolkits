import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('管理员新增记录缺少必填项时显示错误提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudadmincheck') {
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
      return json([])
    }
  })

  await page.goto('/fraudadmin')
  await page.locator('.primary-btn').filter({ hasText: '新增记录' }).click()
  await expect(page.locator('.form-error')).toContainText('请填写账号并选择来源群组')
})

test('管理员审核举报缺少必填项时显示字段提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'adminUser' })

  let reviewSubmitted = false

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudadmincheck') {
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
      return json([
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
          icon: TINY_ICON,
        },
      ])
    }
    if (method === 'POST' && url.pathname === '/api/fraudadminlistreport') {
      reviewSubmitted = true
      return json({ ok: true })
    }
  })

  await page.goto('/fraudadmin')
  await page.locator('.admin-tab-row .tab-btn').nth(2).click()
  await page.locator('.data-table tbody .ghost-btn').first().click()
  await page.locator('.admin-review-submit').click()

  await expect(page.getByText('审核备注为必填字段')).toBeVisible()
  await expect(page.getByText('请选择审核结果')).toBeVisible()
  await expect(page.locator('.admin-report-modal')).toBeVisible()
  expect(reviewSubmitted).toBeFalsy()
})
