import test from 'node:test'
import assert from 'node:assert/strict'
import { formatCompactIsk } from '../../src/utils/manufacturingDisplay.js'

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
