import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { formatCompactIsk } from '../../src/utils/manufacturingDisplay.js'
import * as display from '../../src/utils/manufacturingDisplay.js'

test('missing-material reasons show human-readable labels instead of internal codes', () => {
  assert.equal(typeof display.formatMissingMaterialReason, 'function')
  for (const [reason, label] of [
    ['quote_absent', '尚未采集'], ['quote_uncollected', '尚未采集'],
    ['quote_stale', '报价已过期'], ['quote_empty', '暂无有效报价'],
    ['price_invalid', '单价无效'], ['future_reason', '待补价格'],
  ]) assert.equal(display.formatMissingMaterialReason(reason), label)
})

test('formats exact values below ten thousand without a compact suffix', () => {
  assert.equal(formatCompactIsk(9999.9), '9,999.9 ISK')
})

test('formats ten-thousand values as ten-thousand ISK', () => {
  assert.equal(formatCompactIsk(47082080.424), '约 4,708.21 万 ISK')
})

test('formats hundred-million values as hundred-million ISK', () => {
  assert.equal(formatCompactIsk(47082080424.4), '约 470.82 亿 ISK')
})

test('keeps absent quotes readable', () => {
  assert.equal(formatCompactIsk(null), '待补价格')
})

test('prioritizes the manufacturing target and expanded first-level tree images only', async () => {
  const source = await fs.readFile(fileURLToPath(new URL('../../src/pages/ManufacturingEstimator.jsx', import.meta.url)), 'utf8')
  assert.match(source, /priority=\{path === '0' \|\| path\.split\('\.'\)\.length === 2 \? 'high' : undefined\}/)
})
