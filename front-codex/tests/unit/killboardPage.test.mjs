import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import * as presentation from '../../src/utils/killboardPresentation.js'

// Execute the actual page and effects. Only React scheduling, the router and
// network boundary are replaced; no browser, credentials or backend is used.
const source = readFileSync(new URL('../../src/pages/Killboard.jsx', import.meta.url), 'utf8').replace(/^import.*$/gm, '')
const compiled = await transform(source, { loader: 'jsx', format: 'cjs', jsx: 'transform' })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const settle = () => new Promise(resolve => setImmediate(resolve))
const denied = () => Object.assign(new Error('Synthetic access denied'), { status: 403 })
const privateReport = (id = '1') => ({
  kill_id: id, ship_name: 'PRIVATE HULL', victim_name: 'PRIVATE VICTIM',
  isk_lost: '229307984742', system_name: 'PRIVATE SYSTEM', participant_count: 102,
  participants_status: 'provided', equipment_status: 'provided',
  participants: [{ character_id: '101', character_name: 'PRIVATE PILOT', corporation_name: 'PRIVATE CORP' }],
  items: [{ type_id: '201', name: 'PRIVATE EQUIPMENT', slot: 'high', status: 'dropped' }],
})

function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...(tree.children || []).flatMap(nodes)]
}

function harness() {
  const values = [], refs = [], previousDeps = [], cleanups = [], effects = []
  const calls = { list: [], detail: [], status: [] }
  const timers = new Map(), windowEvents = new Map(), documentEvents = new Map()
  let timerId = 0
  const document = {
    visibilityState: 'visible',
    addEventListener: (name, listener) => documentEvents.set(name, listener),
    removeEventListener: name => documentEvents.delete(name),
  }
  const window = {
    setInterval: (callback, milliseconds) => { timers.set(++timerId, { callback, milliseconds }); return timerId },
    clearInterval: id => timers.delete(id),
    addEventListener: (name, listener) => windowEvents.set(name, listener),
    removeEventListener: name => windowEvents.delete(name),
  }
  let stateIndex = 0, refIndex = 0, effectIndex = 0, killId = '1', tree
  const request = (kind, options) => {
    const call = { ...deferred(), signal: options.signal }
    calls[kind].push(call)
    return call.promise
  }
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState(initial) {
      const index = stateIndex++
      if (!(index in values)) values[index] = typeof initial === 'function' ? initial() : initial
      return [values[index], value => { values[index] = typeof value === 'function' ? value(values[index]) : value }]
    },
    useRef(initial) { return refs[refIndex++] ||= { current: initial } },
    useMemo: callback => callback(),
    useEffect(callback, dependencies) {
      const index = effectIndex++
      if (!previousDeps[index] || dependencies.some((value, offset) => value !== previousDeps[index][offset])) {
        effects.push({ index, callback })
        previousDeps[index] = dependencies
      }
    },
    useParams: () => ({ killId }), useNavigate: () => () => {}, AbortController, window, document,
    listKillReports: options => request('list', options),
    getKillReport: (_id, options) => request('detail', options),
    getKillboardStatus: options => request('status', options),
    ...presentation,
  }
  for (const name of ['Activity', 'AlertTriangle', 'Copy', 'Database', 'Layers3', 'LoaderCircle', 'RefreshCw', 'Search', 'Swords', 'X', 'KillParticipantRow', 'GameItemImage']) dependencies[name] = name
  const module = { exports: {} }
  new Function(...Object.keys(dependencies), 'module', 'exports', compiled.code)(...Object.values(dependencies), module, module.exports)
  const render = () => {
    stateIndex = refIndex = effectIndex = 0
    tree = module.exports.default()
    for (const { index, callback } of effects.splice(0)) {
      cleanups[index]?.()
      cleanups[index] = callback()
    }
    return tree
  }
  return {
    calls, format: module.exports.formatKillIsk, formatTime: module.exports.formatKillboardTime, render,
    get tree() { return tree },
    get serializedState() { return JSON.stringify(values) },
    async flush() { await settle(); render() },
    refresh() { nodes(tree).find(node => node.props.className === 'kb-action').props.onClick(); render() },
    route(id) { killId = id; render(); render() },
    component(node) {
      const stateOffset = stateIndex, refOffset = refIndex, effectOffset = effectIndex
      return {
        render(props = node.props) {
          stateIndex = stateOffset; refIndex = refOffset; effectIndex = effectOffset
          const subtree = node.type(props)
          for (const { index, callback } of effects.splice(0)) {
            cleanups[index]?.()
            cleanups[index] = callback()
          }
          return subtree
        },
      }
    },
    tick() { for (const timer of timers.values()) timer.callback(); render() },
    focus() { windowEvents.get('focus')?.(); render() },
    visibility(value) { document.visibilityState = value; documentEvents.get('visibilitychange')?.(); render() },
    get intervals() { return [...timers.values()].map(timer => timer.milliseconds) },
    unmount() { cleanups.forEach(cleanup => cleanup?.()) },
  }
}

