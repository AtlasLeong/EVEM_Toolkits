import { test, expect } from '@playwright/test'
import { seedAuthenticatedSession } from '../e2e/helpers/auth.js'
import { installApiMock, json } from '../e2e/helpers/api.js'

test('organization creation offers both board types and submits the chosen type', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let created = null
  await installApiMock(page, ({ url, method, body }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [] })
    if (url.pathname.endsWith('/organizations/') && method === 'POST') {
      created = body
      return json({ ok: true, result: { id: 7, name: body.name, role: 'founder', status: 'active',
        boards: [{ id: 71, name: '海盗情报板', kind: 'pirate' }] } })
    }
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({ board: { id: 71, name: '海盗情报板', kind: 'pirate',
      scope: { region_ids: [], border_hops: 0, version: 1 } }, role: 'founder', user_id: 23,
      permission_version: 1, sightings: [], target_count: 0, server_time: new Date().toISOString() })
    return json({})
  })
  await page.goto('/tactical')
  await page.getByRole('button', { name: '创建或加入组织' }).click()
  const form = page.getByRole('dialog', { name: '创建或加入组织' })
  await expect(form.getByRole('button', { name: /战争沙盘板/ })).toBeVisible()
  await form.getByRole('button', { name: /海盗情报板/ }).click()
  await form.getByLabel('组织名称').fill('巡猎小队')
  await form.locator('.tac-form-footer').getByRole('button', { name: '创建组织', exact: true }).click({ noWaitAfter: true })
  await expect.poll(() => created?.board_type).toBe('pirate')
})

test('pirate board shows target identity and opens an independent sighting form', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'scout', status: 'active', boards: [{ id: 71, name: '夜巡', kind: 'pirate' }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({ board: { id: 71, name: '夜巡', kind: 'pirate' },
      role: 'scout', user_id: 23, permission_version: 1, scope: { region_ids: [1], border_hops: 0, version: 1 },
      target_count: 1, server_time: new Date().toISOString(), sightings: [{ id: 4, version: 1,
        character_name: 'Pilot', ship_type: 'Nyx', target_key: ['pilot', 'nyx'],
        location_kind: 'system', location_id: 101, location_name: '德里克一', observed_at: new Date().toISOString(),
        activity_start_utc: '23:00', activity_end_utc: '02:00', notes: '夜间出现', status: 'active',
        author_id: 23, author_name: 'atlas123' }] })
    if (url.pathname.endsWith('/boards/71/map/')) return json({ systems: [
      { system_id: 101, name: 'Derelik I', zh_name: '德里克一', x: 10, z: 10, constellation_id: 44 },
      { system_id: 102, name: 'Derelik II', zh_name: '德里克二', x: 30, z: 30, constellation_id: 44 },
    ], stargates: [{ system_id: 101, destination_system_id: 102 }], constellations: [], regions: [],
      scope: { region_ids: [1], border_hops: 0, version: 1 } })
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await expect(page.getByRole('heading', { name: '海盗情报板' })).toBeVisible()
  await expect(page.getByText('Pilot · Nyx')).toBeVisible()
  await expect(page.locator('.pirate-target-row').getByText('德里克一 · 精确星系')).toBeVisible()
  await page.getByRole('button', { name: '上报目标线索' }).click()
  const form = page.getByRole('dialog', { name: '上报目标线索' })
  await expect(form.getByLabel('目标角色名')).toBeVisible()
  await expect(form.getByLabel('精确船型')).toBeVisible()
  await expect(form.getByRole('button', { name: '星座范围' })).toBeVisible()
})

