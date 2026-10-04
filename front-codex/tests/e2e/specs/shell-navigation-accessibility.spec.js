import { test, expect } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'

test.beforeEach(async ({ page }) => {
  await installApiMock(page, async () => json([]))
})

async function deferDesktopMediaNotification(page) {
  await page.addInitScript(() => {
    // Keep the native viewport/CSS change, but deliver its media notification
    // after Chromium has blurred the control that CSS just hid.
    const matchMedia = window.matchMedia.bind(window)
    const pending = []
    window.__releaseDesktopMediaNotifications = () => pending.splice(0).forEach(deliver => deliver())
    window.matchMedia = query => {
      const media = matchMedia(query)
      if (query !== '(min-width: 1180px)') return media
      const add = media.addEventListener.bind(media)
      const remove = media.removeEventListener.bind(media)
      const listeners = new WeakMap()
      media.addEventListener = (type, listener, options) => {
        const wrapped = event => {
          if (event.matches) pending.push(() => listener(event))
          else listener(event)
        }
        listeners.set(listener, wrapped)
        add(type, wrapped, options)
      }
      media.removeEventListener = (type, listener, options) => remove(type, listeners.get(listener) || listener, options)
      return media
    }
  })
}

test('键盘可以跳过分组导航直接进入主内容', async ({ page }) => {
  await page.goto('/planetary')
  await page.keyboard.press('Tab')
  await expect(page.getByRole('link', { name: '跳到主要内容' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.locator('#main-content')).toBeFocused()
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  for (const name of ['市场与工业', '星际行动', '社区情报']) {
    await expect(navigation.getByRole('group', { name, exact: true })).toBeVisible()
  }
  await expect(navigation.getByRole('link', { name: '击毁情报 KM', exact: true })).toHaveCount(0)
  await expect(navigation.getByRole('link', { name: '战术板概况', exact: true })).toHaveCount(0)
})

test('移动导航 Escape 关闭并返回开关焦点，换页聚焦主内容', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  const toggle = page.locator('.mobile-menu-toggle')
  await toggle.click()
  const mobileNavigation = page.getByRole('navigation', { name: '移动主导航' })
  await mobileNavigation.getByRole('link', { name: '市场价格', exact: true }).focus()
  await page.keyboard.press('Escape')
  await expect(toggle).toBeFocused()
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(mobileNavigation).toBeHidden()
  await toggle.click()
  await mobileNavigation.getByRole('link', { name: '需求与反馈', exact: true }).click()
  await expect(page).toHaveURL(/\/feedback$/)
  await expect(mobileNavigation).toBeHidden()
  await expect(page.locator('#main-content')).toBeFocused()
})

test('移动导航在调整到桌面宽度时关闭并保留可见焦点', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  await page.locator('.mobile-menu-toggle').click()
  await page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '市场价格', exact: true }).focus()
  await page.setViewportSize({ width: 1180, height: 960 })
  await expect(page.locator('.mobile-nav')).toBeHidden()
  await expect(page.locator('.mobile-menu-toggle')).toHaveAttribute('aria-expanded', 'false')
  await expect(page.locator('#main-content')).toBeFocused()
  await expect(page.locator('.shell-sidebar')).toBeVisible()
})

for (const source of ['link', 'toggle']) {
  test(`CSS先隐藏移动${source}焦点时，断点通知仍把焦点移到可见主内容`, async ({ page }) => {
    await deferDesktopMediaNotification(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/planetary')
    const toggle = page.locator('.mobile-menu-toggle')
    await toggle.click()
    const focused = source === 'link'
      ? page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '市场价格', exact: true })
      : toggle
    await focused.focus()
    await expect(focused).toBeFocused()
    await page.setViewportSize({ width: 1180, height: 960 })
    await expect(focused).toBeHidden()
    await page.waitForFunction(() => document.activeElement === document.body)
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await page.evaluate(() => window.__releaseDesktopMediaNotifications())
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.locator('#main-content')).toBeFocused()
  })
}

test('移动导航断点关闭不会抢走已转到主内容按钮的焦点', async ({ page }) => {
  await deferDesktopMediaNotification(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  const toggle = page.locator('.mobile-menu-toggle')
  await toggle.click()
  await page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '市场价格', exact: true }).focus()
  const search = page.getByRole('button', { name: '搜索', exact: true })
  await search.focus()
  await expect(search).toBeFocused()
  await page.setViewportSize({ width: 1180, height: 960 })
  await expect(toggle).toBeHidden()
  await page.evaluate(() => window.__releaseDesktopMediaNotifications())
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  await expect(search).toBeFocused()
})

