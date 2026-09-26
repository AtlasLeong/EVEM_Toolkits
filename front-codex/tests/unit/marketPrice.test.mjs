import test from 'node:test'
import assert from 'node:assert/strict'

import { formatCompactMarketPrice } from '../../src/utils/marketPrice.js'

test('compact market prices keep amounts below ten thousand numeric without separators', () => {
  assert.equal(formatCompactMarketPrice('9999.99'), '9999.99')
  assert.equal(formatCompactMarketPrice('1234.50'), '1234.5')
  assert.equal(formatCompactMarketPrice('42'), '42')
})

test('compact market prices use 万, 亿 and 万亿 at their exact boundaries', () => {
  assert.equal(formatCompactMarketPrice('10000'), '1万')
  assert.equal(formatCompactMarketPrice('21897981.37'), '2189.8万')
  assert.equal(formatCompactMarketPrice('100000000'), '1亿')
  assert.equal(formatCompactMarketPrice('123456789'), '1.23亿')
  assert.equal(formatCompactMarketPrice('1000000000000'), '1万亿')
  assert.equal(formatCompactMarketPrice('1234567890000'), '1.23万亿')
})

test('compact market prices round half up to at most two decimals', () => {
  assert.equal(formatCompactMarketPrice('0.004'), '0')
  assert.equal(formatCompactMarketPrice('0.005'), '0.01')
  assert.equal(formatCompactMarketPrice('1.005'), '1.01')
  assert.equal(formatCompactMarketPrice('12349.999'), '1.23万')
  assert.equal(formatCompactMarketPrice('12350'), '1.24万')
})

test('compact market prices promote the unit when rounding reaches the next boundary', () => {
  assert.equal(formatCompactMarketPrice('9999.994'), '9999.99')
  assert.equal(formatCompactMarketPrice('9999.995'), '1万')
  assert.equal(formatCompactMarketPrice('99999949.99'), '9999.99万')
  assert.equal(formatCompactMarketPrice('99999950'), '1亿')
  assert.equal(formatCompactMarketPrice('99999999.99'), '1亿')
  assert.equal(formatCompactMarketPrice('999999499999.99'), '9999.99亿')
  assert.equal(formatCompactMarketPrice('999999500000'), '1万亿')
})

test('compact market prices preserve zero and normalize valid numeric inputs', () => {
  assert.equal(formatCompactMarketPrice(0), '0')
  assert.equal(formatCompactMarketPrice('0.00'), '0')
  assert.equal(formatCompactMarketPrice('0000.0100'), '0.01')
  assert.equal(formatCompactMarketPrice(' 0012345.00 '), '1.23万')
  assert.equal(formatCompactMarketPrice(1234.5), '1234.5')
})

test('compact market prices retain decimal-string precision beyond the safe integer range', () => {
  assert.equal(formatCompactMarketPrice('123499999999999999999999999.99'), '123500000000000万亿')
  assert.equal(formatCompactMarketPrice('999999999999999999999999999.99'), '1000000000000000万亿')
  assert.equal(formatCompactMarketPrice('123456789012345123499999999.99'), '123456789012345.12万亿')
  assert.equal(formatCompactMarketPrice('123456789012345124999999999.99'), '123456789012345.12万亿')
  assert.equal(formatCompactMarketPrice('123456789012345125000000000'), '123456789012345.13万亿')
})

test('compact market prices mark missing and malformed samples as insufficient', () => {
  for (const value of [null, undefined, '', '   ', 'oops', '1,000', '1e8', '1.2.3', '-1', '.', true, {}, [], NaN, Infinity]) {
    assert.equal(formatCompactMarketPrice(value), '样本不足', `input: ${String(value)}`)
  }
})