test('pirate workspace keeps the map full-size with floating search, target and current-time hint', async ({ page }) => {
  await page.setViewportSize({ width: 1100, height: 800 })
  await seedAuthenticatedSession(page, { user_id: 23 })
  const observed = '2020-01-01T12:00:00Z'
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active', boards: [{ id: 71, name: '夜巡', kind: 'pirate' }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json({ board: { id: 71, name: '夜巡', kind: 'pirate' },
      role: 'founder', user_id: 23, permission_version: 1, scope: { region_ids: [1], border_hops: 0, version: 1 },
      target_count: 1, server_time: '2020-01-01T12:30:00Z', sightings: [{ id: 4, version: 1,
        character_name: '夜航员', ship_type: '夜神级', target_key: ['夜航员', '夜神级'],
        location_kind: 'system', location_id: 101, location_name: '德里克一', observed_at: observed,
        activity_start_utc: '12:00', activity_end_utc: '13:00', notes: '夜间出现', status: 'active',
        author_id: 23, author_name: 'atlas123' }] })
    if (url.pathname.endsWith('/boards/71/map/')) return json(pirateMap())
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  const workspace = page.locator('.pirate-immersive')
  const map = workspace.locator('.pirate-map-frame')
  await expect(map).toBeVisible()
  await expect(workspace.getByRole('searchbox', { name: '搜索目标线索' })).toBeVisible()
  await expect(workspace.getByRole('region', { name: '当前时段可能活跃' })).toContainText('夜航员')
  const workspaceBox = await workspace.boundingBox()
  const mapBox = await map.boundingBox()
  expect(mapBox.width).toBeGreaterThan(workspaceBox.width * .95)
  expect(mapBox.height).toBeGreaterThan(workspaceBox.height * .9)
  const zoomToolbarBox = await workspace.locator('.pirate-map__toolbar').boundingBox()
  expect(zoomToolbarBox.y + zoomToolbarBox.height).toBeLessThanOrEqual(800)
  const search = workspace.getByRole('searchbox', { name: '搜索目标线索' })
  expect(await search.evaluate(input => getComputedStyle(input).borderTopWidth)).toBe('0px')
  const targetCard = workspace.locator('.pirate-map__target-card')
  await expect(targetCard).toBeVisible()
  await expect(targetCard).not.toHaveClass(/pirate-map__target-card--historical/)
  await expect(workspace.locator('.pirate-target-row')).toContainText('分钟前观察')
  const cardBox = await targetCard.boundingBox()
  const commandBox = await workspace.locator('.pirate-board-head').boundingBox()
  const panelBox = await workspace.locator('.pirate-target-panel').boundingBox()
  const overlaps = (a, b) => a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
  expect(overlaps(cardBox, commandBox)).toBe(false)
  expect(overlaps(cardBox, panelBox)).toBe(false)
  await workspace.getByRole('button', { name: '收起' }).click()
  await expect(workspace.locator('.pirate-target-row')).toBeHidden()
  await search.fill('夜航员')
  await expect(workspace.locator('.pirate-target-row')).toBeVisible()
  await workspace.getByRole('region', { name: '当前时段可能活跃' }).getByRole('button', { name: /夜航员/ }).click()
  await expect(workspace.getByRole('region', { name: '目标详情' })).toBeVisible()
  await workspace.getByRole('button', { name: '关闭目标详情' }).click()
  await targetCard.click()
  await expect(workspace.getByRole('region', { name: '目标详情' })).toContainText('夜航员')
})

for (const width of [1100, 1200, 1440]) test(`${width}px desktop detail keeps its star and floating card outside the right panel`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 })
  await seedAuthenticatedSession(page, { user_id: 23 })
  const target = { ...sighting(4), location_id: 104, location_name: '第四星系' }
  const systems = Array.from({ length: 5 }, (_, index) => ({
    system_id: 101 + index, region_id: 1, constellation_id: 44,
    name: `System ${index + 1}`, x: index * 10, z: 0,
  }))
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json(pirateSnapshot(71, [target]))
    if (url.pathname.endsWith('/boards/71/map/')) return json({ systems, stargates: [],
      scope: { region_ids: [1], border_hops: 0, version: 1 } })
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  const workspace = page.locator('.pirate-immersive')
  const star = workspace.locator('[data-pirate-marker="system:104"]')
  const card = workspace.locator('[data-pirate-card="system:104"]')
  await expect(star).toBeVisible()
  await expect(card).toBeVisible()
  const starWorldX = await workspace.locator('.pirate-map__star').nth(3).getAttribute('cx')
  await workspace.locator('.pirate-target-row').click()
  const detail = workspace.getByRole('region', { name: '目标详情' })
  await expect(detail).toBeVisible()
  await expect.poll(async () => {
    const [starBox, cardBox, detailBox] = await Promise.all([
      star.boundingBox(), card.boundingBox(), detail.boundingBox(),
    ])
    return starBox.x + starBox.width <= detailBox.x && cardBox.x + cardBox.width <= detailBox.x
  }).toBe(true)
  expect(await workspace.locator('.pirate-map__star').nth(3).getAttribute('cx')).toBe(starWorldX)
})

