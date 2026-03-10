import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('未登录时防诈页不显示举报入口和我的举报记录', async ({ page }) => {
  await page.goto('/fraudlist')
  await expect(page.locator('.report-open-btn')).toHaveCount(0)
  await expect(page.getByText('我的举报记录')).toHaveCount(0)
})

test('举报表单未上传图片时给出错误提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
  })

  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '举报' }).click()

  const modal = page.locator('.report-card')
  const textInputs = modal.locator('input:not([type="file"])')
  await textInputs.nth(0).fill('suspect-no-image')
  await modal.getByRole('button', { name: 'QQ' }).click()
  await modal.locator('textarea').fill('无图片举报测试')
  await textInputs.nth(1).fill('2235102484')
  await modal.locator('.report-submit-btn').click()

  await expect(modal.locator('.form-error')).toContainText('请上传至少一张证据图片')
})

test('举报表单上传超过 5 张图片时阻止继续添加', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  let uploadIndex = 0

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
    if (method === 'POST' && url.pathname === '/api/uploadimage/') {
      uploadIndex += 1
      return json({ file_url: `https://example.com/evidence/${uploadIndex}.png` })
    }
  })

  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '举报' }).click()

  const modal = page.locator('.report-card')
  const fileInput = modal.locator('input[type="file"]')

  await fileInput.setInputFiles(
    Array.from({ length: 5 }, (_, index) => ({
      name: `evidence-${index + 1}.png`,
      mimeType: 'image/png',
      buffer: Buffer.from('89504E470D0A1A0A', 'hex'),
    })),
  )

  await expect(modal.getByText('5 / 5')).toBeVisible()

  await fileInput.setInputFiles({
    name: 'overflow.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504E470D0A1A0A', 'hex'),
  })

  await expect(modal.locator('.form-error')).toContainText('最多上传 5 张图片')
})
