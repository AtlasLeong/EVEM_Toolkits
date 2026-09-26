import test from 'node:test'
import assert from 'node:assert/strict'

import { marketRefetchInterval } from '../../src/utils/marketPolling.js'

test('market polling pauses when the document is hidden', () => {
  assert.equal(marketRefetchInterval({ state: { fetchFailureCount: 0 } }, 'hidden'), false)
})

test('market polling backs off after failures and caps the retry interval', () => {
  assert.equal(marketRefetchInterval({ state: { fetchFailureCount: 0 } }, 'visible'), 120000)
  assert.equal(marketRefetchInterval({ state: { fetchFailureCount: 1 } }, 'visible'), 240000)
  assert.equal(marketRefetchInterval({ state: { fetchFailureCount: 2 } }, 'visible'), 480000)
  assert.equal(marketRefetchInterval({ state: { fetchFailureCount: 8 } }, 'visible'), 900000)
})
