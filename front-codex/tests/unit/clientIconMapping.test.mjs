import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  getClientIconMappingStatus,
  getConfirmedClientIcon,
  normalizeClientIconMapping,
} from '../../src/utils/clientIconMapping.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const fixturePath = path.resolve(here, '../../src/data/confirmed-client-icon-mapping.json')
const hashA = 'a'.repeat(64)
const hashB = 'b'.repeat(64)

function record(overrides = {}) {
  return {
    itemId: '101',
    iconId: '9001',
    iconPath: '/images/client-items/101.webp',
    sourceHash: hashA,
    width: 128,
    height: 128,
    format: 'webp',
    status: 'confirmed',
    confirmedAt: '2026-09-29T00:00:00.000Z',
    ...overrides,
  }
}

test('normalizes valid records and resolves confirmed icons by numeric or string ID', () => {
  const mapping = normalizeClientIconMapping({
    schemaVersion: 1,
    mappings: [
      record(),
      record({ itemId: 202, iconId: null, iconPath: '/images/client-items/202.png', sourceHash: hashB }),
    ],
  })

  assert.equal(mapping.schemaVersion, 1)
  assert.equal(mapping.mappings.length, 2)
  assert.equal(mapping.mappings[0].itemId, '101')
  assert.equal(mapping.mappings[1].itemId, '202')
  assert.equal(mapping.byItemId.get('101').sourceHash, hashA)
  assert.equal(mapping.byPath.get('/images/client-items/202.png').itemId, '202')
  assert.equal(getConfirmedClientIcon(mapping, 101), '/images/client-items/101.webp')
  assert.equal(getConfirmedClientIcon(mapping, '202'), '/images/client-items/202.png')
  assert.equal(getClientIconMappingStatus(mapping, '101'), 'confirmed')
})

test('rejects duplicate item IDs and duplicate icon paths', () => {
  assert.throws(() => normalizeClientIconMapping({
    schemaVersion: 1,
    mappings: [record(), record({ iconPath: '/images/client-items/other.webp' })],
  }), /duplicate.*itemId/i)

  assert.throws(() => normalizeClientIconMapping({
    schemaVersion: 1,
    mappings: [record(), record({ itemId: '202' })],
  }), /duplicate.*iconPath|duplicate.*path/i)
})

test('rejects path traversal and non-local icon paths', () => {
  for (const iconPath of [
    '/images/client-items/../market-items/101.webp',
    '/images/client-items/%2e%2e/market-items/101.webp',
    '/images/client-items\\101.webp',
    '/images/market-items/101.webp',
    'https://example.test/images/client-items/101.webp',
  ]) {
    assert.throws(() => normalizeClientIconMapping({
      schemaVersion: 1,
      mappings: [record({ iconPath })],
    }), /iconPath|path|local/i, iconPath)
  }
})

test('requires positive IDs, confirmed-compatible status, and SHA-256 source metadata', () => {
  for (const itemId of [0, -1, 1.5, '0', '01', '', 'abc', null]) {
    assert.throws(() => normalizeClientIconMapping({
      schemaVersion: 1,
      mappings: [record({ itemId })],
    }), /itemId.*positive|numeric/i, String(itemId))
  }

  for (const status of ['pending', '', null]) {
    assert.throws(() => normalizeClientIconMapping({
      schemaVersion: 1,
      mappings: [record({ status })],
    }), /status/i, String(status))
  }

  for (const sourceHash of ['', 'not-a-sha256', 'a'.repeat(63), 'g'.repeat(64), null]) {
    assert.throws(() => normalizeClientIconMapping({
      schemaVersion: 1,
      mappings: [record({ sourceHash })],
    }), /sourceHash|sha-?256|hash/i, String(sourceHash))
  }
})

test('revoked and conflicting records are excluded from confirmed resolution', () => {
  const mapping = normalizeClientIconMapping({
    schemaVersion: 1,
    mappings: [
      record(),
      record({ itemId: '202', iconPath: '/images/client-items/202.webp', status: 'revoked' }),
      record({ itemId: '303', iconPath: '/images/client-items/303.webp', status: 'conflict' }),
    ],
  })

  assert.equal(getConfirmedClientIcon(mapping, '101'), '/images/client-items/101.webp')
  assert.equal(getConfirmedClientIcon(mapping, '202'), null)
  assert.equal(getConfirmedClientIcon(mapping, '303'), null)
  assert.equal(getClientIconMappingStatus(mapping, '202'), 'revoked')
  assert.equal(getClientIconMappingStatus(mapping, '303'), 'conflict')
})

test('unknown IDs return a null icon and unknown status', () => {
  const mapping = normalizeClientIconMapping({ schemaVersion: 1, mappings: [record()] })
  assert.equal(getConfirmedClientIcon(mapping, '999999'), null)
  assert.equal(getClientIconMappingStatus(mapping, '999999'), null)
  assert.equal(getConfirmedClientIcon('999999'), null)
})

test('ships an empty schema-versioned mapping fixture', async () => {
  const fixture = JSON.parse(await fs.readFile(fixturePath, 'utf8'))
  assert.deepEqual(fixture, { schemaVersion: 1, mappings: [] })
  assert.deepEqual(normalizeClientIconMapping(fixture).mappings, [])
})
