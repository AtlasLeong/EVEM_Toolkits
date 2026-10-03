import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js'
import { installApiMock, json } from '../e2e/helpers/api.js'

// Same authenticated organization/snapshot/map contract as tactical.spec.js.
// Only HTTP data and the unavailable socket are mocked; page markup and CSS
// are the real lazy-loaded tactical workspace.
async function installTacticalFixture(page) {
  await page.routeWebSocket('**/ws/tactical/**', socket => socket.close({ code: 1000 }))
  await seedAuthenticatedSession(page, { user_id: 23 })
  const now = new Date().toISOString()
  const snapshot = {
    organization: { id: 1, name: '北境联合' },
    role: 'commander',
    user_id: 23,
    permission_version: 1,
    scope: { region_ids: [1], border_hops: 1, version: 1 },
    member_count: 8,
    online_count: 3,
    capacity: 100,
    online: [{ user_id: 23, display_name: '当前指挥', role: 'commander', joined_at: now, last_seen_at: now }],
    forces: [{
      id: 11,
      version: 1,
      name: '敌方前锋',
      side: 'enemy',
      system_id: 101,
      system_name: '德里克一',
      in_scope: true,
      people: 32,
      ships: { cruiser: 12 },
      notes: '前锋正在集结',
      observed_at: now,
      updated_at: now,
    }],
    reports: [{
      id: 21,
      version: 1,
      author_id: 23,
      author_name: '我的角色',
      system_id: 101,
      system_name: '德里克一',
      report_kind: 'system_count',
      people: 70,
      ships: { cruiser: 0 },
      notes: '自己的上报',
      in_scope: true,
      observed_at: now,
      updated_at: now,
      status: 'confirmed',
    }],
  }
  await installApiMock(page, ({ url, method, body }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') {
      return json({ organizations: [{ id: 1, name: '北境联合', role: 'commander', status: 'active' }] })
    }
    if (url.pathname.endsWith('/presence/')) {
      return json({ connection_id: body.connection_id, online_count: 3, capacity: 100, lease_seconds: 60 })
    }
    if (url.pathname.endsWith('/snapshot/')) return json(snapshot)
    if (url.pathname.endsWith('/map/')) {
      return json({
        systems: [
          { system_id: 101, constellation_id: 201, zh_name: '德里克一', x: 0, z: 0, security_status: 0.5 },
          { system_id: 102, constellation_id: 201, zh_name: '德里克二', x: 100, z: 30, security_status: -0.24 },
        ],
        stargates: [{ system_id: 101, destination_system_id: 102 }],
        regions: [],
        constellations: [{ constellation_id: 201, region_id: 1, zh_name: '德里克核心' }],
        boundary_exits: [{ system_id: 101, destination_system_id: 103, destination_name: '边界外星系' }],
        scope: snapshot.scope,
      })
    }
    if (url.pathname.endsWith('/catalog/')) {
      return json({ results: url.searchParams.get('kind') === 'regions'
        ? [{ id: 1, name: '德里克' }]
        : [{ id: 101, name: '德里克一', security_status: 0.5, region_name: '德里克' }] })
    }
    if (url.pathname.endsWith('/members/')) {
      return json({
        members: [{ id: 1, user_id: 23, display_name: '当前指挥', role: 'commander', status: 'active' }],
        applications: [],
        online: snapshot.online,
        member_count: 8,
        online_count: 3,
        capacity: 100,
      })
    }
    return json({})
  })
}

// Read the rendered foreground and composite every ancestor background.
// A transparent button must be measured against its actual selected card,
// not an assumed white canvas or the first convenient dark parent.
async function textContrast(locator) {
  return locator.evaluateAll(nodes => {
    const color = value => {
      const channels = (value.match(/[\d.]+/g) || []).map(Number)
      if (value.startsWith('color(srgb ')) {
        return [...channels.slice(0, 3).map(channel => channel * 255), channels[3] ?? 1]
      }
      return [...channels.slice(0, 3), channels[3] ?? 1]
    }
    const composite = (foreground, background) => foreground.slice(0, 3)
      .map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]))
    const luminance = channels => channels.map(channel => channel / 255)
      .map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
    return nodes.map(node => {
      const ancestors = []
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor)
      const background = ancestors.reduce((canvas, ancestor) =>
        composite(color(getComputedStyle(ancestor).backgroundColor), canvas), [255, 255, 255])
      const foreground = composite(color(getComputedStyle(node).color), background)
      const bright = Math.max(luminance(foreground), luminance(background))
      const dark = Math.min(luminance(foreground), luminance(background))
      return {
        text: node.textContent.trim(),
        foreground,
        background,
        contrast: (bright + 0.05) / (dark + 0.05),
      }
    })
  })
}

