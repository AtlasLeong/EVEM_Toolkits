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
    useParams: () => ({ killId }), useNavigate: () => () => {}, AbortController,
    listKillReports: options => request('list', options),
    getKillReport: (_id, options) => request('detail', options),
    getKillboardStatus: options => request('status', options),
    ...presentation,
  }
  for (const name of ['Activity', 'AlertTriangle', 'Database', 'Layers3', 'LoaderCircle', 'RefreshCw', 'Search', 'Swords', 'X', 'KillParticipantRow', 'GameItemImage']) dependencies[name] = name
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
    calls, format: module.exports.formatKillIsk, render,
    get tree() { return tree },
    get serializedState() { return JSON.stringify(values) },
    async flush() { await settle(); render() },
    refresh() { nodes(tree).find(node => node.props.className === 'kb-action').props.onClick(); render() },
    route(id) { killId = id; render(); render() },
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

test('refresh reloads health and displays a newly persisted cooldown', async () => {
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
  assert.match(JSON.stringify(page.tree), /限流冷却中/)
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