async function loadPrivate(page, { status = true } = {}) {
  page.render()
  page.calls.list[0].resolve({ results: [privateReport()], count: 1 })
  page.calls.detail[0].resolve(privateReport())
  if (status) page.calls.status[0].resolve({ collection_enabled: true, last_report: 'PRIVATE STATUS' })
  await page.flush()
  assert.match(JSON.stringify(page.tree), /PRIVATE HULL/)
}

function assertRevoked(page) {
  assert.doesNotMatch(page.serializedState, /PRIVATE/)
  assert.doesNotMatch(JSON.stringify(page.tree), /PRIVATE/)
  assert.ok(nodes(page.tree).some(node => node.props.className === 'kb-error is-forbidden'))
  assert.ok(nodes(page.tree).find(node => node.props.className === 'kb-action').props.disabled)
  assert.ok(nodes(page.tree).find(node => node.type === 'input').props.disabled)
  assert.ok(!nodes(page.tree).some(node => node.props['aria-label'] === '关闭错误'))
}

for (const endpoint of ['list', 'detail', 'status']) {
  test(`${endpoint} 403 clears private data and latches against refresh or dismissal`, async () => {
    const page = harness()
    await loadPrivate(page, { status: endpoint !== 'status' })
    if (endpoint === 'list') page.refresh()
    if (endpoint === 'detail') page.route('2')
    page.calls[endpoint].at(-1).reject(denied())
    await page.flush()
    assertRevoked(page)
    assert.ok(Object.values(page.calls).flat().every(call => call.signal.aborted))
    const count = page.calls.list.length
    page.refresh()
    await page.flush()
    assert.equal(page.calls.list.length, count)
    assertRevoked(page)
    page.unmount()
  })

  test(`${endpoint} 403 fences late successful callbacks from all concurrent requests`, async () => {
    const page = harness()
    page.render()
    page.calls[endpoint][0].reject(denied())
    await page.flush()
    for (const kind of ['list', 'detail', 'status'].filter(kind => kind !== endpoint)) {
      page.calls[kind][0].resolve(kind === 'list' ? { results: [privateReport()], count: 1 } : kind === 'detail' ? privateReport() : { collection_enabled: true, last_report: 'PRIVATE STATUS' })
    }
    await page.flush()
    assertRevoked(page)
    page.unmount()
  })
}

test('a remounted page can revalidate while the old page cannot accept late data', async () => {
  const previous = harness()
  previous.render()
  previous.calls.status[0].reject(denied())
  await previous.flush()
  previous.unmount()
  previous.calls.list[0].resolve({ results: [privateReport()], count: 1 })
  previous.calls.detail[0].resolve(privateReport())
  await previous.flush()
  assertRevoked(previous)
  const current = harness()
  await loadPrivate(current)
  assert.ok(!nodes(current.tree).find(node => node.props.className === 'kb-action').props.disabled)
  current.unmount()
})

test('an ordinary network error stays dismissible and does not revoke access', async () => {
  const page = harness()
  await loadPrivate(page)
  page.refresh()
  page.calls.list.at(-1).reject(new Error('Synthetic network failure'))
  await page.flush()
  assert.match(page.serializedState, /PRIVATE HULL/)
  const dismiss = nodes(page.tree).find(node => node.props['aria-label'] === '关闭错误')
  assert.ok(dismiss)
  dismiss.props.onClick()
  page.render()
  assert.ok(!nodes(page.tree).some(node => node.props.role === 'alert'))
  page.unmount()
})

