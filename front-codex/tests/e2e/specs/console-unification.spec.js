import { expect, test } from '@playwright/test'
import { installApiMock, json } from '../helpers/api'
import { seedAuthenticatedSession } from '../helpers/auth'
import { communityFixture } from '../helpers/community'

// Same authenticated draft/catalog contract used by starsea.spec.js. Only
// network data is mocked; every interaction below uses the real editor UI.
async function starseaConsoleFixture(page, { rejected = false } = {}) {
  await seedAuthenticatedSession(page, { user_id: 55 })
  let entry = {
    id: 1, author_name: 'atlas123', is_listed: true, published_revision_id: null,
    revision: {
      id: 10, version: 1, status: rejected ? 'rejected' : 'draft',
      review_reason: rejected ? '战损字段需要补全' : '',
      content: {
        kind: 'battle', title: '边境交锋', body: '', occurred_at: null,
        location: null, corporation_id: null, images: [],
        battle: { sides: [
          { name: 'A方', isk_loss: null, losses: [] },
          { name: 'B方', isk_loss: null, losses: [] },
        ] },
      },
    },
  }
  await installApiMock(page, ({ url, method, body }) => {
    const path = url.pathname
    if (!path.includes('/starsea/')) return json({ results: [], count: 0 })
    if (path.endsWith('/capabilities/')) return json({ can_review: true })
    if (path.endsWith('/locations/')) return json({ results: [{ id: 1, name: '卡尼迪' }] })
    if (path.endsWith('/corporations/')) return json({ results: [{ id: 1, name: '远航军团' }] })
    if (path.endsWith('/ships/')) return json({
      results: [{ id: 7, name: '灾难级', ship_class: '战列舰', source_version: 'SWEET 218811' }],
      count: 1, notice: '本地快照，不保证当前国服完整',
    })
    if (method !== 'GET') {
      if (body?.content) entry = { ...entry, revision: { ...entry.revision, version: entry.revision.version + 1, content: body.content } }
      return json(entry)
    }
    if (path.endsWith('/posts/') || path.endsWith('/mine/') || path.endsWith('/reviews/')) return json({ count: 1, results: [entry] })
    return json(entry)
  })
}

async function expectConsoleReadable(locator, label) {
  expect(await locator.count(), `${label} exercises actual rendered text`).toBeGreaterThan(0)
  const measurements = await locator.evaluateAll(nodes => {
    const color = value => {
      const channels = (value.match(/[\d.]+/g) || []).map(Number)
      return [...channels.slice(0, 3), channels[3] ?? 1]
    }
    const composite = (foreground, background) => foreground.slice(0, 3).map((channel, index) => channel * foreground[3] + background[index] * (1 - foreground[3]))
    const luminance = channels => channels.map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0)
    return nodes.map(node => {
      const ancestors = []
      for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor)
      const background = ancestors.reduce((canvas, ancestor) => composite(color(getComputedStyle(ancestor).backgroundColor), canvas), [255, 255, 255])
      const foreground = composite(color(getComputedStyle(node).color), background)
      return { text: node.textContent.trim(), foreground, background, contrast: (Math.max(luminance(foreground), luminance(background)) + 0.05) / (Math.min(luminance(foreground), luminance(background)) + 0.05) }
    })
  })
  expect.soft(measurements.filter(item => item.contrast < 4.5), `${label}: minimum contrast 4.5:1`).toEqual([])
}

test('starsea editor selected ship and sticky state stay readable after real catalog selection', async ({ page }) => {
  await starseaConsoleFixture(page)
  await page.goto('/starsea/new')
  await expect(page.getByRole('heading', { name: '发布见闻', exact: true })).toBeVisible()
  await page.getByLabel('标题', { exact: true }).fill('边境交锋')
  await page.getByRole('button', { name: 'A方添加损失' }).click()
  await page.getByLabel('A方第1行搜索舰船').fill('灾难')
  await page.getByRole('button', { name: /选择灾难级/ }).click()
  const selection = page.locator('.ss-selected-ship')
  await expect(selection).toContainText('灾难级')
  await expectConsoleReadable(selection, 'selected catalog ship name')
  await expectConsoleReadable(selection.locator('small'), 'selected catalog ship metadata')
  await expectConsoleReadable(page.locator('.ss-editor-toolbar > span'), 'sticky unsaved draft status')
})

