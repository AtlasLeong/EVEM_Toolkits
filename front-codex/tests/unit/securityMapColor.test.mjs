import test from 'node:test'
import assert from 'node:assert/strict'
import { formatSecurityLabel, getSecurityMapColor, getSecurityTextColor } from '../../src/utils/securityColor.js'

test('security text meets normal-text contrast on the unified dark surface', () => {
  const luminance = hex => {
    const channels = hex.slice(1).match(/../g).map(channel => parseInt(channel, 16) / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    return channels.reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  }
  const background = luminance('#12252e')
  for (const security of [-.2, .1, .3, .6, .9, 'unknown']) {
    assert.ok((luminance(getSecurityTextColor(security)) + .05) / (background + .05) >= 4.5, `security ${security} must remain readable`)
  }
})

test('navigation map security palette keeps five bands and a neutral unknown color', () => {
  const cases = [
    [-0.1, '#ef4444'],
    [0, '#ef4444'],
    [0.1, '#f97316'],
    [0.2, '#f59e0b'],
    [0.49, '#f59e0b'],
    [0.5, '#10b981'],
    [0.79, '#10b981'],
    [0.8, '#60a5fa'],
    [1, '#60a5fa'],
  ]

  for (const [value, expected] of cases) {
    assert.equal(getSecurityMapColor(value), expected, `security ${value}`)
  }
})

test('navigation map security palette does not treat missing or non-finite values as zero security', () => {
  for (const value of [null, undefined, '', '   ', false, true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(getSecurityMapColor(value), '#94a3b8', `security ${String(value)}`)
  }
})

test('security labels and dark-console text colors use a neutral unknown state', () => {
  for (const value of [null, undefined, '', '   ', false, true, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
    assert.equal(formatSecurityLabel(value), '安等未知', `label ${String(value)}`)
    assert.equal(getSecurityTextColor(value), '#9bb1b8', `text ${String(value)}`)
  }
  assert.equal(formatSecurityLabel('0.87'), '0.87')
  assert.equal(formatSecurityLabel(-0.76, 1), '-0.8')
})
