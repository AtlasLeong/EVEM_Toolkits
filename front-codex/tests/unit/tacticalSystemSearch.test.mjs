import test from 'node:test'
import assert from 'node:assert/strict'
import { searchTacticalSystems, formatTacticalSystemResult } from '../../src/utils/tacticalSystemSearch.js'

const systems = [
  { system_id: 300001, zh_name: '艾门', name: 'Amarr', security_status: 1 },
  { system_id: 300002, zh_name: '吉他', name: 'Jita', security_status: 0.9 },
  { system_id: 300003, zh_name: '低安', name: 'Lowsec', security_status: 0.4 },
]

test('matches Chinese, English, and id case-insensitively in input order', () => {
  assert.deepEqual(searchTacticalSystems(systems, 'AMARR').map(x => x.system_id), [300001])
  assert.deepEqual(searchTacticalSystems(systems, '吉').map(x => x.system_id), [300002])
  assert.deepEqual(searchTacticalSystems(systems, '300003').map(x => x.system_id), [300003])
  assert.deepEqual(searchTacticalSystems(systems, '').map(x => x.system_id), [300001, 300002, 300003])
})

test('caps at eight and does not mutate input', () => {
  const many = Array.from({ length: 10 }, (_, i) => ({ system_id: i, name: `X${i}` }))
  const before = structuredClone(many)
  assert.equal(searchTacticalSystems(many, 'x').length, 8)
  assert.deepEqual(many, before)
})

test('formats safe security and current-range metadata for unknown values', () => {
  const result = formatTacticalSystemResult({ system_id: 9, name: 'Unknown', security_status: null })
  assert.equal(result.name, 'Unknown')
  assert.equal(result.securityLabel, '安等未知')
  assert.equal(result.securityRange, '未知范围')
  assert.equal(result.currentRange, '当前范围未知')
})