async function expectReadable(locator, label) {
  expect(await locator.count(), `${label} must exercise real rendered text`).toBeGreaterThan(0)
  const measurements = await textContrast(locator)
  expect.soft(measurements.filter(item => item.contrast < 4.5), `${label}: minimum text contrast 4.5:1`).toEqual([])
}

async function openTabletOverview(page) {
  await page.setViewportSize({ width: 820, height: 1180 })
  await installTacticalFixture(page)
  await page.goto('/tactical')
  // A fresh isolated Vite cache may need its first tactical chunk transformed.
  await expect(page.locator('.tac-board-mobile')).toBeVisible({ timeout: 20000 })
  const panel = page.getByRole('complementary', { name: '兵力总览与上报记录' })
  await expect(panel.locator('[data-force-row-id="11"]')).toBeVisible()
  return panel
}

test('phone tactical controls and strength readouts stay readable without page overflow', async ({ page }) => {
  await installTacticalFixture(page)
  await page.goto('/tactical')
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 })
    const panel = page.getByRole('complementary', { name: '兵力总览与上报记录' })
    await expect(panel.locator('[data-force-row-id="11"]')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
    await expectReadable(page.locator('.tac-side-filter button'), `${width}px allegiance controls`)
    await expectReadable(page.locator('.tac-add-force'), `${width}px manual deployment`)
    await expectReadable(page.locator('.tac-connection, .tac-role, .tac-scope-label'), `${width}px connection and scope`)
    await expectReadable(page.locator('.tac-strength-heading > span, .tac-strength-heading small, .tac-strength-notes'), `${width}px strength context`)
    await expectReadable(page.locator('.tac-mobile-note'), `${width}px map instructions`)
    const enemy = panel.getByRole('button', { name: '仅敌方', exact: true })
    await enemy.focus()
    await page.keyboard.press('Enter')
    await expect(enemy).toHaveAttribute('aria-pressed', 'true')
    await expectReadable(enemy, `${width}px selected allegiance`)
  }
})

test('portalled create organization dialog keeps body labels and help readable in both form modes', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url }) => url.pathname.endsWith('/organizations/') ? json({ organizations: [] }) : json({}))
  await page.goto('/tactical')
  await page.getByRole('button', { name: '创建或加入组织' }).click()
  const dialog = page.getByRole('dialog', { name: '创建或加入组织' })
  await expect(dialog.getByLabel('组织名称')).toBeVisible()
  await expectReadable(dialog.locator('.tac-muted'), 'create organization body help')
  await expectReadable(dialog.locator('.tac-field > span'), 'create organization field label')
  await expect.soft(dialog.locator('.tac-segmented')).toHaveCSS('background-color', 'rgb(11, 23, 29)', { timeout: 1500 })
  await expect.soft(dialog.locator('.tac-segmented button[aria-pressed="true"]')).toHaveCSS('background-color', 'rgb(25, 50, 61)', { timeout: 1500 })
  await expect.soft(dialog.locator('.tac-segmented button[aria-pressed="true"]')).toHaveCSS('color', 'rgb(239, 181, 102)', { timeout: 1500 })
  await dialog.getByRole('button', { name: '申请加入', exact: true }).click()
  await expect(dialog.getByLabel('邀请码')).toBeVisible()
  await expectReadable(dialog.locator('.tac-muted'), 'join organization body help')
  await expectReadable(dialog.locator('.tac-field > span'), 'join organization field label')
})