test('starsea paste preview stays readable before confirming actual import', async ({ page }) => {
  await starseaConsoleFixture(page)
  await page.goto('/starsea/new')
  await expect(page.getByRole('heading', { name: '发布见闻', exact: true })).toBeVisible()
  await page.getByText('批量粘贴清单', { exact: true }).nth(1).click()
  await page.getByLabel('B方粘贴清单').fill('护卫舰,未知,2')
  await page.getByRole('button', { name: 'B方预览清单' }).click()
  const preview = page.locator('.ss-paste-preview')
  await expect(preview.getByText('待导入 1 行')).toBeVisible()
  await expectConsoleReadable(preview.locator(':scope > strong, :scope > div'), 'pending paste import rows')
  await expectConsoleReadable(preview.locator('.ss-muted'), 'pending paste import help')
  await page.getByRole('button', { name: 'B方确认导入' }).click()
  await expect(page.getByLabel('B方第1行数量')).toHaveValue('2')
})

test('starsea returned draft reason stays readable in the actual private listing', async ({ page }) => {
  await starseaConsoleFixture(page, { rejected: true })
  await page.goto('/starsea/mine')
  const reason = page.locator('.ss-review-reason')
  await expect(reason).toHaveText('退回原因：战损字段需要补全')
  await expectConsoleReadable(reason, 'returned draft correction reason')
})

test('starmap destructive ghost control keeps danger semantics before and during hover', async ({ page }) => {
  await installApiMock(page, ({ url }) => url.pathname === '/api/boardsystems'
    ? json([{ system_id: 1, zh_name: '阿尔法', en_name: 'ALPHA-1', x: 0, y: 0, z: 0, security_status: 0.5 }])
    : json([]))
  await page.goto('/starmap')
  await page.getByLabel('搜索并定位星系').fill('alpha')
  await page.locator('.tactical-search-option').first().click()
  await page.getByRole('button', { name: '设为起点', exact: true }).click()
  const clear = page.getByRole('button', { name: '清除起终点', exact: true })
  await expect(clear).toBeEnabled()
  const danger = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--danger').trim())
  const normalizedDanger = danger.match(/^#[0-9a-f]{6}$/i)
    ? `rgb(${parseInt(danger.slice(1, 3), 16)}, ${parseInt(danger.slice(3, 5), 16)}, ${parseInt(danger.slice(5, 7), 16)})` : danger
  await expect.soft(clear).toHaveCSS('color', normalizedDanger)
  await clear.hover()
  await expect.soft(clear).toHaveCSS('color', normalizedDanger)
  await clear.click()
  await expect(page.getByLabel('起点星系')).toHaveValue('')
})

test('corporation cover labels use a readable dark surface', async ({ page }) => {
  await communityFixture(page)
  await page.goto('/corporations')
  const label = page.locator('.corp-card-kicker').first()
  await expect(label).toBeVisible()
  await expect(label).toHaveCSS('background-color', 'rgb(25, 50, 61)')
  await expect(label).toHaveCSS('color', 'rgb(232, 240, 241)')
})

test('starsea excerpts and active filter context stay readable on the dark surface', async ({ page }) => {
  await installApiMock(page, ({ url }) => {
    if (url.pathname.endsWith('/posts/')) return json({ count: 1, results: [{
      id: 1, author_name: '测试飞行员', is_listed: true,
      revision: { id: 10, status: 'approved', content: { kind: 'story', title: '边境见闻', body: '探索新伊甸的星海', images: [], corporation_id: 1 } },
    }] })
    return json({ results: [] })
  })
  await page.goto('/starsea?corporation_id=1')
  for (const selector of ['.ss-excerpt', '.ss-filter-context']) {
    await expect(page.locator(selector)).toBeVisible()
    await expect(page.locator(selector)).toHaveCSS('color', 'rgb(155, 177, 184)')
  }
})

test('tactical dialog header stays readable after its lazy stylesheet loads', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url }) => {
    if (url.pathname.endsWith('/organizations/')) return json({ organizations: [] })
    return json({})
  })
  await page.goto('/tactical')
  await page.getByRole('button', { name: '创建或加入组织' }).click()
  const dialog = page.getByRole('dialog', { name: '创建或加入组织' })
  await expect(dialog.locator('.tac-dialog-head')).toHaveCSS('background-color', 'rgb(18, 37, 46)')
  await expect(dialog.getByRole('heading')).toHaveCSS('color', 'rgb(232, 240, 241)')
})