test('loss-value rounding carries hundredths using BigInt and promotes 万 to 亿', () => {
  const format = harness().format
  for (const [value, expected] of [
    ['29999999999', '300亿'], ['20099999999', '201亿'],
    ['99999999', '1亿'], ['99999949', '9999.99万'],
    ['19999', '2万'], ['20000000000.00', '200亿'],
    ['-29999999999', '-300亿'], ['90071992547409919999', '900719925474.1亿'],
    ['123', '123'], [null, '—'],
  ]) assert.equal(format(value), expected, String(value))
})

test('killboard timestamps are rendered in explicit Asia/Shanghai 24-hour format', () => {
  const formatTime = harness().formatTime
  assert.equal(formatTime('2026-09-30T03:35:37Z'), '2026/9/30 11:35:37')
  assert.doesNotMatch(formatTime('2026-09-30T03:35:37Z'), /AM|PM|上午|下午/)
})

test('known game-source raw timestamp fallback also treats naive protocol time as UTC', () => {
  const formatTime = harness().formatTime
  assert.equal(formatTime(null, '2026-09-30T12:58:02', 'kill_api_latest'), '2026/9/30 20:58:02')
})

test('hero forwards game source when only the raw kill time is available', async () => {
  const page = harness()
  page.render()
  const report = { ...privateReport(), source: 'kill_api_latest', kill_time_raw: '2026-09-30T12:58:02' }
  page.calls.list[0].resolve({ results: [report], count: 1 })
  page.calls.detail[0].resolve(report)
  page.calls.status[0].resolve({})
  await page.flush()
  assert.match(JSON.stringify(page.tree), /2026\/9\/30 20:58:02/)
  page.unmount()
})

test('manual refresh reloads the same selected KM detail and fences superseded responses', async () => {
  const page = harness()
  await loadPrivate(page)
  page.refresh()
  assert.equal(page.calls.detail.length, 2)
  const superseded = page.calls.detail[1]
  page.refresh()
  assert.equal(page.calls.detail.length, 3)
  assert.equal(superseded.signal.aborted, true)
  page.calls.detail[2].resolve({ ...privateReport(), victim_name: 'NEW VICTIM' })
  await page.flush()
  superseded.resolve({ ...privateReport(), victim_name: 'STALE VICTIM' })
  await page.flush()
  assert.match(JSON.stringify(page.tree), /NEW VICTIM/)
  assert.doesNotMatch(JSON.stringify(page.tree), /STALE VICTIM/)
  page.unmount()
})

test('backend polling and focus refresh are visibility bounded and skip overlapping requests', async () => {
  const page = harness()
  page.render()
  assert.deepEqual(page.intervals, [180000])
  page.tick()
  page.focus()
  assert.equal(page.calls.list.length, 1)
  page.calls.list[0].resolve({ results: [privateReport()], count: 1 })
  page.calls.detail[0].resolve(privateReport())
  page.calls.status[0].resolve({})
  await page.flush()
  page.visibility('hidden')
  page.tick()
  page.focus()
  assert.equal(page.calls.list.length, 1)
  page.visibility('visible')
  assert.equal(page.calls.list.length, 2)
  assert.equal(page.calls.detail.length, 2)
  page.tick()
  assert.equal(page.calls.list.length, 2)
  page.calls.list[1].resolve({ results: [privateReport()], count: 1 })
  page.calls.detail[1].resolve(privateReport())
  page.calls.status[1].resolve({})
  await page.flush()
  page.tick()
  assert.equal(page.calls.list.length, 3)
  page.unmount()
  assert.deepEqual(page.intervals, [])
})