test('new board dialog options use dark console surfaces and amber selection through real interaction', async ({ page }) => {
  await installTacticalFixture(page)
  await page.goto('/tactical')
  const add = page.getByRole('button', { name: '新建战术板', exact: true })
  await expect(add).toBeVisible()
  await expect.soft(add).toHaveCSS('background-color', 'rgb(18, 37, 46)', { timeout: 1500 })
  await add.click()
  const dialog = page.getByRole('dialog', { name: '新建战术板' })
  const options = dialog.locator('.tac-board-kind-option')
  await expect(options).toHaveCount(2)
  await expectReadable(dialog.locator('.tac-muted'), 'new board scope help')
  await expectReadable(dialog.locator('.tac-field > span, .tac-board-kind-field > legend'), 'new board field labels')
  await expectReadable(dialog.locator('.tac-board-kind-copy small'), 'new board option descriptions')
  const selected = dialog.locator('.tac-board-kind-option[aria-pressed="true"]')
  const unselected = dialog.locator('.tac-board-kind-option[aria-pressed="false"]')
  await expect.soft(unselected).toHaveCSS('background-color', 'rgb(18, 37, 46)', { timeout: 1500 })
  await expect.soft(selected).toHaveCSS('background-color', 'rgb(25, 50, 61)', { timeout: 1500 })
  await expect.soft(selected).toHaveCSS('border-top-color', 'rgb(239, 181, 102)', { timeout: 1500 })
  await unselected.hover()
  await expect.soft(unselected).toHaveCSS('background-color', 'rgb(25, 50, 61)', { timeout: 1500 })
  await unselected.click()
  await expect(dialog.locator('.tac-board-kind-option[aria-pressed="true"]')).toHaveCount(1)
  await expect.soft(dialog.locator('.tac-board-kind-option[aria-pressed="true"]')).toHaveCSS('border-top-color', 'rgb(239, 181, 102)', { timeout: 1500 })
  for (const icon of await dialog.locator('.tac-board-kind-icon').all()) {
    await expect.soft(icon).toHaveCSS('background-color', 'rgb(23, 52, 71)', { timeout: 1500 })
  }
})

test('820px selected force keeps its title, location and quantities readable', async ({ page }) => {
  const panel = await openTabletOverview(page)
  const card = panel.locator('[data-force-row-id="11"]')
  await expectReadable(card.locator('.tac-force-count'), 'unselected force count')
  await card.locator('.tac-force-main').click()
  await expect(card).toHaveClass(/is-selected/)
  await expect(card.locator('.tac-force-details')).toBeVisible()
  await expect(card.locator('.tac-force-title > strong')).toHaveText('敌方前锋')
  await expect(card.locator('.tac-ship-summary b')).toHaveText('12')
  await expectReadable(card.locator('.tac-force-title > strong'), 'selected force title')
  await expectReadable(card.locator('.tac-force-location, .tac-age, .tac-fleet-source'), 'selected force metadata')
  await expectReadable(card.locator('.tac-force-count, .tac-ship-summary b'), 'selected force quantities')
  await expectReadable(card.locator('.tac-force-details > small'), 'selected force edit timestamp')
})

test('820px report tab count remains readable in inactive and active states', async ({ page }) => {
  const panel = await openTabletOverview(page)
  const reports = panel.getByRole('button', { name: '上报记录', exact: true })
  await expect(reports.locator('span')).toHaveText('1')
  await expectReadable(reports.locator('span'), 'inactive report tab count')
  await reports.click()
  await expect(reports).toHaveAttribute('aria-pressed', 'true')
  await expectReadable(reports.locator('span'), 'active report tab count')
})

test('820px overview scope and count metadata stay readable after switching scope', async ({ page }) => {
  const panel = await openTabletOverview(page)
  const scope = panel.getByRole('group', { name: '统计范围' })
  const current = scope.getByRole('button', { name: '当前战区', exact: true })
  const all = scope.getByRole('button', { name: '组织全部', exact: true })
  await expect(current).toHaveAttribute('aria-pressed', 'true')
  await expectReadable(scope.getByRole('button'), 'current-scope buttons')
  await expect(panel.locator('.tac-count-row small')).toContainText('我的角色')
  await expectReadable(panel.locator('.tac-count-row small'), 'system report attribution')
  await all.click()
  await expect(all).toHaveAttribute('aria-pressed', 'true')
  await expect(current).toHaveAttribute('aria-pressed', 'false')
  await expectReadable(scope.getByRole('button'), 'all-scope buttons')
})

test('desktop map search result names and details remain readable when hovered', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 })
  await installTacticalFixture(page)
  await page.goto('/tactical')
  await expect(page.locator('.tac-immersive')).toBeVisible({ timeout: 20000 })
  await page.getByLabel('搜索当前星图', { exact: true }).fill('德里克一')
  const results = page.locator('.tac-map-search-results')
  const result = results.getByRole('option').filter({ hasText: '德里克一' })
  await expect(result).toBeVisible()
  await expectReadable(result, 'desktop map search result name')
  await expectReadable(result.locator('small'), 'desktop map search result details')
  await result.hover()
  await expectReadable(result, 'hovered desktop map search result name')
  await expectReadable(result.locator('small'), 'hovered desktop map search result details')
})