test('reselecting an open target recenters its marker after the map is dragged away', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 800 })
  await seedAuthenticatedSession(page, { user_id: 23 })
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) return json(pirateSnapshot(71, [sighting(4)]))
    if (url.pathname.endsWith('/boards/71/map/')) return json(pirateMap())
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  const workspace = page.locator('.pirate-immersive')
  const row = workspace.locator('.pirate-target-row')
  await row.click()
  const detail = workspace.getByRole('region', { name: '目标详情' })
  const marker = workspace.locator('[data-pirate-marker="system:101"]')
  await expect(detail).toBeVisible()
  await expect(marker).toBeVisible()
  const map = await workspace.locator('.pirate-map-frame').boundingBox()
  const before = await marker.boundingBox()
  const gestureY = map.y + map.height - 115
  await page.mouse.move(map.x + map.width / 2, gestureY)
  await page.mouse.down()
  await page.mouse.move(map.x + map.width / 2 + 300, gestureY, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await marker.boundingBox()).x).toBeGreaterThan(before.x + 200)
  await row.click()
  await expect.poll(async () => {
    const [markerBox, detailBox] = await Promise.all([marker.boundingBox(), detail.boundingBox()])
    return markerBox.x + markerBox.width <= detailBox.x
  }).toBe(true)
})

const observedAt = '2026-09-24T04:00:00Z'

function sighting(id, { locationKind = 'system', status = 'active' } = {}) {
  return { id, version: status === 'active' ? 1 : 2, character_name: '夜航员', ship_type: '夜神级',
    target_key: ['夜航员', '夜神级'], location_kind: locationKind,
    location_id: locationKind === 'system' ? 101 : 44,
    location_name: locationKind === 'system' ? '德里克一' : '德里克星座',
    observed_at: observedAt, activity_start_utc: null, activity_end_utc: null,
    notes: '夜间巡航', status, author_id: 23, author_name: 'atlas123' }
}

function pirateSnapshot(boardId, sightings = [], role = 'founder') {
  return { board: { id: boardId, name: boardId === 71 ? '夜巡' : '第二块情报板', kind: 'pirate' },
    role, user_id: 23, permission_version: 1,
    scope: { region_ids: [1], border_hops: 0, version: 1 },
    target_count: sightings.filter(row => row.status === 'active').length,
    sightings, server_time: observedAt }
}

function pirateMap() {
  return { systems: [
    { system_id: 101, name: 'Derelik I', zh_name: '德里克一', x: 10, z: 10, constellation_id: 44 },
    { system_id: 102, name: 'Derelik II', zh_name: '德里克二', x: 30, z: 30, constellation_id: 44 },
  ], stargates: [{ system_id: 101, destination_system_id: 102 }], constellations: [], regions: [],
    scope: { region_ids: [1], border_hops: 0, version: 1 } }
}

test('an existing organization creates a second board and switches between isolated contents', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let created = null
  await installApiMock(page, ({ url, method, body }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
    ] })
    if (url.pathname.endsWith('/organizations/7/boards/') && method === 'POST') {
      created = body
      return json({ ok: true, result: { id: 72, name: body.name, kind: body.kind, is_default: false } })
    }
    if (url.pathname.endsWith('/boards/71/pirate/')) return json(pirateSnapshot(71, [sighting(4)]))
    if (url.pathname.endsWith('/boards/72/pirate/')) return json(pirateSnapshot(72))
    if (url.pathname.endsWith('/boards/71/map/') || url.pathname.endsWith('/boards/72/map/')) return json(pirateMap())
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await expect(page.locator('.pirate-target-row')).toHaveCount(1)
  await page.getByRole('button', { name: '新建战术板' }).click()
  const form = page.getByRole('dialog', { name: '新建战术板' })
  await form.getByRole('button', { name: /海盗情报板/ }).click()
  await form.getByLabel('板名称').fill('第二块情报板')
  await form.getByRole('button', { name: '创建战术板' }).click()
  await expect.poll(() => created?.kind).toBe('pirate')
  await expect(page).toHaveURL(/board=72/)
  await expect(page.getByRole('group', { name: '选择战术板' }).getByRole('button', { name: /第二块情报板/ })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.pirate-target-row')).toHaveCount(0)
  await page.getByRole('group', { name: '选择战术板' }).getByRole('button', { name: /夜巡/ }).click()
  await expect(page).toHaveURL(/board=71/)
  await expect(page.locator('.pirate-target-row')).toContainText(['夜航员 · 夜神级'])
})

