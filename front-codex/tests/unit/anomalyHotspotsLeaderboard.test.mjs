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
