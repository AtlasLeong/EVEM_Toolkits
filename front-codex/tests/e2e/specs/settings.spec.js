import { test, expect } from '@playwright/test'
import { installApiMock, json, TINY_ICON } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test('用户设置支持修改密码和保存预设价格', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'POST' && url.pathname === '/api/user/changepwd') {
      expect(body).toMatchObject({ oldPassword: 'OldPwd_1', newPassword: 'NewPwd_1', confirmPassword: 'NewPwd_1' })
      return json({ ok: true })
    }
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      return json([
        { resource_name: '光泽合金', resource_type: '船菜', resource_price: 1200 },
        { resource_name: '光彩合金', resource_type: '船菜', resource_price: 900 },
      ])
    }
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([
        {
          label: '船菜',
          options: [
            { label: '光泽合金', value: '光泽合金', icon: TINY_ICON },
            { label: '光彩合金', value: '光彩合金', icon: TINY_ICON },
          ],
        },
      ])
    }
    if (method === 'POST' && url.pathname === '/api/planetresourceprice') {
      expect(body).toHaveProperty('prePriceElement')
      expect(Array.isArray(body.prePriceElement)).toBeTruthy()
      expect(body.prePriceElement[0]).toMatchObject({ resource_name: '光泽合金' })
      return json({ ok: true })
    }
  })

  await page.goto('/usersetting')
  await expect(page.getByRole('heading', { name: '修改密码' })).toBeVisible()

  const passwordInputs = page.locator('input[type="password"]')
  await passwordInputs.nth(0).fill('OldPwd_1')
  await passwordInputs.nth(1).fill('NewPwd_1')
  await passwordInputs.nth(2).fill('NewPwd_1')
  await page.getByRole('button', { name: '保存密码' }).click()
  await expect(page.getByText('密码已更新')).toBeVisible()

  await page.getByRole('button', { name: '预设价格' }).click()
  await expect(page.getByRole('heading', { name: '价格表' })).toBeVisible()
  await expect(page.getByText('光泽合金')).toBeVisible()

  const firstPriceInput = page.locator('.compact-input').first()
  await firstPriceInput.fill('1500')
  await page.getByRole('button', { name: '保存价格' }).click()
  await expect(page.getByText('预设价格已保存')).toBeVisible()
})
