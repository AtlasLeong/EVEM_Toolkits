import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { transform } from 'esbuild'
import * as presentation from '../../src/utils/killboardPresentation.js'

const source = readFileSync(new URL('../../src/pages/KillboardCollectorAdmin.jsx', import.meta.url), 'utf8').replace(/^import.*$/gm, '')
const compiled = await transform(source, { loader: 'jsx', format: 'cjs', jsx: 'transform' })

function harness() {
  const values = [], refs = [], previous = [], cleanups = [], effects = [], calls = []
  const timers = new Map()
  let timerId = 0
  let stateIndex = 0, refIndex = 0, effectIndex = 0
  const dependencies = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children }) },
    useState(initial) {
      const index = stateIndex++
      if (!(index in values)) values[index] = initial
      return [values[index], next => { values[index] = typeof next === 'function' ? next(values[index]) : next }]
    },
    useRef: initial => refs[refIndex++] ||= { current: initial },
    useEffect(callback, deps) {
      const index = effectIndex++
      if (!previous[index] || deps.some((value, offset) => value !== previous[index][offset])) {
        effects.push({ index, callback }); previous[index] = deps
      }
    },
    AbortController,
    document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} },
    window: {
      setInterval(callback, milliseconds) { timers.set(++timerId, { callback, milliseconds }); return timerId },
      clearInterval(id) { timers.delete(id) },
      addEventListener() {}, removeEventListener() {},
    },
    getKillboardCollectorLogs(options) {
      let resolve, reject
      const promise = new Promise((yes, no) => { resolve = yes; reject = no })
      calls.push({ resolve, reject, signal: options.signal })
      return promise
    },
    ...presentation,
  }
  for (const name of ['Link', 'AlertTriangle', 'RefreshCw', 'EmptyState', 'LoadingBar', 'PageHeader', 'Panel', 'Pill']) dependencies[name] = name
  const module = { exports: {} }
  new Function(...Object.keys(dependencies), 'module', 'exports', compiled.code)(...Object.values(dependencies), module, module.exports)
  const render = () => {
    stateIndex = refIndex = effectIndex = 0
    const tree = module.exports.default()
    for (const { index, callback } of effects.splice(0)) { cleanups[index]?.(); cleanups[index] = callback() }
    return tree
  }
  return { calls, render, intervals: () => [...timers.values()].map(timer => timer.milliseconds), unmount: () => cleanups.forEach(cleanup => cleanup?.()) }
}

test('collector admin polling leaves headroom in the shared private API hourly limit', () => {
  const page = harness()
  page.render()
  assert.deepEqual(page.intervals(), [180000])
  page.unmount()
  assert.deepEqual(page.intervals(), [])
})

test('collector admin shows account, failing RPC stage, actual saved counters and pending coverage', async () => {
  const page = harness()
  page.render()
  page.calls[0].resolve({ configured: true, collection_enabled: false, latest_kill_id: '20044042',
    cursor: { pause_reason: 'rate_limited', strategy: { phase: 'locate', newest_candidate_id: '20050000',
      historical_next_id: '20044044', pending_id_count: 1003, pending_range_count: 2, deferred_id_count: 1, coverage_verified: false } },
    runs: [{ id: 1, status: 'stopped', request_count: 5, report_count: 4, empty_count: 1, stop_reason: 'rate_limited',
      diagnostics: { session_slot: 'B', rpc_count: 8, stage: 'identity', failure_rpc_method: 'get_public_info',
        created_count: 1, updated_count: 0, filtered_value_count: 3, enrichment_deferred_count: 1 } }],
    events: [{ id: 1, kill_id: '20044042', status: 'report', diagnostics: { session_slot: 'B', stage: 'identity',
      last_rpc_method: 'get_public_info', disposition: 'created' } }],
  })
  await new Promise(resolve => setImmediate(resolve))
  const rendered = JSON.stringify(page.render())
  assert.match(rendered, /探测 \/ 解析 \/ 空结果/)
  assert.doesNotMatch(rendered, /请求 \/ 写入 \/ 空结果|写入 KM/)
  assert.match(rendered, /新增 \/ 更新/)
  assert.match(rendered, /身份补全/)
  assert.match(rendered, /get_public_info/)
  assert.match(rendered, /1003/)
  assert.match(rendered, /覆盖未验证/)
  assert.match(rendered, /等待可见的 ID/)
  assert.match(rendered, /会话槽位/)
  page.unmount()
})

test('legacy collector runs do not present parsed reports as newly saved KM', async () => {
  const page = harness()
  page.render()
  page.calls[0].resolve({ cursor: {}, runs: [{ id: 1, request_count: 4, report_count: 4, empty_count: 0 }], events: [] })
  await new Promise(resolve => setImmediate(resolve))
  assert.match(JSON.stringify(page.render()), /未记录/)
  page.unmount()
})
