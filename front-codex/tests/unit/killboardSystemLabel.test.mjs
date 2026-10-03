import test from 'node:test'
import assert from 'node:assert/strict'
import { killboardSystemLabel } from '../../src/utils/killboardPresentation.js'

test('system labels prefer names and retain a numeric fallback when names are missing', () => {
  assert.equal(killboardSystemLabel({ system_name: 'JLO-Z3', system_id: 2001 }), 'JLO-Z3')
  assert.equal(killboardSystemLabel({ system_name: '', system_id: 2001 }), '星系 #2001')
  assert.equal(killboardSystemLabel({ system_id: '2001' }), '星系 #2001')
  assert.equal(killboardSystemLabel({ system_id: 0 }), '未知星系')
  assert.equal(killboardSystemLabel(), '未知星系')
})