test('primary workspaces share title scale, dark shell and content gutters after lazy navigation', async ({ page }) => {
  await installApiMock(page, () => json([]))
  const routes = [
    ['/starmap', '.page-head h1', '星系导航'],
    ['/manufacturing', '.manufacturing-page-header h1', '制造估价'],
    ['/market', '.market-terminal-heading h1', '市场价格'],
    ['/fraudlist', '.page-head h1', '防诈名单'],
  ]
  await page.goto('/starmap')
  for (const [route, selector, name] of routes) {
    await page.locator('.shell-sidebar').getByRole('link', { name, exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`${route}$`))
    const title = page.locator(selector)
    await expect(title).toBeVisible()
    await expect(title).toHaveCSS('font-size', '28px')
    await expect(page.locator('.shell-main')).toHaveCSS('padding-left', '24px')
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(11, 23, 29)')
    // Lazy navigation has a short entry animation; assert the settled geometry.
    await expect.poll(async () => Math.round((await title.boundingBox()).x)).toBe(264)
  }
  await expect(page.locator('.shell-sidebar')).toHaveCSS('color-scheme', 'dark')
})

test('pending client icons keep a stable placeholder until the real asset arrives', async ({ page }) => {
  await installApiMock(page, () => json([]))
  let release
  const gate = new Promise(resolve => { release = resolve })
  await page.route('**/images/game-items/**', async route => { await gate; await route.continue() })
  try {
    await page.goto('/manufacturing', { waitUntil: 'domcontentloaded' })
    const image = page.locator('.manufacturing-selected-target img')
    await expect(image).toHaveAttribute('data-loaded', 'false')
    const before = await image.boundingBox()
    expect(before.width).toBe(40)
    expect(before.height).toBe(40)
    release()
    await expect(image).toHaveAttribute('data-loaded', 'true')
    expect(await image.boundingBox()).toEqual(before)
    expect(await image.evaluate(node => node.naturalWidth)).toBeGreaterThan(0)
  } finally { release() }
})

for (const width of [1024, 820, 768, 390]) {
  test(`manufacturing flows vertically at ${width}px without squeezed columns`, async ({ page }) => {
    await installApiMock(page, () => json([]))
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/manufacturing')
    const config = page.getByTestId('manufacturing-config-rail')
    const route = page.getByTestId('manufacturing-route-workspace')
    const cost = page.getByTestId('manufacturing-cost-rail')
    await expect(config).toBeVisible()
    const boxes = await Promise.all([config, route, cost].map(locator => locator.boundingBox()))
    expect(boxes[1].y).toBeGreaterThanOrEqual(boxes[0].y + boxes[0].height)
    expect(boxes[2].y).toBeGreaterThanOrEqual(boxes[1].y + boxes[1].height)
    expect(boxes[0].width).toBeGreaterThan(width - 65)
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    for (const name of ['切换制造目标', '增加制造数量', '减少制造数量']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox()
      expect(box.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: `test-results/console-manufacturing-${width}.png`, fullPage: true })
  })
}

test('manufacturing icons start eagerly and quantity updates preserve geometry', async ({ page }) => {
  await installApiMock(page, () => json([]))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/manufacturing')
  const targetImage = page.locator('.manufacturing-selected-target img')
  await expect(targetImage).toHaveAttribute('loading', 'eager')
  await expect(targetImage).toHaveAttribute('fetchpriority', 'high')
  await expect(targetImage).toHaveAttribute('data-loaded', 'true')
  const control = page.locator('.manufacturing-quantity-control')
  const before = await control.boundingBox()
  await page.getByRole('button', { name: '增加制造数量' }).click()
  await expect(page.getByRole('spinbutton', { name: '制造数量' })).toHaveValue('2')
  expect(await control.boundingBox()).toEqual(before)
  await expect(control).toHaveCSS('transform', 'none')
  await page.getByRole('button', { name: '切换制造目标' }).click()
  const dialog = page.getByRole('dialog', { name: '选择制造目标' })
  await dialog.getByRole('searchbox').fill('莫洛级')
  await dialog.getByRole('option', { name: '莫洛级', exact: true }).click()
  await expect(targetImage).toHaveAttribute('data-loaded', 'true')
  const firstLevel = page.locator('.manufacturing-tree > li > .manufacturing-tree-children > li > .manufacturing-tree-row img')
  expect(await firstLevel.count()).toBeGreaterThan(0)
  for (const icon of await firstLevel.all()) await expect(icon).toHaveAttribute('loading', 'eager')
  await page.screenshot({ path: 'test-results/console-manufacturing-desktop.png' })
})
