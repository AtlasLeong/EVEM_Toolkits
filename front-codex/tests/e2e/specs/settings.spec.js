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
  await expect(page.locator('.data-table')).toHaveCSS('min-width', '0px')

  const firstPriceInput = page.locator('.compact-input').first()
  await firstPriceInput.fill('1500')
  await page.getByRole('button', { name: '保存价格' }).click()
  await expect(page.getByText('预设价格已保存')).toBeVisible()
})

test('预设价格保存失败后恢复默认使用成功状态且保留后续失败提示', async ({ page }) => {
  await seedAuthenticatedSession(page, { userName: 'atlas123' })
  let saveCount = 0
  let releaseSecondSave
  const secondSaveReleased = new Promise(resolve => { releaseSecondSave = resolve })

  await installApiMock(page, async ({ url, method, body }) => {
    if (method === 'GET' && url.pathname === '/api/planetresourceprice') {
      return json([{ resource_name: '光泽合金', resource_type: '船菜', resource_price: url.searchParams.get('resetPrice') === 'default' ? 900 : 1200 }])
    }
    if (method === 'GET' && url.pathname === '/api/planetresources') {
      return json([{ label: '船菜', options: [{ label: '光泽合金', value: '光泽合金', icon: TINY_ICON }] }])
    }
    if (method === 'POST' && url.pathname === '/api/planetresourceprice') {
      saveCount += 1
      expect(body.prePriceElement[0]).toMatchObject({ resource_name: '光泽合金', resource_price: saveCount === 1 ? 1500 : 1550 })
      if (saveCount === 1) return json({ detail: '第一次价格保存失败' }, 500)
      await secondSaveReleased
      return json({ detail: '再次价格保存失败' }, 500)
    }
  })

  await page.goto('/usersetting')
  await page.getByRole('button', { name: '预设价格', exact: true }).click()
  const price = page.getByLabel('光泽合金预设价格')
  const save = page.getByRole('button', { name: '保存价格', exact: true })
  const reset = page.getByRole('button', { name: '恢复默认', exact: true })
  await expect(price).toHaveValue('1200')
  await price.fill('1500')
  await save.click()
  await expect(page.getByRole('alert')).toHaveText('第一次价格保存失败')
  await expect(page.getByRole('alert')).toHaveClass('form-error')

  await reset.click()
  await expect(price).toHaveValue('900')
  await expect(page.getByRole('status')).toHaveText('已恢复默认价格')
  await expect(page.getByRole('status')).toHaveClass('form-success')
  await expect(page.getByRole('alert')).toHaveCount(0)

  await price.fill('1550')
  await save.click()
  await expect(save).toBeDisabled()
  await expect(reset).toBeEnabled()
  await reset.click()
  await expect(price).toHaveValue('900')
  await expect(page.getByRole('status')).toHaveText('已恢复默认价格')
  await expect(save).toBeDisabled()
  releaseSecondSave()
  await expect(page.getByRole('alert')).toHaveText('再次价格保存失败')
  await expect(page.getByRole('alert')).toHaveClass('form-error')
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(save).toBeEnabled()
  expect(saveCount).toBe(2)
})