for (const [kind, location, catalogKind] of [
  ['system', '德里克一', 'systems'],
  ['constellation', '德里克星座', 'constellations'],
]) test(`pirate sighting at ${kind} precision appears and can be withdrawn without deleting history`, async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let rows = []
  const commands = []
  await installApiMock(page, ({ url, method, body }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'founder', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/') && method === 'GET') return json(pirateSnapshot(71, rows))
    if (url.pathname.endsWith('/boards/71/map/')) return json(pirateMap())
    if (url.pathname.endsWith('/catalog/')) return json({ results: url.searchParams.get('kind') === catalogKind
      ? [{ id: kind === 'system' ? 101 : 44, name: location, region_name: '德里克', security_status: 0.5 }]
      : [] })
    if (url.pathname.endsWith('/boards/71/pirate/commands/') && method === 'POST') {
      commands.push(body)
      if (body.action === 'sighting.create') rows = [sighting(4, { locationKind: kind })]
      if (body.action === 'sighting.withdraw') rows = [sighting(4, { locationKind: kind, status: 'withdrawn' })]
      return json({ ok: true, result: rows[0] })
    }
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await page.getByRole('button', { name: '上报目标线索' }).click()
  const form = page.getByRole('dialog', { name: '上报目标线索' })
  await form.getByLabel('目标角色名').fill('夜航员')
  await form.getByLabel('精确船型').fill('夜神级')
  if (kind === 'constellation') await form.getByRole('button', { name: '星座范围' }).click()
  await form.getByLabel(kind === 'system' ? '搜索星系' : '搜索星座').fill('德里克')
  await form.getByRole('group', { name: kind === 'system' ? '搜索星系结果' : '搜索星座结果' })
    .getByRole('button', { name: new RegExp(location) }).click()
  await form.getByRole('button', { name: '提交线索' }).click()
  await expect.poll(() => commands[0]?.location_kind).toBe(kind)
  expect(commands[0].location_id).toBe(kind === 'system' ? 101 : 44)
  await expect(page.locator('.pirate-target-row')).toContainText([location])
  await page.locator('.pirate-target-row').click()
  const detail = page.getByRole('region', { name: '目标详情' })
  await expect(detail).toContainText(`${location} · ${kind === 'system' ? '精确星系' : '星座范围'}`)
  await detail.getByRole('button', { name: '撤下' }).click()
  const confirmation = page.getByRole('dialog', { name: '撤下目标线索' })
  await expect(confirmation).toContainText('历史仍会保留')
  await confirmation.getByRole('button', { name: '确认撤下' }).click()
  await expect.poll(() => commands[1]?.action).toBe('sighting.withdraw')
  expect(commands[1].id).toBe(4)
  expect(commands[1].expected_version).toBe(1)
  await expect(page.locator('.pirate-target-row')).toContainText(['已撤下'])
  await expect(detail).toContainText('已撤下')
})

for (const width of [390, 900]) {
  test(`${width}px layout keeps the target list first, opens details before the map, and defers map traffic`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 })
    await seedAuthenticatedSession(page, { user_id: 23 })
    let mapRequests = 0
    await installApiMock(page, ({ url, method }) => {
      if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
        { id: 7, name: '巡猎小队', role: 'scout', status: 'active',
          boards: [{ id: 71, name: '夜巡', kind: 'pirate', is_default: true }] },
      ] })
      if (url.pathname.endsWith('/boards/71/pirate/')) return json(pirateSnapshot(71, [sighting(4)], 'scout'))
      if (url.pathname.endsWith('/boards/71/map/')) { mapRequests++; return json(pirateMap()) }
      return json({})
    })
    await page.goto('/tactical?organization=7&board=71')
    const list = page.getByRole('complementary', { name: '目标线索列表' })
    await expect(list.getByText('夜航员 · 夜神级')).toBeVisible()
    const refreshBox = await page.getByRole('button', { name: '刷新目标线索' }).boundingBox()
    expect(refreshBox.width).toBeGreaterThanOrEqual(44)
    expect(refreshBox.height).toBeGreaterThanOrEqual(44)
    const map = page.locator('.pirate-map-frame')
    await expect(map).toBeHidden()
    expect(mapRequests).toBe(0)
    await list.getByRole('button', { name: /夜航员 · 夜神级/ }).click()
    const detail = page.getByRole('region', { name: '目标详情' })
    await expect(detail).toBeVisible()
    const detailBox = await detail.boundingBox()
    const toggleBox = await page.getByRole('button', { name: '查看星图' }).boundingBox()
    expect(detailBox.y).toBeLessThan(toggleBox.y)
    expect(mapRequests).toBe(0)
    await page.getByRole('button', { name: '查看星图' }).click()
    await expect(map).toBeVisible()
    await expect.poll(() => mapRequests).toBe(1)
  })
}