test('rate-limit status does not render the live badge while forbidden status does', async () => {
  const page = harness()
  await loadPrivate(page, { status: false })
  page.calls.status[0].resolve({ configured: true, collection_enabled: false, state: 'cooldown', stop_reason: 'rate_limited' })
  await page.flush()
  assert.ok(!nodes(page.tree).some(node => node.props.className === 'kb-live-pill'))
  page.refresh()
  page.calls.status[1].resolve({ configured: true, collection_enabled: false, state: 'configuration_error' })
  await page.flush()
  assert.ok(nodes(page.tree).some(node => node.props.className === 'kb-live-pill'))
  page.unmount()
})

test('dropped equipment carries a dedicated row class and status', async () => {
  const page = harness()
  await loadPrivate(page)
  const equipmentPanel = nodes(page.tree).find(node => typeof node.type === 'function' && node.type.name === 'Equipment')
  const panel = equipmentPanel.type(equipmentPanel.props)
  assert.ok(nodes(panel).some(node => node.props.className === 'kb-item kb-item--dropped'))
  assert.ok(nodes(panel).some(node => String(node.props.className || '').includes('kb-item-status--dropped')))
  page.unmount()
})

test('equipment panel exposes a dropped-only quick filter and per-slot drop counts', async () => {
  const page = harness()
  await loadPrivate(page)
  const equipmentPanel = nodes(page.tree).find(node => typeof node.type === 'function' && node.type.name === 'Equipment')
  const panel = equipmentPanel.type({ ...equipmentPanel.props, report: {
    ...privateReport(),
    items: [
      { type_id: '1', name: 'HIGH DROP', slot: 'high', status: 'dropped' },
      { type_id: '2', name: 'HIGH LOST', slot: 'high', status: 'destroyed' },
      { type_id: '3', name: 'LOW DROP', slot: 'low', status: 'mixed' },
    ],
  } })
  const rendered = nodes(panel)
  const dropToggle = rendered.find(node => node.props['aria-label'] === '只看已掉落装备')
  assert.ok(dropToggle)
  assert.equal(dropToggle.props['aria-pressed'], false)
  const slotTabs = rendered.filter(node => node.props['aria-pressed'] !== undefined)
  assert.match(JSON.stringify(slotTabs), /高槽/)
  assert.match(JSON.stringify(slotTabs), /低槽/)
  assert.match(JSON.stringify(slotTabs), /dropItems|2|1/)
  page.unmount()
})

test('all equipment is separated in high mid low rig other order and filters omit empty sections', async () => {
  const page = harness()
  await loadPrivate(page)
  const node = nodes(page.tree).find(node => typeof node.type === 'function' && node.type.name === 'Equipment')
  const component = page.component(node)
  const report = { ...privateReport(), items: [
    { name: 'RIG LOST', slot: 'rig', status: 'destroyed' },
    { name: 'LOW DROP', slot: 'low', status: 'mixed', quantity_dropped: 1 },
    { name: 'HIGH DROP', slot: 'high', status: 'dropped' },
    { name: 'OTHER LOST', slot: 'unknown', status: 'destroyed' },
    { name: 'MID LOST', slot: 'mid', status: 'destroyed' },
    { name: 'HIGH LOST', slot: 'high', status: 'destroyed' },
  ] }
  const props = { ...node.props, report }
  let panel = component.render(props)
  const sections = tree => nodes(tree).filter(item => item.props.className === 'kb-equipment-group')
  assert.deepEqual(sections(panel).map(item => item.props['data-slot']), ['high', 'mid', 'low', 'rig', 'other'])
  for (const section of sections(panel)) assert.ok(nodes(section).some(item => item.type === 'h4'))
  assert.match(JSON.stringify(sections(panel)[1]), /掉落 0 项/)
  assert.match(JSON.stringify(sections(panel)[0]), /高槽|HIGH DROP|HIGH LOST/)
  nodes(panel).find(item => item.props['aria-label'] === '只看已掉落装备').props.onClick()
  panel = component.render(props)
  assert.deepEqual(sections(panel).map(item => item.props['data-slot']), ['high', 'low'])
  assert.doesNotMatch(JSON.stringify(panel), /OTHER LOST|MID LOST|RIG LOST|HIGH LOST/)
  const lowTab = nodes(panel).find(item => item.type === 'button' && JSON.stringify(item.children).includes('低槽'))
  lowTab.props.onClick()
  panel = component.render(props)
  assert.deepEqual(sections(panel).map(item => item.props['data-slot']), ['low'])
  const next = { ...props, report: { ...report, kill_id: '2' } }
  component.render(next)
  panel = component.render(next)
  assert.deepEqual(sections(panel).map(item => item.props['data-slot']), ['high', 'mid', 'low', 'rig', 'other'])
  page.unmount()
})

