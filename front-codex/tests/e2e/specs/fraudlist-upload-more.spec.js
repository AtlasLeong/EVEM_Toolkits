import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

async function installFraudUploadMock(page, overrides = {}) {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  const uploadResolver = overrides.uploadResolver

  await installApiMock(page, async ({ url, method }) => {
    if (method === 'GET' && url.pathname === '/api/fraudlistreport') {
      return json([])
    }
    if (method === 'POST' && url.pathname === '/api/uploadimage/') {
      if (uploadResolver) return uploadResolver()
      return json({ file_url: 'https://example.com/evidence-1.png' })
    }
    if (method === 'POST' && url.pathname === '/api/fraudlistreport') {
      return json({ ok: true })
    }
  })
}

test('举报上传非法文件类型时显示错误', async ({ page }) => {
  await installFraudUploadMock(page)

  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '举报' }).click()

  const modal = page.locator('.report-card')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'evidence.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('invalid'),
  })

  await expect(modal.locator('.form-error')).toContainText('仅支持')
})

test('举报图片上传接口失败时显示错误', async ({ page }) => {
  await installFraudUploadMock(page, {
    uploadResolver: () => json({ error: '上传接口失败' }, 500),
  })

  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '举报' }).click()

  const modal = page.locator('.report-card')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'evidence.png',
    mimeType: 'image/png',
    buffer: Buffer.from('png'),
  })

  await expect(modal.locator('.form-error')).toContainText('上传接口失败')
})

test('举报可移除已上传图片', async ({ page }) => {
  await installFraudUploadMock(page)

  await page.goto('/fraudlist')
  await page.getByRole('button', { name: '举报' }).click()

  const modal = page.locator('.report-card')
  await modal.locator('input[type="file"]').setInputFiles({
    name: 'evidence.png',
    mimeType: 'image/png',
    buffer: Buffer.from('png'),
  })

  await expect(modal.getByText('evidence.png')).toBeVisible()
  await modal.getByRole('button', { name: /移除/ }).click()

  await expect(modal.getByText('evidence.png')).toHaveCount(0)
  await expect(modal.getByText('请上传聊天记录或其他证据截图')).toBeVisible()
})
