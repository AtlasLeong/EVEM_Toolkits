import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { inspectBundle } from '../../scripts/check-bundle.mjs'

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'evem-bundle-'))
  mkdirSync(join(root, 'assets'))
  return root
}

test('bundle budget distinguishes the entry from lazy chunks', () => {
  const root = fixture()
  writeFileSync(join(root, 'assets', 'index-main.js'), Buffer.alloc(100))
  writeFileSync(join(root, 'assets', 'TacticalBoard.js'), Buffer.alloc(200))
  writeFileSync(join(root, 'assets', 'index-main.css'), Buffer.alloc(100))
  const report = inspectBundle(root, { entryBytes: 120, javascriptBytes: 240, stylesheetBytes: 120 })
  assert.equal(report.violations.length, 0)
})

test('bundle budget reports the offending file and configured limit', () => {
  const root = fixture()
  writeFileSync(join(root, 'assets', 'index-main.js'), Buffer.alloc(121))
  const report = inspectBundle(root, { entryBytes: 120, javascriptBytes: 240, stylesheetBytes: 120 })
  assert.deepEqual(report.violations.map(file => ({ name: file.name, limit: file.limit })), [
    { name: 'index-main.js', limit: 120 },
  ])
})