test('unchanged pirate refresh keeps selected details while revocation clears private data', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  const revisions = []
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'scout', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate' }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) {
      revisions.push(url.searchParams.get('revision'))
      if (revisions.length === 1) return json({ ...pirateSnapshot(71, [sighting(4)], 'scout'), revision: 'rev-1' })
      if (revisions.length === 2) return json({ unchanged: true, revision: 'rev-1', server_time: observedAt })
      return json({ detail: '组织权限已变化' }, 403)
    }
    if (url.pathname.endsWith('/boards/71/map/')) return json(pirateMap())
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await page.locator('.pirate-target-row').click()
  const detail = page.getByRole('region', { name: '目标详情' })
  await expect(detail).toContainText('夜航员')
  await page.getByRole('button', { name: '刷新目标线索' }).click()
  await expect.poll(() => revisions.length).toBe(2)
  expect(revisions[1]).toBe('rev-1')
  await expect(detail).toContainText('夜航员')
  await expect(page.locator('.pirate-target-row')).toHaveCount(1)

  await page.getByRole('button', { name: '刷新目标线索' }).click()
  await expect(page.getByRole('alert')).toContainText('无法读取这块情报板')
  await expect(page.locator('.pirate-target-row')).toHaveCount(0)
})

test('late unchanged pirate response cannot overwrite a newer full snapshot', async ({ page }) => {
  await seedAuthenticatedSession(page, { user_id: 23 })
  let releaseOld
  const oldResponse = new Promise(resolve => { releaseOld = resolve })
  const revisions = []
  const newcomer = { ...sighting(5), character_name: '新航员', target_key: ['新航员', '夜神级'] }
  await installApiMock(page, ({ url, method }) => {
    if (url.pathname.endsWith('/organizations/') && method === 'GET') return json({ organizations: [
      { id: 7, name: '巡猎小队', role: 'scout', status: 'active',
        boards: [{ id: 71, name: '夜巡', kind: 'pirate' }] },
    ] })
    if (url.pathname.endsWith('/boards/71/pirate/')) {
      revisions.push(url.searchParams.get('revision'))
      if (revisions.length === 1) return json({ ...pirateSnapshot(71, [sighting(4)], 'scout'), revision: 'rev-1' })
      if (revisions.length === 2) return oldResponse
      return json({ ...pirateSnapshot(71, [sighting(4), newcomer], 'scout'), revision: 'rev-2' })
    }
    if (url.pathname.endsWith('/boards/71/map/')) return json(pirateMap())
    return json({})
  })
  await page.goto('/tactical?organization=7&board=71')
  await expect(page.locator('.pirate-target-row')).toHaveCount(1)
  await page.getByRole('button', { name: '刷新目标线索' }).click()
  await expect.poll(() => revisions.length).toBe(2)
  await page.getByRole('button', { name: '刷新目标线索' }).click()
  await expect(page.locator('.pirate-target-row')).toHaveCount(2)
  expect(revisions.slice(1)).toEqual(['rev-1', 'rev-1'])
  const lateResponse = page.waitForResponse(response => response.url().includes('revision=rev-1') &&
    response.status() === 200 && response.request().resourceType() === 'fetch')
  releaseOld(json({ unchanged: true, revision: 'rev-1', server_time: observedAt }))
  await lateResponse
  await expect(page.locator('.pirate-target-row')).toHaveCount(2)
  await expect(page.locator('.pirate-target-row').filter({ hasText: '新航员' })).toHaveCount(1)
})