test('the hero identifies corporation tag and hull class without diagnostic identity copy', async () => {
  const page = harness()
  page.render()
  const report = { ...privateReport(), victim_corporation_name: '罗德骑士团', victim_corporation_ticker: 'KOFR', ship_class_label: '突击航空母舰' }
  page.calls.list[0].resolve({ results: [report], count: 1 })
  page.calls.detail[0].resolve(report)
  page.calls.status[0].resolve({})
  await page.flush()
  const hero = nodes(page.tree).find(node => node.props.className === 'kb-hero kb-panel')
  assert.match(JSON.stringify(hero), /\[KOFR\] 罗德骑士团/)
  assert.ok(nodes(hero).some(node => node.props.className === 'kb-hull-class' && JSON.stringify(node.children).includes('突击航空母舰')))
  assert.ok(nodes(hero).some(node => node.props.className === 'kb-hero-corporation'))
  assert.doesNotMatch(JSON.stringify(hero), /军团资料未返回|目标身份未返回/)
  page.unmount()
})

test('equipment list uses a compact multi-column layout with independent scrolling', () => {
  const css = readFileSync(new URL('../../src/styles/killboard.css', import.meta.url), 'utf8')
  assert.match(css, /\.kb-item-list\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)/)
  assert.match(css, /\.kb-item-list\s*\{[^}]*overflow:auto/)
  assert.match(css, /\.kb-item--dropped\s*\{[^}]*background:/)
})

test('raw participant counts are labelled records, not a proven number of players', async () => {
  const page = harness()
  await loadPrivate(page)
  assert.doesNotMatch(JSON.stringify(page.tree), /参与人数/)
  const participantPanel = nodes(page.tree).find(node => typeof node.type === 'function' && node.type.name === 'Participants')
  const panel = participantPanel.type(participantPanel.props)
  const count = nodes(panel).find(node => node.props.className === 'kb-panel-count')
  assert.equal(count.children.join(''), '102 条记录')
  page.unmount()
})

test('the hero includes victim metadata and redundant stat cards no longer occupy the detail desk', async () => {
  const page = harness()
  page.render()
  const report = { ...privateReport(), victim_corporation_name: 'VICTIM CORP', victim_alliance_name: 'VICTIM ALLIANCE', constellation_name: 'CONSTELLATION', region_name: 'REGION' }
  page.calls.list[0].resolve({ results: [report], count: 1 })
  page.calls.detail[0].resolve(report)
  page.calls.status[0].resolve({})
  await page.flush()
  const hero = nodes(page.tree).find(node => node.props.className === 'kb-hero kb-panel')
  assert.match(JSON.stringify(hero), /PRIVATE VICTIM/)
  assert.match(JSON.stringify(hero), /VICTIM CORP/)
  assert.match(JSON.stringify(hero), /CONSTELLATION/)
  assert.match(JSON.stringify(hero), /REGION/)
  assert.ok(!nodes(page.tree).some(node => node.props.className === 'kb-stat-grid'))
  assert.doesNotMatch(JSON.stringify(page.tree), /火力记录|最后一击资料未返回/)
  assert.doesNotMatch(JSON.stringify(page.tree), /仅收录价值大于 200 亿 ISK 的最新报告，保留星系安等与可验证的掉落信息。/)
  page.unmount()
})

