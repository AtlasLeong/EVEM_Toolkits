import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('诈骗名单空输入时显示顶部提示', async ({ page }) => {
  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '查询' }).click()
  await expect(page.getByText('请输入查询账号')).toBeVisible()
})

test('诈骗名单搜索结果可显示并支持排序', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/fraudsearch') {
      expect(body).toEqual({ searchNumber: 'target-001' })
      return json([
        {
          id: 2,
          account_type: 'QQ',
          fraud_account: '2136321710',
          remark: '-',
          fraud_type: '诈骗',
          source_group_name: '吉商委员会--927154656',
          icon: TINY_ICON,
        },
        {
          id: 1,
          account_type: '微信',
          fraud_account: '123456789',
          remark: '测试备注',
          fraud_type: '中间人纠纷',
          source_group_name: '奶爸商业联盟--636501916',
          icon: TINY_ICON,
        },
      ])
    }
  })

  await page.goto('/fraudlist')
  await page.locator('.search-input').fill('target-001')
  await page.getByRole('button', { name: '查询' }).click()

  const rowsBeforeSort = page.locator('tbody tr')
  await expect(rowsBeforeSort.nth(0)).toContainText('2136321710')
  await expect(rowsBeforeSort.nth(0)).toContainText('吉商委员会--927154656')
  await expect(rowsBeforeSort.nth(1)).toContainText('奶爸商业联盟--636501916')

  await page.getByRole('button', { name: /账号号码/ }).click()
  const rowsAfterSort = page.locator('tbody tr')
  await expect(rowsAfterSort.nth(0)).toContainText('123456789')
})

test('登录态下可查看我的举报并提交新举报', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([
        {
          id: 1,
          fraud_account: '998877',
          account_type: 'QQ',
          report_status: 'pending',
          approver_group: '',
          create_time: '2026-03-09 12:00:00',
        },
      ])
    }
    if (method === 'POST' && url.pathname === '/api/uploadimage/') {
      return json({ file_url: 'https://example.com/evidence/test-image.png' })
    }
    if (method === 'POST' && url.pathname === '/api/fraudlistreport') {
      return json({ id: 2, ok: true })
    }
  })

  await page.goto('/fraudlist')
  await expect(page.getByText('我的举报记录 1')).toBeVisible()
  await expect(page.locator('table.compact tbody tr').first()).toContainText('等待审核')
  await expect(page.locator('table.compact tbody tr').first()).not.toContainText('pending')

  await page.getByRole('button', { name: '举报' }).click()
  const modal = page.locator('.report-card')
  await expect(modal).toBeVisible()

  const textInputs = modal.locator('input:not([type="file"])')
  await textInputs.nth(0).fill('suspect-001')
  await modal.getByRole('button', { name: 'QQ' }).click()
  await modal.locator('textarea').fill('测试举报描述')
  await textInputs.nth(1).fill('2235102484')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'evidence.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504E470D0A1A0A', 'hex'),
  })

  await expect(modal.getByText('evidence.png')).toBeVisible()
  await modal.locator('.report-submit-btn').click()
  await expect(modal).toBeHidden()
})
