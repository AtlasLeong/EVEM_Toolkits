import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import { build } from 'esbuild'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

const entry = fileURLToPath(new URL('../../src/components/tactical/AnomalyHotspotLeaderboard.jsx', import.meta.url))
let Component
if (existsSync(entry)) {
  const compiled = await build({ entryPoints: [entry], bundle: true, write: false,
    format: 'iife', globalName: 'hotspotPanel', external: ['react'], jsx: 'automatic', loader: { '.css': 'empty' } })
  const context = vm.createContext({ require: createRequire(import.meta.url), Date, Intl })
  vm.runInContext(compiled.outputFiles[0].text, context)
  Component = context.hotspotPanel.default
}
const snapshot = { version: 1, collected_at_ms: Date.UTC(2026, 9, 13, 15, 5, 2),
  last_attempt_at_ms: Date.UTC(2026, 9, 13, 15, 5, 2), status: 'ok', statistics_window: null,
  systems: [
    { solar_system_id: 1, destroy_num: 155, system_name: '阿尔法', region_id: 10, region_name: '甲域' },
    { solar_system_id: 2, destroy_num: 0, system_name: null, region_id: null, region_name: null },
  ] }
function render(props) {
  assert.ok(Component, 'AnomalyHotspotLeaderboard is not implemented')
  return renderToStaticMarkup(React.createElement(Component, props))
}

test('the named panel keeps last-success Shanghai time in its non-scrolling header', () => {
  const html = render({ snapshot: { ...snapshot, last_attempt_at_ms: Date.UTC(2026, 9, 14, 0, 0, 0) } })
  assert.match(html, /aria-label="犁地热点排行榜"/)
  assert.match(html, /<strong>犁地热点<\/strong>/)
  assert.ok(html.indexOf('2026/10/13 23:05:02') < html.indexOf('anomaly-hotspots-content'))
  assert.doesNotMatch(html, /2026\/10\/14 08:00:00/)
  assert.match(html, /aria-label="榜内搜索"/)
})

test('the panel export is memoized so unrelated camera renders can be skipped', () => {
  assert.equal(Component.$$typeof, Symbol.for('react.memo'))
})

test('the panel renders exact ranked counts, Shanghai time and the unconfirmed statistics window', () => {
  const html = render({ snapshot, canLocateSystem: id => id === 1 })
  assert.match(html, /阿尔法/)
  assert.match(html, /155/)
  assert.match(html, /星系 2/)
  assert.match(html, /2026\/10\/13 23:05:02/)
  assert.match(html, /统计时间范围尚未确认/)
  assert.match(html, /暂无地图坐标/)
  assert.doesNotMatch(html, /最近 24 小时|最近 1 小时/)
})

test('the panel legend renders five labeled levels and matching palette ranges rather than legacy count thresholds', () => {
  const html = render({ snapshot })
  const legend = html.match(/<div class="anomaly-hotspots-legend"[^>]*>(.*?)<\/div>/)?.[1]
  assert.ok(legend, 'the level legend is rendered')
  const expected = [
    [1, '1–50', '#34d399'], [2, '51–100', '#bef264'], [3, '101–150', '#fbbf24'],
    [4, '151–200', '#fb923c'], [5, '&gt;200', '#f43f5e'],
  ]
  assert.equal((legend.match(/data-level=/g) || []).length, 5)
  for (const [level, range, color] of expected) {
    assert.match(legend, new RegExp(`<span data-level="${level}" aria-label="${level}级热点[^\"]*"><i[^>]*style="background-color:${color}"[^>]*><\\/i>${level}级[^<]*${range}<\\/span>`))
  }
  assert.doesNotMatch(legend, /1–80|81–200|is-low|is-medium|is-high/)
  assert.match(html, /统计时间范围尚未确认/)
  assert.match(html, /等级范围不是精确摧毁数/)
})

test('a failed refresh shows retained data, not an empty loading replacement', () => {
  const html = render({ snapshot, requestFailed: true })
  assert.match(html, /更新失败/)
  assert.match(html, /保留最近成功快照/)
  assert.match(html, /阿尔法/)
  assert.match(html, /2026\/10\/13 23:05:02/)
})

test('mobile ranking omits map-location and layer controls entirely', () => {
  const html = render({ snapshot, allowLocate: false })
  assert.match(html, /阿尔法/)
  assert.doesNotMatch(html, /定位星系|定位该星域热点|暂无地图坐标|显示热圈/)
})

test('the initial no-data state never implies a measured zero', () => {
  const html = render({ snapshot: null, loading: true })
  assert.match(html, /正在读取热点/)
  assert.match(html, /不代表摧毁数量为零/)
  assert.match(html, /暂无成功快照/)
  assert.doesNotMatch(html, /阿尔法/)
})

const changes = { version: 1, status: 'ok', statistics_window: null,
  interval: { id: 2, start_at_ms: Date.UTC(2026, 9, 15, 1), end_at_ms: Date.UTC(2026, 9, 15, 1, 25), elapsed_ms: 25 * 60_000 },
  coverage: { comparable: 1, new: 2, missing: 3, negative: 4, unchanged: 0 }, intervals: [], next_before: null,
  systems: [{ solar_system_id: 42, previous_destroy_num: 30, destroy_num: 70, delta: 40, system_name: '私密星系', region_id: null, region_name: null }] }
test('unauthorized panel never renders supplied private rows or change controls', () => {
  const html = render({ snapshot, changes: { allowed: false, mode: 'changes', data: changes } })
  assert.doesNotMatch(html, /私密星系|犁地变化榜|变化排名/)
})
test('authorized change panel shows positive difference, real gap and exclusions', () => {
  const html = render({ snapshot, changes: { allowed: true, mode: 'changes', data: changes }, allowLocate: false })
  assert.match(html, /私密星系/)
  assert.match(html, /\+40/)
  assert.match(html, /30 → 70/)
  assert.match(html, /25 分钟/)
  assert.match(html, /新增 2.*缺失 3.*回落 4/)
  assert.match(html, /快照净增量/)
  assert.doesNotMatch(html, /定位星系/)
})
test('baseline change panel waits for the second success instead of showing a zero', () => {
  const html = render({ snapshot, changes: { allowed: true, mode: 'changes', data: { ...changes, status: 'baseline', interval: null, systems: [] } } })
  assert.match(html, /等待第二次成功采集/)
  assert.doesNotMatch(html, /私密星系|净增量为 0/)
})

test('only latest change selection warns about stale collection and preserves its actual time', () => {
  const end = Date.now() - 21 * 60_000
  const stale = { ...changes, interval: { id: end, start_at_ms: end - 10 * 60_000, end_at_ms: end, elapsed_ms: 10 * 60_000 } }
  const html = render({ snapshot, changes: { allowed: true, mode: 'changes', data: stale, interval: null } })
  assert.match(html, /最新区间已超过 20 分钟未更新/)
  assert.match(html, /实际间隔 10 分钟/)
  assert.match(html, /私密星系/)
  const historical = render({ snapshot, changes: { allowed: true, mode: 'changes', data: stale, interval: end } })
  assert.doesNotMatch(historical, /最新区间已超过 20 分钟未更新/)
  const fresh = render({ snapshot, changes: { allowed: true, mode: 'changes', data: { ...changes, interval: {
    id: Date.now(), start_at_ms: Date.now() - 10 * 60_000, end_at_ms: Date.now(), elapsed_ms: 10 * 60_000 } } } })
  assert.doesNotMatch(fresh, /最新区间已超过 20 分钟未更新/)
})