test('report index also removes client localization wrappers from ship names', async () => {
  const page = harness()
  page.render()
  const report = { ...privateReport(), ship_name: '{drone_affix:突击型} {drone:钢铁守卫}' }
  page.calls.list[0].resolve({ results: [report], count: 1 })
  page.calls.detail[0].resolve(report)
  page.calls.status[0].resolve({})
  await page.flush()
  const rowNode = nodes(page.tree).find(node => typeof node.type === 'function' && node.type.name === 'ReportRow')
  assert.ok(rowNode)
  const tree = JSON.stringify(rowNode.type(rowNode.props))
  assert.match(tree, /突击型 钢铁守卫/)
  assert.doesNotMatch(tree, /\{drone(?:_affix)?:/)
  page.unmount()
})

test('the hero exposes a copyable in-game KM tag and visible exact ISK value', async () => {
  const page = harness()
  await loadPrivate(page)
  const serialized = JSON.stringify(page.tree)
  assert.match(serialized, /复制 KM|复制击毁报告/)
  assert.match(serialized, /229,307,984,742 ISK/)
  const copyButton = nodes(page.tree).find(node => node.props['aria-label'] === '复制 KM')
  assert.ok(copyButton)
  page.unmount()
})

test('hero artwork constrains its grid track instead of trusting object fit alone', () => {
  const css = readFileSync(new URL('../../src/styles/killboard.css', import.meta.url), 'utf8')
  assert.match(css, /\.kb-hero\s*\{[^}]*grid-template-columns:minmax\(190px, 260px\)/)
  assert.match(css, /\.kb-hero \.kb-asset--ship\s*\{[^}]*grid-template-rows:minmax\(0,1fr\)/)
  assert.match(css, /\.kb-hero \.kb-asset--ship img\s*\{[^}]*object-fit:contain;[^}]*object-position:center/)
})

test('equipment category dividers span the scroll area and category items keep the column layout', () => {
  const css = readFileSync(new URL('../../src/styles/killboard.css', import.meta.url), 'utf8')
  assert.match(css, /\.kb-equipment-group\s*\{[^}]*grid-column:1\s*\/\s*-1/)
  assert.match(css, /\.kb-equipment-group-items\s*\{[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/)
  assert.match(css, /@container kb-equipment \(max-width:560px\)/)
  assert.match(css, /@container kb-participants \(max-width:450px\)/)
  assert.match(css, /\.kb-participant-main strong,\.kb-participant-main \.kb-participant-corporation\s*\{[^}]*white-space:normal/)
})

test('refresh reloads health and hides a newly persisted cooldown badge', async () => {
  const page = harness()
  await loadPrivate(page, { status: false })
  page.calls.status[0].resolve({ configured: true, collection_enabled: true, state: 'ready' })
  await page.flush()
  assert.match(JSON.stringify(page.tree), /采集已就绪/)
  assert.doesNotMatch(JSON.stringify(page.tree), /采集运行中/)
  page.refresh()
  assert.equal(page.calls.status.length, 2)
  assert.equal(page.calls.status[0].signal.aborted, true)
  page.calls.status[1].resolve({ configured: true, collection_enabled: false, state: 'cooldown', stop_reason: 'rate_limited' })
  await page.flush()
  assert.ok(!nodes(page.tree).some(node => node.props.className === 'kb-live-pill'))
  assert.doesNotMatch(JSON.stringify(page.tree), /采集运行中/)
  page.unmount()
})

test('a failed health refresh cannot leave a stale running badge', async () => {
  const page = harness()
  await loadPrivate(page, { status: false })
  page.calls.status[0].resolve({ configured: true, collection_enabled: true, state: 'running' })
  await page.flush()
  assert.match(JSON.stringify(page.tree), /采集运行中/)
  page.refresh()
  assert.equal(page.calls.status.length, 2)
  page.calls.status[1].reject(new Error('Synthetic health failure'))
  await page.flush()
  assert.match(JSON.stringify(page.tree), /采集状态未知/)
  assert.doesNotMatch(JSON.stringify(page.tree), /采集运行中/)
  assert.match(page.serializedState, /PRIVATE HULL/)
  page.unmount()
})

test('health refresh 403 revokes private data before a pending report refresh can restore it', async () => {
  const page = harness()
  await loadPrivate(page)
  page.refresh()
  assert.equal(page.calls.status.length, 2)
  page.calls.status[1].reject(denied())
  await page.flush()
  assertRevoked(page)
  page.calls.list[1].resolve({ results: [privateReport()], count: 1 })
  await page.flush()
  assertRevoked(page)
  page.unmount()
})
