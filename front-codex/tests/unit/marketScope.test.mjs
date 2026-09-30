import test from 'node:test'
import assert from 'node:assert/strict'

import { marketScopeLabel } from '../../src/utils/marketScope.js'

test('market scope prefers API metadata and names the confirmed Jita range', () => {
  assert.equal(marketScopeLabel({ key: 'jita_h4', label: '吉他海四' }), '吉他海四')
  assert.equal(marketScopeLabel('global'), '吉他海四')
})

test('market scope keeps unknown and empty values readable', () => {
  assert.equal(marketScopeLabel('其他范围'), '其他范围')
  assert.equal(marketScopeLabel(null), '—')
})