test('用户主动移除可见移动链接的焦点后，断点关闭保持无焦点状态', async ({ page }) => {
  await deferDesktopMediaNotification(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  const toggle = page.locator('.mobile-menu-toggle')
  await toggle.click()
  const focused = page.getByRole('navigation', { name: '移动主导航' }).getByRole('link', { name: '市场价格', exact: true })
  await focused.focus()
  await expect(focused).toBeFocused()
  await focused.evaluate(element => element.blur())
  await page.waitForFunction(() => document.activeElement === document.body)
  await page.setViewportSize({ width: 1180, height: 960 })
  await expect(toggle).toBeHidden()
  await page.evaluate(() => window.__releaseDesktopMediaNotifications())
  await expect(toggle).toHaveAttribute('aria-expanded', 'false')
  expect(await page.evaluate(() => document.activeElement === document.body)).toBe(true)
})

test('击毁详情保持所属导航高亮，采集后台只有一个当前导航', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, async ({ url }) => {
    if (url.pathname === '/api/killboard/access/') return json({ can_view_killboard: true })
    if (url.pathname === '/api/killboard/reports/') return json({ count: 0, results: [] })
    if (url.pathname === '/api/killboard/reports/19748417/') return json({ kill_id: '19748417', ship_name: '回归样本', participants: [], items: [] })
    return json({})
  })
  await page.goto('/killboard/19748417')
  const navigation = page.getByRole('navigation', { name: '主导航', exact: true })
  const killboard = navigation.getByRole('link', { name: '击毁情报 KM', exact: true })
  const collector = navigation.getByRole('link', { name: '击毁采集后台', exact: true })
  await expect(killboard).toHaveAttribute('aria-current', 'page')
  await expect(killboard).toHaveClass(/active/)
  await expect(collector).not.toHaveAttribute('aria-current')
  await collector.click()
  await expect(page).toHaveURL(/\/killboard\/admin$/)
  await expect(collector).toHaveAttribute('aria-current', 'page')
  await expect(killboard).not.toHaveAttribute('aria-current')
  await expect(killboard).not.toHaveClass(/active/)
})

async function expectComfortableLayout(page) {
  await expect(page.locator('.app-shell')).toHaveAttribute('data-density', 'comfortable')
  await expect(page.getByRole('group', { name: '显示密度', exact: true, includeHidden: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^(紧凑|舒适)$/, includeHidden: true })).toHaveCount(0)
}

test('显示密度固定舒适，无切换控件，跨页面与刷新保持布局', async ({ page }) => {
  await page.goto('/planetary')
  await expectComfortableLayout(page)
  await page.getByRole('navigation', { name: '主导航', exact: true }).getByRole('link', { name: '防诈名单', exact: true }).click()
  await expectComfortableLayout(page)
  await page.reload()
  await expectComfortableLayout(page)
})

test('旧compact偏好无法读取或清理时仍使用舒适布局，折叠操作可用', async ({ page }) => {
  await page.addInitScript(() => {
    const originalGet = Storage.prototype.getItem
    const originalSet = Storage.prototype.setItem
    const originalRemove = Storage.prototype.removeItem
    originalSet.call(localStorage, 'evem-content-density', 'compact')
    Storage.prototype.getItem = function (key) {
      if (key.startsWith('evem-')) throw new DOMException('Blocked preference storage', 'SecurityError')
      return originalGet.call(this, key)
    }
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith('evem-')) throw new DOMException('Blocked preference storage', 'SecurityError')
      return originalSet.call(this, key, value)
    }
    Storage.prototype.removeItem = function (key) {
      if (key.startsWith('evem-')) throw new DOMException('Blocked preference storage', 'SecurityError')
      return originalRemove.call(this, key)
    }
  })
  await page.goto('/planetary')
  await expectComfortableLayout(page)
  await page.getByRole('button', { name: '收起导航', exact: true }).click()
  await expect(page.locator('.app-shell')).toHaveClass(/is-sidebar-collapsed/)
  await page.getByRole('button', { name: '展开导航', exact: true }).click()
  await expect(page.locator('.app-shell')).not.toHaveClass(/is-sidebar-collapsed/)
})

test('移动导航保持舒适布局，无密度切换控件且换页焦点正常', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/planetary')
  await page.locator('.mobile-menu-toggle').click()
  const navigation = page.getByRole('navigation', { name: '移动主导航' })
  await expectComfortableLayout(page)
  await navigation.getByRole('link', { name: '需求与反馈', exact: true }).click()
  await expect(navigation).toBeHidden()
  await expect(page.locator('#main-content')).toBeFocused()
  await expectComfortableLayout(page)
})

for (const width of [1440, 390]) {
  test(`旧compact保存值在${width}px被清理，首屏与刷新始终舒适且无密度控件`, async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('evem-content-density', 'compact')
      localStorage.setItem('unrelated-density-regression', 'preserve')
    })
    await page.setViewportSize({ width, height: 960 })
    await page.goto('/planetary')
    if (width < 1180) await page.locator('.mobile-menu-toggle').click()
    await expectComfortableLayout(page)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('evem-content-density'))).toBeNull()
    expect(await page.evaluate(() => localStorage.getItem('unrelated-density-regression'))).toBe('preserve')
    await page.reload()
    await expectComfortableLayout(page)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('evem-content-density'))).toBeNull()
  })
}
