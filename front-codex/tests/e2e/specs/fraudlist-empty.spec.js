import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'

test('诈骗名单未命中账号时保持空结果态', async ({ page }) => {
  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/fraudsearch') {
      expect(body).toEqual({ searchNumber: 'not-found-target' })
      return json([])
    }
  })

  await page.goto('/fraudlist')
  await page.locator('.search-input').fill('not-found-target')
  await page.getByRole('button', { name: '查询' }).click()

  await expect(page.locator('.empty-title')).toHaveText('暂无结果')
  await expect(page.locator('.empty-desc')).toHaveText('输入目标账号后开始查询')
})
