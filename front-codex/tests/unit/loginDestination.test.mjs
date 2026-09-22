import test from 'node:test'
import assert from 'node:assert/strict'
import { loginDestination } from '../../src/utils/loginDestination.js'
import { readFileSync } from 'node:fs'

const tacticalSource = readFileSync(new URL('../../src/pages/TacticalCollaboration.jsx', import.meta.url), 'utf8')

test('login return defaults preserve existing navigation', () => {
  assert.equal(loginDestination(''), '/fraudlist')
  assert.equal(loginDestination('?next=/starsea/new'), '/starsea/new')
  assert.equal(loginDestination('?next=%2Fstarsea%2F12%2Fedit'), '/starsea/12/edit')
  assert.equal(loginDestination('?next=/starsea/review'), '/starsea/review')
  assert.equal(loginDestination('?next=%2Fstarsea%2Freview%2F12'), '/starsea/review/12')
  assert.equal(loginDestination('?next=%2Ftactical%3Forganization%3D7'), '/tactical?organization=7')
})
test('login return accepts only known paths, never an external or unsafe destination', () => {
  for (const value of ['https://evil.test', '//evil.test', '/\\evil.test', '/starsea/../../login', '/starsea-evil', '/login', '/tactical', '/tactical?organization=abc', '/starsea/%2f%2fevil', '/starsea/new?next=https://evil.test']) {
    assert.equal(loginDestination(`?next=${encodeURIComponent(value)}`), '/fraudlist')
  }
})

test('tactical login entry preserves the current organization URL', () => {
  assert.doesNotMatch(tacticalSource, /to="\/login"/)
  assert.match(tacticalSource, /next=/)
})
